import { createFileRoute, Link } from "@tanstack/react-router";
import { TopNav } from "@/components/top-nav";
import { buttonVariants } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Home,
});

const PILLARS = [
  {
    kicker: "Mentions",
    title: "See who is talking",
    body: "Public X mentions for a token: the account, the post, and the link. Official, KOL, verified, or just an account — classified from the data you already have.",
  },
  {
    kicker: "Analysis",
    title: "Read the piece, then the pair",
    body: "Score a draft. Compare two public X posts. Break down what is stronger without inventing metrics that were never returned.",
  },
  {
    kicker: "Creation",
    title: "Write from the live tape",
    body: "Generate a post, thread, or article with the token’s real price and market cap woven in. Regeneration changes the writing, not the numbers.",
  },
  {
    kicker: "Chamber",
    title: "Your X workspace",
    body: "Wallet, saved activity, and creator tools in one place. Compare, rewrite, and keep the work attached to the address that owns it.",
  },
] as const;

const STEPS = [
  ["01", "Look up a token", "Search by name or contract. Market structure comes from the live pair, or it stays unavailable."],
  ["02", "Read X", "Viral Intelligence shows who is talking about that token on X, and what they said."],
  ["03", "Generate", "Posts, threads, and articles pick up the current price and a compact market cap when those fields exist."],
  ["04", "Sharpen", "Score the draft or compare it with a stronger public post before you publish."],
] as const;

function Home() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-5 sm:gap-20 sm:px-6 sm:py-7">
      <TopNav />

      <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-12">
        <div>
          <p className="kicker">For people who publish on X</p>
          <h1 className="mt-4 max-w-3xl text-[2.4rem] leading-[1.05] sm:text-6xl">
            Turn X signals into better content.
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">
            XPulse puts public X mentions, the live market tape, content analysis, and generation in one workflow.
            You see who is talking, what the market is doing, and you write from that — not from a blank page.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link to="/login" className={`${buttonVariants()} w-full justify-center sm:w-auto`}>
              Start 7-day trial
            </Link>
            <a href="#how" className={`${buttonVariants({ variant: "quiet" })} w-full justify-center sm:w-auto`}>
              See how it works
            </a>
          </div>
          <p className="mt-4 max-w-md text-sm text-subtle">
            Enter with a Solana wallet. The 7-day Pro trial starts on that address. Lifetime access is $10, paid once in SOL or USDC.
          </p>
        </div>

        <aside className="panel p-5 sm:p-6" aria-label="What XPulse shows">
          <p className="kicker">On a token</p>
          <h2 className="mt-3 text-2xl">Who is talking, and what the tape says.</h2>
          <ol className="mt-5 grid gap-3">
            {[
              ["Viral Intelligence", "Public X mentions and notable accounts. X only."],
              ["Market tape", "Price, market cap, liquidity, and listing signals from the pair."],
              ["Generated content", "A post that can say the price and a compact market cap — only when those numbers exist."],
            ].map(([title, copy]) => (
              <li key={title} className="rounded-lg border border-line bg-surface-2/40 px-4 py-3">
                <p className="text-sm text-fg">{title}</p>
                <p className="mt-1 text-sm text-muted">{copy}</p>
              </li>
            ))}
          </ol>
          <Link to="/tokens" className="mt-5 inline-flex text-sm text-accent hover:underline">
            Open Token
          </Link>
        </aside>
      </section>

      <section>
        <p className="kicker">Why it matters</p>
        <h2 className="mt-3 max-w-2xl text-3xl">Token data and writing stop living in different tabs.</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            ["Discover", "Find the token and the public X posts that actually mention it."],
            ["Understand", "Keep price and market cap attached to the story you are about to tell."],
            ["Publish", "Generate, score, and compare before the post goes live."],
          ].map(([title, copy]) => (
            <article key={title} className="border-t border-line pt-4">
              <h3 className="text-lg">{title}</h3>
              <p className="mt-2 text-sm text-muted">{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {PILLARS.map((item) => (
          <article key={item.kicker} className="panel p-5 sm:p-6">
            <p className="kicker">{item.kicker}</p>
            <h2 className="mt-3 text-2xl">{item.title}</h2>
            <p className="mt-2 text-sm text-muted">{item.body}</p>
          </article>
        ))}
      </section>

      <section id="how" className="scroll-mt-8 border-t border-line pt-12">
        <p className="kicker">How it works</p>
        <h2 className="mt-3 max-w-2xl text-3xl">From a contract to a post you can stand behind.</h2>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2">
          {STEPS.map(([n, title, copy]) => (
            <li key={n} className="panel p-4 sm:p-5">
              <p className="font-mono text-xs text-accent">{n}</p>
              <h3 className="mt-2 text-lg">{title}</h3>
              <p className="mt-1 text-sm text-muted">{copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-line pt-12">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <p className="kicker">What you get</p>
            <h2 className="mt-3 text-3xl">Try it on the wallet. Keep it if it earns the desk.</h2>
            <p className="mt-3 text-muted">
              Access follows the Solana address that signs in. No email account. The trial is seven days.
              Lifetime is a single $10 payment in SOL or USDC, verified on-chain, bound to that wallet.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-xl border border-accent/30 bg-accent/5 p-5">
              <p className="kicker">Start</p>
              <h3 className="mt-3 text-xl">7-day Pro trial</h3>
              <p className="mt-2 text-sm text-muted">Starts automatically for a new wallet. Full product access while it is active.</p>
            </article>
            <article className="rounded-xl border border-line bg-surface-2/40 p-5">
              <p className="kicker">Keep</p>
              <h3 className="mt-3 text-xl">$10 lifetime</h3>
              <p className="mt-2 text-sm text-muted">One payment. No renewal. The wallet that paid is the wallet that stays open.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="panel p-6 sm:p-8">
        <p className="kicker">Enter XPulse</p>
        <h2 className="mt-3 max-w-2xl text-3xl">Start with the wallet you already use.</h2>
        <p className="mt-3 max-w-2xl text-muted">
          Look up a token, read the X mentions, and write with the market snapshot still attached.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link to="/login" className={`${buttonVariants()} w-full justify-center sm:w-auto`}>
            Enter XPulse
          </Link>
          <Link to="/tokens" className={`${buttonVariants({ variant: "quiet" })} w-full justify-center sm:w-auto`}>
            Search a token
          </Link>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-sm text-muted">
        <span className="wordmark text-fg">XPulse</span>
        <span>Not affiliated with X or Solana.</span>
      </footer>
    </main>
  );
}
