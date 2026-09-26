/**
 * Social authentication is intentionally disabled.
 *
 * Authentication for XPulse is wallet-only: a Solana wallet signs a short
 * challenge and the server creates the application session from that proof.
 *
 * This compatibility export stays empty so older imports cannot accidentally
 * re-enable a social provider.
 */
export const GROK_PROVIDERS = [] as const;
