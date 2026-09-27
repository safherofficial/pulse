import { DAYS } from "./constants.ts";

export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function formatFull(n: number): string {
  return new Intl.NumberFormat("en").format(n);
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function formatDwell(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

export function formatMaybe(n: number | null): string {
  if (n == null) return "—";
  return formatCompact(n);
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      hourCycle: "h23",
    }).format(d) + " UTC"
  );
}

export function formatCell(day: number, hour: number, value: number): string {
  const hh = hour.toString().padStart(2, "0");
  return `${DAYS[day] ?? "—"} · ${hh}:00 UTC · ${Math.round(value * 100)}`;
}

export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function extractPostId(raw: string): string {
  const trimmed = raw.trim();
  const status = trimmed.match(/status\/([A-Za-z0-9_-]{4,80})/);
  if (status?.[1]) return status[1];
  const article = trimmed.match(/\/article\/([A-Za-z0-9_-]{4,80})/);
  if (article?.[1]) return article[1];
  return trimmed;
}

export function formatTokenPrice(n: number | null): string | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  if (n === 0) return "$0";
  if (n >= 1) {
    const digits = n >= 100 ? 2 : 4;
    return `$${trimFixed(n.toFixed(digits))}`;
  }
  const exp = Math.floor(Math.log10(n));
  const decimals = Math.min(12, Math.max(2, 3 - exp));
  return `$${trimFixed(n.toFixed(decimals))}`;
}

function trimFixed(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

function scaledUnit(value: number): { rounded: number; text: string } {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return { rounded, text };
}

/** Compact market-cap note for generated copy. Null means the value is unavailable. */
export function formatMarketCapCompact(n: number | null): string | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  const tiers = [
    { div: 1, suffix: "" },
    { div: 1_000, suffix: "k" },
    { div: 1_000_000, suffix: "M" },
    { div: 1_000_000_000, suffix: "B" },
    { div: 1_000_000_000_000, suffix: "T" },
  ] as const;
  let tier = 0;
  if (n >= 1_000) tier = 1;
  if (n >= 1_000_000) tier = 2;
  if (n >= 1_000_000_000) tier = 3;
  if (n >= 1_000_000_000_000) tier = 4;

  let { div, suffix } = tiers[tier]!;
  let scaled = scaledUnit(n / div);
  if (scaled.rounded >= 1000 && tier < tiers.length - 1) {
    tier += 1;
    div = tiers[tier]!.div;
    suffix = tiers[tier]!.suffix;
    scaled = scaledUnit(n / div);
  }
  return `$${scaled.text}${suffix} mc`;
}

export function marketCapBand(
  n: number | null,
): "micro-cap" | "small-cap" | "mid-cap" | "large-cap" | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n < 10_000_000) return "micro-cap";
  if (n < 100_000_000) return "small-cap";
  if (n < 1_000_000_000) return "mid-cap";
  return "large-cap";
}
