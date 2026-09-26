/** Lifetime price is $10 USD, settled on Solana as SOL or USDC. */
export const PRICE_USD = 10;

/** Fallback if CoinGecko is unreachable (~SOL at a conservative rate). */
export const FALLBACK_SOL_USD = 150;
export const FALLBACK_PRICE_SOL = PRICE_USD / FALLBACK_SOL_USD;
export const FALLBACK_PRICE_LAMPORTS = Math.ceil(FALLBACK_PRICE_SOL * 1_000_000_000);

/** @deprecated use dynamic billing — kept as fallback lamports */
export const PRICE_SOL = FALLBACK_PRICE_SOL;
export const PRICE_LAMPORTS = FALLBACK_PRICE_LAMPORTS;

/** USDC has 6 decimals on Solana. $10 = 10_000_000 base units. */
export const USDC_DECIMALS = 6;
export const PRICE_USDC_BASE = PRICE_USD * 10 ** USDC_DECIMALS;

/** Mainnet USDC mint (Circle). */
export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Devnet USDC mint (common faucet mint). */
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

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
