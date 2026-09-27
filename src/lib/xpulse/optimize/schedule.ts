/**
 * Daily optimization clock.
 *
 * DAILY_OPTIMIZATION_TIME is a Europe/Rome wall clock, HH:MM, stable across DST.
 * Default when the variable is unset: 06:15 Europe/Rome.
 *
 * Platform cron is hourly (minute 15) because a single UTC cron drifts when Rome
 * switches between CET and CEST. The job itself runs at most once per Rome date,
 * and only after the configured local time.
 */

export const OPTIMIZATION_TIMEZONE = "Europe/Rome";

/** Documented default. Override with DAILY_OPTIMIZATION_TIME=HH:MM. */
export const DEFAULT_DAILY_OPTIMIZATION_TIME = "06:15";

export type ClockTime = { hour: number; minute: number };

export function parseDailyTime(raw: string | undefined | null): ClockTime {
  const value = (raw ?? "").trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return { hour: 6, minute: 15 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function dailyOptimizationTime(env: NodeJS.ProcessEnv = process.env): ClockTime {
  return parseDailyTime(env.DAILY_OPTIMIZATION_TIME);
}

type RomeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function romeParts(now: Date): RomeParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: OPTIMIZATION_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const bag = Object.fromEntries(dtf.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour === "24" ? "0" : bag.hour),
    minute: Number(bag.minute),
  };
}

export function romeDayKey(now: Date): string {
  const parts = romeParts(now);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

function timezoneOffsetMs(date: Date): number {
  const parts = romeParts(date);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  return asUtc - date.getTime();
}

/** UTC instant whose Europe/Rome wall clock is the given time. */
export function romeWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = timezoneOffsetMs(new Date(guess));
  let utc = guess - offset;
  const corrected = timezoneOffsetMs(new Date(utc));
  if (corrected !== offset) utc = guess - corrected;
  return new Date(utc);
}

export function isDue(now: Date, time: ClockTime, lastCompletedDayKey: string | null): boolean {
  const parts = romeParts(now);
  const today = romeDayKey(now);
  if (lastCompletedDayKey === today) return false;
  const nowMinutes = parts.hour * 60 + parts.minute;
  const target = time.hour * 60 + time.minute;
  return nowMinutes >= target;
}

export function nextRunAt(now: Date, time: ClockTime, lastCompletedDayKey: string | null): Date {
  const parts = romeParts(now);
  const todayKey = romeDayKey(now);
  const todaySlot = romeWallTimeToUtc(parts.year, parts.month, parts.day, time.hour, time.minute);
  if (lastCompletedDayKey !== todayKey && now.getTime() < todaySlot.getTime()) return todaySlot;
  const tomorrow = new Date(todaySlot.getTime() + 26 * 60 * 60 * 1000);
  const next = romeParts(tomorrow);
  return romeWallTimeToUtc(next.year, next.month, next.day, time.hour, time.minute);
}

export function formatRomeHm(date: Date): string {
  const parts = romeParts(date);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}
