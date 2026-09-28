import { createFileRoute } from "@tanstack/react-router";
import { AnalyzePage } from "./analyze";

export const Route = createFileRoute("/rewrite")({
  head: () => ({ meta: [{ title: "Rewrite · XPulse" }] }),
  component: () => <AnalyzePage initialMode="REWRITE" title="Rewrite" active="/rewrite" />,
});
