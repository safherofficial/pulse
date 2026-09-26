import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/x/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleXCallback } = await import("@/lib/xpulse/data.server");
        return handleXCallback(request);
      },
    },
  },
});
