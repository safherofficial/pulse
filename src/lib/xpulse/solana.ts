export type TxAccount = { pubkey: string; signer: boolean };

export type ChainTx = {
  accounts: TxAccount[];
  preBalances: number[];
  postBalances: number[];
  err: unknown;
};

/**
 * A lifetime payment is a confirmed transfer where the treasury's balance
 * rose by at least 0.15 SOL and the claimed wallet signed and spent at least
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
    return { ok: false, reason: "The treasury received less than 0.15 SOL from this wallet." };
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
