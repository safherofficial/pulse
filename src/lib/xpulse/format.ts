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
