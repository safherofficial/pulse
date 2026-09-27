/**
 * Token mention matching used by the public X mentions pipeline.
 * Viral Intelligence on the token page is that X-only mention list —
 * not a trending feed and not a cross-platform aggregator.
 */
export function isTokenMention(
  text: string,
  symbol: string,
  name: string | null,
): boolean {
  const raw = text.replace(/<[^>]+>/g, " ");
  const sym = symbol.replace(/[^A-Za-z0-9]/g, "").trim();
  if (sym.length < 2) return false;
  const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\$${escaped}\\b`, "i").test(raw)) return true;
  if (new RegExp(`\\b${escaped}(USDT|USDC|USD|EUR)\\b`, "i").test(raw)) return true;
  if (new RegExp(`\\(${escaped}\\)`, "i").test(raw)) return true;
  if (new RegExp(`\\b${escaped}\\b`).test(raw) && sym === sym.toUpperCase()) return true;

  const crypto = /\b(crypto|token|coin|memecoin|solana|ethereum|bitcoin|defi|altcoin|usdt|usdc|dex)\b/i;
  if (new RegExp(`\\b${escaped}\\b`, "i").test(raw) && crypto.test(raw)) return true;

  const nm = (name ?? "").trim();
  if (
    nm.length >= 4 &&
    nm.toLowerCase() !== sym.toLowerCase() &&
    new RegExp(`\\b${nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(raw) &&
    crypto.test(raw)
  ) {
    return true;
  }

  return false;
}
