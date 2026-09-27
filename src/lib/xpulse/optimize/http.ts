import { executeDailyOptimization } from "./store.ts";
import { logOptimization } from "./log.ts";

function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const localKey = process.env.DAILY_OPTIMIZATION_KEY?.trim();
  if (!cronSecret && !localKey) return true;
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (cronSecret && token === cronSecret) return true;
  if (localKey && token === localKey) return true;
  return false;
}

export async function handleDailyOptimizationRequest(request: Request): Promise<Response> {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  try {
    const summary = await executeDailyOptimization();
    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "optimization failed";
    logOptimization({
      event: "optimization_failed",
      optimizationRunId: "unpersisted",
      at: new Date().toISOString(),
      detail: { message },
    });
    return Response.json(
      { status: "failed", error: "Daily optimization failed. The last stable version stays active." },
      { status: 500 },
    );
  }
}
