import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TopNav } from "@/components/top-nav";
import { PulseBeat } from "@/components/scene/PulseBeat";
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
  ["01", "Create for X", "Posts, threads, and articles scored for attention — not engagement bait. Built for devs, community, and token narratives."],
  ["02", "Research Solana", "Look up any token by name or contract. Market structure, liquidity, risks — then turn research into publish-ready copy."],
  ["03", "Your Chamber", "Your links and stats in one place. Charts, history, and rewrite tools without averaging the whole account."],
] as const;

/** Public list prices at time of write — used for a clear yearly comparison. */
const PRICE_ROWS = [
  {
    name: "XPulse",
    model: "Lifetime · on-chain",
    monthly: "—",
    yearly: "$10 once",
    focus: "Post-level opens, dwell, writing signals",
    ours: true,
  },
  {
    name: "Typefully",
    model: "Subscription",
    monthly: "$15–29",
    yearly: "$180–348",
    focus: "Scheduling + basic analytics",
    ours: false,
  },
  {
    name: "Hypefury",
    model: "Subscription",
    monthly: "$19–49",
    yearly: "$228–588",
    focus: "Growth automation + queues",
    ours: false,
  },
  {
    name: "Tweet Hunter",
    model: "Subscription",
    monthly: "~$49",
    yearly: "~$588",
    focus: "Viral templates + CRM",
    ours: false,
  },
  {
    name: "Buffer",
    model: "Subscription",
    monthly: "$6–12+",
    yearly: "$72–144+",
    focus: "Cross-network scheduling",
    ours: false,
  },
] as const;

function Home() {
  const thread = sampleModel.posts[0]!;
  const article = sampleModel.posts[1]!;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-5 sm:px-6 sm:py-7">
      <TopNav />
      <section className="panel p-4 sm:p-5">
        <p className="kicker">What do you want to do?</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["/create", "Create a post"],
            ["/create", "Create a thread"],
            ["/tokens", "Push my token"],
            ["/tokens", "Search any CA"],
            ["/research", "Research a topic"],
            ["/analyze", "Improve a draft"],
            ["/pulse", "Your Chamber"],
          ].map(([to, label]) => (
            <Link
              key={label}
              to={to}
              className="inline-flex h-11 items-center rounded-md border border-line bg-surface-2/50 px-4 text-sm text-fg transition hover:border-accent/50 hover:text-accent"
            >
              {label}
            </Link>
          ))}
        </div>
      </section>
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-12">
        <div className="rise">
          <p className="kicker">X + Solana intelligence · create · research · publish</p>
          <h1 className="mt-4 max-w-xl text-4xl leading-tight sm:text-6xl">
            From research to a post that can travel.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Built for creators, token devs, and community members who need fast, professional X content —
            grounded in real market data, scored for attention, without engagement bait.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/create" className={buttonVariants()}>
              Create content
            </Link>
            <Link to="/tokens" className={buttonVariants({ variant: "quiet" })}>
              Research a token
            </Link>
            <Link to="/pulse" className={buttonVariants({ variant: "quiet" })}>
              Your Chamber
            </Link>
          </div>
          <dl className="mt-8 grid max-w-lg grid-cols-3 gap-3">
            <Fact label="Sample views" value={formatCompact(thread.metrics.impressions)} />
            <Fact label="Article opens" value={formatCompact(article.metrics.detailExpands ?? 0)} />
            <Fact label="Article dwell" value={formatDwell(article.metrics.dwellMs)} />
          </dl>
        </div>
        <div className="hud-corners panel relative rise rise-2 h-[22rem] overflow-hidden sm:h-[34rem]">
          <span className="corner corner-tl" />
          <span className="corner corner-tr" />
          <span className="corner corner-bl" />
          <span className="corner corner-br" />
          <div className="pointer-events-none absolute top-4 left-4 z-10 flex items-center gap-2">
            <span className="status-dot" />
            <span className="font-mono text-xs tracking-widest text-accent">SAMPLE LINK · LIVE</span>
          </div>
          <div className="pointer-events-none absolute right-4 bottom-4 z-10 hidden rounded-md border border-line/60 bg-bg/70 px-3 py-1.5 font-mono text-[10px] tracking-widest text-muted backdrop-blur-md sm:block">
            SIGNAL BEAT · LIVE
          </div>
          <PulseBeat />
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
          <p className="kicker">Who it is for</p>
          <h2 className="mt-3 text-3xl">Devs, community, and publishers on X.</h2>
          <p className="mt-3 text-muted">
            Ship launch threads for your token, explain a bag to the community, or improve a draft before it goes live.
            Research by name or contract, then turn facts into posts, threads, or articles with a clear content score.
          </p>
        </div>
        <div className="panel p-5">
          <p className="kicker">No X login required</p>
          <p className="mt-3 text-sm text-muted">
            Analyze public links and create content without connecting an X account. Your Solana wallet is the identity.
            Unavailable metrics stay marked unavailable — never invented.
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

      <PriceCompare />

      <section className="panel p-6 sm:p-8">
        <p className="kicker">$10 · once · SOL/USDC</p>
        <h2 className="mt-3 max-w-2xl text-3xl">Lifetime access, bound to the wallet that paid.</h2>
        <p className="mt-3 max-w-2xl text-muted">
          No renewal. The server reads the transfer from Solana. When the treasury receives $10 in SOL or USDC and your
          wallet signed it, that address stays open.
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

/** Approximate USD for $10 lifetime for the savings simulator (display only). */
const XPULSE_YEAR_USD = 10;
const MARKET_MAX_USD = 588;

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function PriceCompare() {
  const [open, setOpen] = useState(false);
  const [annualSpend, setAnnualSpend] = useState(240);

  const savings = useMemo(
    () => Math.max(0, annualSpend - XPULSE_YEAR_USD),
    [annualSpend],
  );
  const pct = useMemo(() => {
    if (annualSpend <= 0) return 0;
    return Math.round((savings / annualSpend) * 100);
  }, [annualSpend, savings]);
  const sliderPct = ((annualSpend - XPULSE_YEAR_USD) / (MARKET_MAX_USD - XPULSE_YEAR_USD)) * 100;

  return (
    <section className="border-t border-line pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Price · honest comparison</p>
          <h2 className="mt-3 max-w-2xl text-3xl">One payment. No subscription treadmill.</h2>
          <p className="mt-3 max-w-2xl text-muted">
            Drag the slider to the yearly amount you would spend on a typical X growth tool. XPulse is{" "}
            <span className="text-fg">$10 lifetime once</span> (~{formatUsd(XPULSE_YEAR_USD)} at current display rate).
            The gap is your year-one savings.
          </p>
        </div>
        <Link to="/onboard" className={buttonVariants()}>
          Unlock · $10
        </Link>
      </div>

      <div className="panel mt-8 overflow-hidden p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] tracking-[0.16em] text-subtle uppercase">Your annual SaaS budget</p>
            <p className="mt-1 font-mono text-4xl tabular-nums text-fg sm:text-5xl">{formatUsd(annualSpend)}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[11px] tracking-[0.16em] text-subtle uppercase">You save with XPulse</p>
            <p className="mt-1 font-mono text-4xl tabular-nums text-accent sm:text-5xl">{formatUsd(savings)}</p>
            <p className="mt-1 font-mono text-xs text-muted">{pct}% of that budget · year one</p>
          </div>
        </div>

        <div className="mt-8">
          <div className="relative h-3 rounded-full bg-line/80">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent/40 via-accent to-signal transition-[width] duration-75"
              style={{ width: `${sliderPct}%` }}
            />
            <input
              type="range"
              min={XPULSE_YEAR_USD}
              max={MARKET_MAX_USD}
              step={6}
              value={annualSpend}
              onChange={(e) => setAnnualSpend(Number(e.target.value))}
              aria-label="Annual subscription budget"
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent accent-[var(--color-accent)]"
            />
          </div>
          <div className="mt-2 flex justify-between font-mono text-[11px] tracking-wide text-subtle uppercase">
            <span>XPulse · {formatUsd(XPULSE_YEAR_USD)}</span>
            <span>Market high · {formatUsd(MARKET_MAX_USD)}</span>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line/70 bg-bg/40 px-3 py-3">
            <p className="text-[11px] text-subtle uppercase">XPulse year one</p>
            <p className="mt-1 font-mono text-lg text-accent tabular-nums">
              $10 lifetime · ~{formatUsd(XPULSE_YEAR_USD)}
            </p>
          </div>
          <div className="rounded-lg border border-line/70 bg-bg/40 px-3 py-3">
            <p className="text-[11px] text-subtle uppercase">Your slider</p>
            <p className="mt-1 font-mono text-lg text-fg tabular-nums">{formatUsd(annualSpend)} / yr</p>
          </div>
          <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-3">
            <p className="text-[11px] text-subtle uppercase">Delta</p>
            <p className="mt-1 font-mono text-lg text-signal tabular-nums">{formatUsd(savings)} saved</p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="tap flex w-full items-center justify-between rounded-xl border border-line bg-surface/60 px-4 py-3 text-left text-sm hover:border-accent/40"
          aria-expanded={open}
        >
          <span className="font-medium text-fg">{open ? "Hide full comparison table" : "Show full comparison table"}</span>
          <span
            className={`font-mono text-accent transition-transform duration-300 ${open ? "rotate-180" : ""}`}
            aria-hidden
          >
            ↓
          </span>
        </button>

        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div className="mt-3 overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface/80 font-mono text-[11px] tracking-widest text-subtle uppercase">
                    <th className="px-4 py-3 font-medium">Tool</th>
                    <th className="px-4 py-3 font-medium">Billing</th>
                    <th className="px-4 py-3 font-medium">Per month</th>
                    <th className="px-4 py-3 font-medium">Year one</th>
                    <th className="px-4 py-3 font-medium">Built for</th>
                  </tr>
                </thead>
                <tbody>
                  {PRICE_ROWS.map((row) => (
                    <tr
                      key={row.name}
                      className={`border-b border-line/80 last:border-0 ${
                        row.ours
                          ? "bg-accent/10 shadow-[inset_3px_0_0_0_var(--color-accent)]"
                          : "bg-bg/40"
                      }`}
                    >
                      <td className="px-4 py-3.5">
                        <span className={`font-medium ${row.ours ? "text-accent" : "text-fg"}`}>{row.name}</span>
                        {row.ours ? (
                          <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 font-mono text-[10px] tracking-wider text-accent uppercase">
                            You are here
                          </span>
                        ) : null}
                      </td>
                      <td className={`px-4 py-3.5 ${row.ours ? "text-fg" : "text-muted"}`}>{row.model}</td>
                      <td className={`px-4 py-3.5 font-mono tabular-nums ${row.ours ? "text-fg" : "text-muted"}`}>
                        {row.monthly}
                      </td>
                      <td
                        className={`px-4 py-3.5 font-mono tabular-nums ${
                          row.ours ? "text-accent font-semibold" : "text-muted"
                        }`}
                      >
                        {row.yearly}
                      </td>
                      <td className={`px-4 py-3.5 ${row.ours ? "text-fg" : "text-muted"}`}>{row.focus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-subtle">
              Competitor figures are public list prices (approx.) and can change. XPulse is $10 lifetime, paid in SOL (live quote) or USDC on Solana.
              SOL lifetime. USD display for the simulator is an estimate for comparison only.
            </p>
          </div>
        </div>
      </div>
    </section>
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
