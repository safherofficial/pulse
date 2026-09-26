import { createFileRoute, Link } from "@tanstack/react-router";
import { TopNav } from "@/components/top-nav";
import { PulseCanvas } from "@/components/scene/PulseCanvas";
import { buttonVariants } from "@/components/ui/button";
import { formatCompact, formatDwell, formatMaybe, formatPct } from "@/lib/xpulse/format";
import { engagementRate, readRatio } from "@/lib/xpulse/metrics";
import { sampleModel } from "@/lib/xpulse/sample";

export const Route = createFileRoute("/")({
  component: Home,
});

const READINGS = [
  ["Detail expands", "People who actually opened the post, not just people who scrolled past it."],
  ["Engagement rate", "Likes, replies, reposts, bookmarks, profile clicks, and link clicks, divided by impressions."],
  ["Profile visits", "Profile clicks that came from that single post."],
  ["Dwell", "Time spent in the piece when X reports it. Threads usually do not have it."],
  ["Thread vs article", "Link a launch thread to the X Article it was meant to sell."],
  ["Heatmap", "Weekday by hour. The sample is follower activity. Your account infers it from publish time and opens."],
] as const;

const MOVES = [
  ["01", "Read one link", "The chamber follows a single post. Nothing from the rest of the account is averaged in."],
  ["02", "Compare two links", "Set a reference next to the post you want to improve. Gaps stay visible."],
  ["03", "Keep the wallet", "Lifetime access is a one-time transfer. The wallet that paid is the key."],
] as const;

function Home() {
  const thread = sampleModel.posts[0]!;
  const article = sampleModel.posts[1]!;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-5 sm:px-6 sm:py-7">
      <TopNav />
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-12">
        <div className="rise">
          <p className="kicker">Signal chamber · for people who publish on X</p>
          <h1 className="mt-4 max-w-xl text-4xl leading-tight sm:text-6xl">
            Impressions are loud. Opens are the signal.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            XPulse is a chamber for launch threads and X Articles. It keeps detail expands, dwell, and profile visits in one place, then sets the thread next to the piece it was supposed to open.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/studio" className={buttonVariants()}>
              Enter the chamber
            </Link>
            <Link to="/onboard" className={buttonVariants({ variant: "quiet" })}>
              Unlock lifetime · 0.15 SOL
            </Link>
          </div>
          <dl className="mt-8 grid max-w-lg grid-cols-3 gap-3">
            <Fact label="Sample views" value={formatCompact(thread.metrics.impressions)} />
            <Fact label="Article opens" value={formatCompact(article.metrics.detailExpands ?? 0)} />
            <Fact label="Article dwell" value={formatDwell(article.metrics.dwellMs)} />
          </dl>
        </div>
        <div className="hud-corners panel rise rise-2 h-80 overflow-hidden sm:h-[32rem]">
          <span className="corner corner-tl" />
          <span className="corner corner-tr" />
          <span className="corner corner-bl" />
          <span className="corner corner-br" />
          <div className="pointer-events-none absolute top-4 left-4 z-10 flex items-center gap-2">
            <span className="status-dot" />
            <span className="font-mono text-xs tracking-widest text-accent">SAMPLE LINK · LIVE</span>
          </div>
          <PulseCanvas model={sampleModel} selectedPost={thread} mode="hero" />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {MOVES.map(([index, title, copy], i) => (
          <article key={index} className={`panel lift-card rise p-5 ${i === 1 ? "rise-2" : ""} ${i === 2 ? "rise-3" : ""}`}>
            <p className="font-mono text-xs text-accent">{index}</p>
            <h2 className="mt-3 text-xl">{title}</h2>
            <p className="mt-2 text-sm text-muted">{copy}</p>
          </article>
        ))}
      </section>

      <section className="grid items-start gap-8 border-t border-line pt-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div>
          <p className="kicker">How it reads</p>
          <h2 className="mt-3 text-3xl">Analyze one post at a time.</h2>
          <p className="mt-3 text-muted">
            Select a link in your Chamber and the 3D graph follows that post only. Compare mode uses two public X links to expose writing gaps.
          </p>
        </div>
        <div className="panel p-5">
          <p className="kicker">No X login</p>
          <p className="mt-3 text-sm text-muted">
            Public link analysis does not require an X login. XPulse resolves public post data through public embed-compatible sources and keeps unavailable metrics explicitly unavailable.
          </p>
        </div>
      </section>

      <section className="border-t border-line pt-12">
        <p className="kicker">Sample pair</p>
        <h2 className="mt-3 max-w-2xl text-3xl">A thread that travels. An article where people stay.</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <CompareCard title="Launch thread" post={thread} />
          <CompareCard title="X Article" post={article} />
        </div>
      </section>

      <section className="border-t border-line pt-12">
        <p className="kicker">Counted fields</p>
        <h2 className="mt-3 text-3xl">What gets counted</h2>
        <dl className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {READINGS.map(([term, copy]) => (
            <div key={term} className="border-t border-line pt-4">
              <dt className="font-medium">{term}</dt>
              <dd className="mt-1 text-sm text-muted">{copy}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="panel p-6 sm:p-8">
        <p className="kicker">0.15 SOL · once</p>
        <h2 className="mt-3 max-w-2xl text-3xl">Lifetime access, bound to the wallet that paid.</h2>
        <p className="mt-3 max-w-2xl text-muted">
          No renewal. The server reads the transfer from Solana. When the treasury has the 0.15 SOL and your wallet signed it, that address stays open.
        </p>
        <Link to="/onboard" className={`${buttonVariants()} mt-6`}>
          Continue to payment
        </Link>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-sm text-muted">
        <span className="wordmark text-fg">XPulse</span>
        <span>Not affiliated with X or Solana.</span>
      </footer>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line pt-3">
      <dt className="font-mono text-xs tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="mt-1 font-mono text-lg text-fg tabular-nums">{value}</dd>
    </div>
  );
}

function CompareCard({
  title,
  post,
}: {
  title: string;
  post: (typeof sampleModel.posts)[number];
}) {
  const ratio = readRatio(post.metrics);
  return (
    <article className="panel lift-card p-4">
      <h3 className="text-sm text-muted">{title}</h3>
      <p className="mt-3 font-mono text-3xl text-accent tabular-nums">{formatMaybe(post.metrics.detailExpands)}</p>
      <p className="font-mono text-xs tracking-widest text-subtle uppercase">detail expands</p>
      <dl className="mt-4 grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Engagement</dt>
          <dd className="font-mono tabular-nums">{formatPct(engagementRate(post.metrics))}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Open rate</dt>
          <dd className="font-mono tabular-nums">{ratio == null ? "—" : formatPct(ratio)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Dwell</dt>
          <dd className="font-mono tabular-nums">{formatDwell(post.metrics.dwellMs)}</dd>
        </div>
      </dl>
    </article>
  );
}
