export type TxAccount = { pubkey: string; signer: boolean };

export type ChainTx = {
  accounts: TxAccount[];
  preBalances: number[];
  postBalances: number[];
  err: unknown;
};

/**
 * A lifetime payment is a confirmed transfer where the treasury's balance
 * rose by at least the required lifetime amount and the claimed wallet signed and spent at least
 * that much. Balance deltas survive both legacy and versioned transactions.
 */
export function assessTransfer(
  tx: ChainTx,
  opts: { treasury: string; payer: string; minLamports: number },
): { ok: true; lamports: number } | { ok: false; reason: string } {
  if (tx.err) return { ok: false, reason: "The transaction failed on-chain." };
  const payerIdx = tx.accounts.findIndex((a) => a.pubkey === opts.payer);
  const treasuryIdx = tx.accounts.findIndex((a) => a.pubkey === opts.treasury);
  if (payerIdx < 0 || !tx.accounts[payerIdx]?.signer) {
    return { ok: false, reason: "This wallet did not sign the transaction." };
  }
  if (treasuryIdx < 0) return { ok: false, reason: "The treasury is not in the transaction." };
  const preT = tx.preBalances[treasuryIdx];
  const postT = tx.postBalances[treasuryIdx];
  const preP = tx.preBalances[payerIdx];
  const postP = tx.postBalances[payerIdx];
  if ([preT, postT, preP, postP].some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    return { ok: false, reason: "The transaction balances were unreadable." };
  }
  const gained = postT - preT;
  const spent = preP - postP;
  if (gained < opts.minLamports || spent < opts.minLamports) {
    return { ok: false, reason: "The treasury received less than the required lifetime amount from this wallet." };
  }
  return { ok: true, lamports: gained };
}

export function fromRpcResult(result: unknown): ChainTx | null {
  if (!result || typeof result !== "object") return null;
  const row = result as {
    meta?: {
      err?: unknown;
      preBalances?: unknown[];
      postBalances?: unknown[];
      loadedAddresses?: { writable?: string[]; readonly?: string[] };
    };
    transaction?: {
      message?: {
        header?: { numRequiredSignatures?: number };
        accountKeys?: unknown[];
      };
    };
  };
  const msg = row.transaction?.message;
  if (!msg || !row.meta?.preBalances || !row.meta.postBalances) return null;
  const sigs = msg.header?.numRequiredSignatures ?? 0;
  const staticKeys: TxAccount[] = (msg.accountKeys ?? []).map((key, index) => {
    if (typeof key === "string") return { pubkey: key, signer: index < sigs };
    if (key && typeof key === "object" && "pubkey" in key) {
      const parsed = key as { pubkey?: string; signer?: boolean };
      return { pubkey: String(parsed.pubkey ?? ""), signer: Boolean(parsed.signer) };
    }
    return { pubkey: "", signer: false };
  });
  const loaded = [
    ...(row.meta.loadedAddresses?.writable ?? []),
    ...(row.meta.loadedAddresses?.readonly ?? []),
  ].map((pubkey) => ({ pubkey, signer: false }));
  return {
    accounts: [...staticKeys, ...loaded],
    preBalances: row.meta.preBalances.map((n) => Number(n)),
    postBalances: row.meta.postBalances.map((n) => Number(n)),
    err: row.meta.err ?? null,
  };
}


export type TokenBalanceRow = {
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
};

/**
 * Accept a confirmed SPL USDC transfer where the treasury token account
 * gained at least minBaseUnits and the payer signed the transaction.
 */
export function assessUsdcTransfer(
  rpcResult: unknown,
  opts: { treasury: string; payer: string; mint: string; minBaseUnits: number },
): { ok: true; baseUnits: number } | { ok: false; reason: string } {
  if (!rpcResult || typeof rpcResult !== "object") {
    return { ok: false, reason: "Could not read token balances for USDC verification." };
  }
  const row = rpcResult as {
    meta?: {
      err?: unknown;
      preTokenBalances?: TokenBalanceRow[];
      postTokenBalances?: TokenBalanceRow[];
    };
    transaction?: {
      message?: {
        header?: { numRequiredSignatures?: number };
        accountKeys?: unknown[];
      };
    };
  };
  if (row.meta?.err) return { ok: false, reason: "The transaction failed on-chain." };

  const msg = row.transaction?.message;
  const sigs = msg?.header?.numRequiredSignatures ?? 0;
  const keys = (msg?.accountKeys ?? []).map((key, index) => {
    if (typeof key === "string") return { pubkey: key, signer: index < sigs };
    if (key && typeof key === "object" && "pubkey" in key) {
      const parsed = key as { pubkey?: string; signer?: boolean };
      return { pubkey: String(parsed.pubkey ?? ""), signer: Boolean(parsed.signer) };
    }
    return { pubkey: "", signer: false };
  });
  const payerSigned = keys.some((k) => k.pubkey === opts.payer && k.signer);
  if (!payerSigned) return { ok: false, reason: "This wallet did not sign the USDC transaction." };

  const pre = row.meta?.preTokenBalances ?? [];
  const post = row.meta?.postTokenBalances ?? [];

  const amountFor = (balances: TokenBalanceRow[], ownerHint: string) => {
    let total = 0;
    for (const b of balances) {
      if (b.mint !== opts.mint) continue;
      // Treasury ATA owner is the treasury wallet
      if (b.owner && b.owner !== opts.treasury && b.owner !== ownerHint) continue;
      if (b.owner === opts.treasury) {
        total += Number(b.uiTokenAmount?.amount ?? 0) || 0;
      }
    }
    return total;
  };

  // Sum all post-pre for mint where owner is treasury
  const preTreasury = pre
    .filter((b) => b.mint === opts.mint && b.owner === opts.treasury)
    .reduce((s, b) => s + (Number(b.uiTokenAmount?.amount ?? 0) || 0), 0);
  const postTreasury = post
    .filter((b) => b.mint === opts.mint && b.owner === opts.treasury)
    .reduce((s, b) => s + (Number(b.uiTokenAmount?.amount ?? 0) || 0), 0);
  const gained = postTreasury - preTreasury;
  if (gained < opts.minBaseUnits) {
    return {
      ok: false,
      reason: `Treasury USDC gain ${gained} is below the required ${opts.minBaseUnits} base units.`,
    };
  }
  return { ok: true, baseUnits: gained };
}
