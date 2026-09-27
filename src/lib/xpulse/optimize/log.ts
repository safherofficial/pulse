import type { OptimizationLogEvent } from "./types.ts";

/** Structured line. There is no app-wide logger; JSON keeps the events parseable. */
export function logOptimization(event: OptimizationLogEvent): void {
  console.log(JSON.stringify({ source: "xpulse.optimization", ...event }));
}

export function emitLogs(events: OptimizationLogEvent[], write: (event: OptimizationLogEvent) => void = logOptimization): void {
  for (const event of events) write(event);
}
