/**
 * Public social-account catalog for token mention matching.
 * Seed contains only widely published official org handles.
 * Unverified lookalikes stay out of the official set.
 */

export type SocialCategory =
  | "protocol"
  | "exchange"
  | "media"
  | "developer"
  | "founder"
  | "creator"
  | "trading"
  | "memecoin";

export type PublicSocialAccount = {
  platform: "x";
  handle: string;
  displayName: string;
  profileUrl: string;
  category: SocialCategory;
  official: boolean;
  source: string;
  verificationStatus: "official" | "unknown";
};

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

/** Public official org accounts — not a completeness claim. */
export const PUBLIC_SOCIAL_SEED: PublicSocialAccount[] = [
  acc("solana", "Solana", "protocol", "Official Solana protocol account."),
  acc("solanastatus", "Solana Status", "protocol", "Official Solana status account."),
  acc("superteamdao", "Superteam", "protocol", "Official Superteam DAO account."),
  acc("heliuslabs", "Helius", "developer", "Official Helius labs account."),
  acc("jito_sol", "Jito", "protocol", "Official Jito Network account."),
  acc("pythnetwork", "Pyth Network", "protocol", "Official Pyth Network account."),
  acc("jupiterexchange", "Jupiter", "exchange", "Official Jupiter exchange account."),
  acc("raydiumprotocol", "Raydium", "protocol", "Official Raydium protocol account."),
  acc("orca_so", "Orca", "protocol", "Official Orca protocol account."),
  acc("driftprotocol", "Drift", "trading", "Official Drift protocol account."),
  acc("kamino_finance", "Kamino", "protocol", "Official Kamino Finance account."),
  acc("marinadefinance", "Marinade", "protocol", "Official Marinade Finance account."),
  acc("tensor_hq", "Tensor", "exchange", "Official Tensor marketplace account."),
  acc("phantom", "Phantom", "exchange", "Official Phantom wallet account."),
  acc("solflare", "Solflare", "exchange", "Official Solflare wallet account."),
  acc("bonk_inu", "BONK", "memecoin", "Official BONK token account."),
  acc("coindesk", "CoinDesk", "media", "Official CoinDesk account."),
  acc("cointelegraph", "Cointelegraph", "media", "Official Cointelegraph account."),
  acc("theblock__", "The Block", "media", "Official The Block account."),
  acc("decryptmedia", "Decrypt", "media", "Official Decrypt account."),
  acc("blockworks_", "Blockworks", "media", "Official Blockworks account."),
  acc("solanafloor", "SolanaFloor", "media", "Official SolanaFloor account."),
  acc("aeyakovenko", "Anatoly Yakovenko", "founder", "Public founder account linked from Solana communications."),
  acc("rajgokal", "Raj Gokal", "founder", "Public founder account linked from Solana communications."),
];

function acc(
  handle: string,
  displayName: string,
  category: SocialCategory,
  source: string,
): PublicSocialAccount {
  const normalized = normalizeHandle(handle);
  return {
    platform: "x",
    handle: normalized,
    displayName,
    profileUrl: `https://x.com/${normalized}`,
    category,
    official: true,
    source,
    verificationStatus: "official",
  };
}

export function accountId(account: Pick<PublicSocialAccount, "platform" | "handle">): string {
  return `${account.platform}:${normalizeHandle(account.handle)}`;
}

export async function ensurePublicSocialAccounts(): Promise<PublicSocialAccount[]> {
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    for (const row of PUBLIC_SOCIAL_SEED) {
      await sql.query(
        `insert into public_social_accounts
          (id, platform, handle, display_name, profile_url, category, official, source, verification_status, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         on conflict (platform, handle) do update set
           display_name = excluded.display_name,
           profile_url = excluded.profile_url,
           category = excluded.category,
           official = excluded.official,
           source = excluded.source,
           verification_status = excluded.verification_status,
           updated_at = now()`,
        [
          accountId(row),
          row.platform,
          row.handle,
          row.displayName,
          row.profileUrl,
          row.category,
          row.official,
          row.source,
          row.verificationStatus,
        ],
      );
    }
    const stored = await sql.query<{
      platform: string;
      handle: string;
      display_name: string;
      profile_url: string;
      category: string;
      official: boolean;
      source: string;
      verification_status: string;
    }>(
      `select platform, handle, display_name, profile_url, category, official, source, verification_status
       from public_social_accounts
       where platform = 'x'`,
    );
    if (stored.length) {
      return stored.map((row) => ({
        platform: "x",
        handle: normalizeHandle(row.handle),
        displayName: row.display_name,
        profileUrl: row.profile_url,
        category: row.category as SocialCategory,
        official: Boolean(row.official),
        source: row.source,
        verificationStatus: row.verification_status === "official" ? "official" : "unknown",
      }));
    }
  } catch {
    /* table may not exist yet — use the in-memory seed */
  }
  return PUBLIC_SOCIAL_SEED;
}

export function findCatalogAccount(
  catalog: PublicSocialAccount[],
  handle: string,
): PublicSocialAccount | null {
  const key = normalizeHandle(handle);
  return catalog.find((row) => row.handle === key) ?? null;
}
