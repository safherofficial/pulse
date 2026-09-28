import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old workspace URL. It is not a page. */
export const Route = createFileRoute("/research")({
  beforeLoad: () => {
    throw redirect({ to: "/analyze" });
  },
});
