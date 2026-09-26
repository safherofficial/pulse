import type { ContentScoreReport } from "@/lib/xpulse/content-score";

export function ScoreCard({ report }: { report: ContentScoreReport }) {
  return (
    <section className="panel space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Content score</p>
          <p className="mt-1 font-display text-4xl text-accent tabular-nums">
            {report.total}
            <span className="text-lg text-muted">/100</span>
          </p>
        </div>
        <p className="max-w-sm text-xs text-subtle">
          Assessment of structural potential — not a promise of impressions or
          engagement.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {report.dimensions.map((d) => (
          <div key={d.key} className="rounded-md border border-line bg-surface-2/60 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-fg">{d.label}</span>
              <span className="font-mono text-xs text-accent tabular-nums">{d.score}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-accent/80"
                style={{ width: `${d.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs font-mono uppercase tracking-wide text-signal">Working</p>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {report.working.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-mono uppercase tracking-wide text-flare">Limiting</p>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {report.limiting.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-mono uppercase tracking-wide text-accent">Improve</p>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {report.improvements.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
