import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/daily-optimization")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleDailyOptimizationRequest } = await import("@/lib/xpulse/optimize/http");
        return handleDailyOptimizationRequest(request);
      },
    },
  },
});
