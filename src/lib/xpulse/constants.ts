/** 0.15 SOL in lamports. One lifetime payment, no renewal. */
export const PRICE_SOL = 0.15;
export const PRICE_LAMPORTS = 150_000_000;

/**
 * Devnet rehearsal sink. Mainnet payments are refused unless
 * SOLANA_TREASURY_ADDRESS is set, so real SOL is never sent here by accident.
 */
export const BUILTIN_TREASURY = "CQZupkiKaKaVLfAHMLNGmkDdSSZB1bL4f8CNsjpkK3Vk";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function envTreasury(): string {
  const fromEnv =
    typeof process !== "undefined" ? process.env.SOLANA_TREASURY_ADDRESS?.trim() : "";
  return fromEnv || "";
}
