import { createFileRoute } from "@tanstack/react-router";
import { Chamber } from "@/components/chamber/Chamber";
import { sampleModel } from "@/lib/xpulse/sample";

export const Route = createFileRoute("/studio")({
  head: () => ({ meta: [{ title: "Your Chamber · XPulse" }] }),
  component: StudioPage,
});

function StudioPage() {
  return <Chamber model={sampleModel} />;
}
