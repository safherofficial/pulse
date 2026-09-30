import { createFileRoute, Link } from "@tanstack/react-router";
import { TopNav } from "@/components/top-nav";
import { buttonVariants } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Home,
});

const WORKFLOW = [
  ["01", "Find", "Search by token name, symbol, or contract address. Open the token snapshot and its available market data."],
  ["02", "Read", "Inspect public X mentions, account classifications, market state, risk signals, and time-based momentum when data exists."],
  ["03", "Create", "Generate a post, thread, or article from your source material. XPulse keeps factual inputs locked and validates the result."],
  ["04", "Sharpen", "Analyze a draft, run Rewrite, compare public X links, or send generated content into Analyze for another pass."],
] as const;

const FEATURES = [
  {
    kicker: "Token intelligence",
    title: "Market + public X in one view",
    body: "Token pages can show identity, price, market cap, liquidity, volume, price history, public X mentions, market-state signals, and temporal momentum. Missing fields stay unavailable instead of being guessed.",
    href: "/tokens",
    cta: "Search a token",
  },
  {
    kicker: "Analyze",
    title: "Score the writing before you publish",
    body: "Analyze scores hook, clarity, structure, specificity, originality, readability, value density, engagement potential, and credibility. The editor also uses account performance when that data is available.",
    href: "/analyze",
    cta: "Open Analyze",
  },
  {
    kicker: "Create",
    title: "Turn source material into content",
    body: "Create supports posts, threads, and articles with selectable editorial intent. Generated output is validated and can be improved or copied into your publishing workflow.",
    href: "/create",
    cta: "Create content",
  },
  {
    kicker: "Your Chamber",
    title: "A workspace for your own X data",
    body: "The personal Chamber keeps wallet-linked activity, imported X posts, performance signals, saved work, and comparison tools together. X connection is optional for public-link analysis.",
    href: "/pulse",
    cta: "Open Chamber",
  },
] as const;

function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-10 sm:px-6">
      <TopNav />

      <section className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
        <div>
          <p className="kicker">X intelligence · analysis · creation</p>
          <h1 className="mt-4 max-w-4xl text-[2.7rem] leading-[1.02] sm:text-6xl">
            From live signals to content you can actually use.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            XPulse connects token intelligence, public X research, deterministic content scoring, AI-assisted writing,
            and your own X performance data in one workflow.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link to="/tokens" className={buttonVariants({ className: "w-full justify-center sm:w-auto" })}>
              Explore tokens
            </Link>
            <Link to="/analyze" className={buttonVariants({ variant: "quiet", className: "w-full justify-center sm:w-auto" })}>
              Analyze content
            </Link>
            <Link to="/studio" className={buttonVariants({ variant: "quiet", className: "w-full justify-center sm:w-auto" })}>
              Preview the Chamber
            </Link>
          </div>
          <p className="mt-4 max-w-2xl text-xs leading-relaxed text-subtle">
            Authentication uses a Solana wallet signature. The current access flow includes a 7-day Pro trial and a
            one-time $10 lifetime option; the paying wallet remains the account owner.
          </p>
        </div>

        <aside className="panel hud-corners p-5 sm:p-6">
          <span className="corner corner-tl" />
          <span className="corner corner-tr" />
          <span className="corner corner-bl" />
          <span className="corner corner-br" />
          <p className="kicker">The workflow</p>
          <div className="mt-5 space-y-4">
            {WORKFLOW.map(([n, title, copy]) => (
              <div key={n} className="grid grid-cols-[2.2rem_1fr] gap-3">
                <span className="font-mono text-xs text-accent">{n}</span>
                <div>
                  <h2 className="text-base">{title}</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="border-t border-line/80 py-12 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker">One product, clear jobs</p>
            <h2 className="mt-2 max-w-2xl text-3xl">Each screen has one job. Move forward without losing context.</h2>
          </div>
          <Link to="/analyze" className="text-sm text-accent hover:underline">Start with a draft →</Link>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-2">
          {FEATURES.map((item) => (
            <article key={item.kicker} className="lift-card panel p-5 sm:p-6">
              <p className="kicker">{item.kicker}</p>
              <h3 className="mt-3 text-2xl">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              <Link to={item.href} className="mt-5 inline-flex text-sm text-accent hover:underline">
                {item.cta} →
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-5 border-t border-line/80 py-12 sm:py-16 lg:grid-cols-[.8fr_1.2fr]">
        <div>
          <p className="kicker">What stays factual</p>
          <h2 className="mt-2 text-3xl">Unavailable data stays unavailable.</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            XPulse separates verified market fields and public metrics from interpretation. Content generation can use
            the verified token fact set, while scoring and validation remain deterministic where possible.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["Market data", "Price, market cap, liquidity, volume, pair and OHLCV fields when returned by the source."],
            ["X data", "Public posts and available metrics. Coverage is a sample when the underlying source does not provide totals."],
            ["Content", "Post, thread, and article generation with format-specific editorial playbooks and validation."],
            ["Learning", "When enough measured posts exist, XPulse derives account-specific performance patterns instead of pretending they are universal rules."],
          ].map(([title, copy]) => (
            <div key={title} className="rounded-xl border border-line bg-surface/55 p-4">
              <h3 className="text-sm">{title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line/80 py-12 sm:py-16">
        <p className="kicker">Access</p>
        <div className="mt-3 grid gap-5 lg:grid-cols-2">
          <div className="panel p-6">
            <h2 className="text-2xl">Wallet first. X connection optional.</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Sign in with a Solana wallet. If you connect X, XPulse can import available public posts and attach
              account-specific performance learning to future content generation. Public-link analysis remains usable
              without connecting X.
            </p>
            <Link to="/login" className={buttonVariants({ className: "mt-5" })}>
              Sign in with wallet
            </Link>
          </div>
          <div className="panel p-6">
            <h2 className="text-2xl">Need a quick first step?</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              No setup is required to understand the workflow. Open the sample Chamber, search a token, or paste a
              public post into Analyze.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/studio" className={buttonVariants({ variant: "quiet" })}>Sample Chamber</Link>
              <Link to="/tokens" className={buttonVariants({ variant: "quiet" })}>Token</Link>
              <Link to="/analyze" className={buttonVariants({ variant: "quiet" })}>Analyze</Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-sm text-muted">
        <Link to="/" className="wordmark text-fg">XPulse</Link>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Link to="/tokens" className="hover:text-fg">Token</Link>
          <Link to="/analyze" className="hover:text-fg">Analyze</Link>
          <Link to="/create" className="hover:text-fg">Create</Link>
          <Link to="/studio" className="hover:text-fg">Sample Chamber</Link>
        </div>
        <span>Not affiliated with X or Solana.</span>
      </footer>
    </main>
  );
}
