import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy path. Token detail lives on /tokens?ca=ADDRESS (avoids dynamic-route 404).
 */
export const Route = createFileRoute("/token/$address")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/tokens",
      search: { ca: params.address },
    });
  },
});
