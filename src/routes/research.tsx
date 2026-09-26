import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { getTrendSnapshot, type TrendSnapshot } from "@/lib/xpulse/trends";
import { suggestAngles } from "@/lib/xpulse/content-create";

export const Route = createFileRoute("/research")({
  head: () => ({ meta: [{ title: "Research · XPulse" }] }),
  component: ResearchPage,
});

function ResearchPage() {
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [trends, setTrends] = useState<TrendSnapshot | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  async function run() {
    if (!topic.trim()) return;
    setBusy(true);
    try {
      const snap = await getTrendSnapshot();
      setTrends(snap);
      const angles = suggestAngles(topic);
      const lines = [
        `Topic: ${topic.trim()}`,
        "",
        "Suggested angles (pick one before writing):",
        ...angles.slice(0, 5).map((a) => `• ${a.label} — ${a.why}`),
        "",
        "Live market / builder pulse:",
        ...(snap.web3Bias.length
          ? snap.web3Bias.slice(0, 6).map((w) => `• ${w}`)
          : ["• No strong web3 bias in the current snapshot"]),
        "",
        "Next: open Create with your notes, or research a Solana token if the topic is market-related.",
        "",
        "Fact discipline: separate verified data from claims. Do not invent numbers, partnerships, or quotes.",
      ];
      setNotes(lines);
    } catch {
      setNotes([
        "Some live signals are temporarily unavailable.",
        "You can still outline angles and draft in Create.",
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspaceShell active="/research" kicker="Intelligence" title="Research workspace">
      <section className="panel p-4 sm:p-5">
        <label className="block">
          <span className="kicker">Topic, person, project, or question</span>
          <textarea
            className="mt-2 min-h-28 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg outline-none ring-accent focus:ring-1"
            placeholder="e.g. Solana restaking narrative · a project launch · an X post URL idea…"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={busy || !topic.trim()} onClick={() => void run()}>
            {busy ? "Researching…" : "Research"}
          </Button>
          <Link
            to="/tokens"
            className="inline-flex h-11 items-center rounded-md border border-line px-4 text-sm text-muted hover:text-fg"
          >
            Search Solana token
          </Link>
          <Link
            to="/create"
            className="inline-flex h-11 items-center rounded-md border border-line px-4 text-sm text-muted hover:text-fg"
          >
            Create content
          </Link>
        </div>
      </section>

      {notes.length ? (
        <section className="panel p-4 sm:p-5">
          <p className="kicker">Brief</p>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">
            {notes.join("\n")}
          </pre>
          {trends ? (
            <p className="mt-4 text-xs text-subtle">
              Live signals updated{" "}
              {new Date(trends.fetchedAt).toLocaleString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
              . Cached for ~30 minutes.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="panel p-4 sm:p-5">
        <p className="kicker">Workflow</p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>Frame the topic in one sentence.</li>
          <li>Pull live market / builder context when relevant.</li>
          <li>Separate facts from claims before writing.</li>
          <li>Pick an angle, then generate in Create.</li>
          <li>Score, improve, publish only what you can stand behind.</li>
        </ol>
      </section>
    </WorkspaceShell>
  );
}
