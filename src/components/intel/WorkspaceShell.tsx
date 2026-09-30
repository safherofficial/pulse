import { Link } from "@tanstack/react-router";
import { TopNav } from "@/components/top-nav";
import { cn } from "@/lib/cn";

const NAV = [
  { to: "/tokens", label: "Token", hint: "Market + X intelligence" },
  { to: "/analyze", label: "Analyze", hint: "Score + diagnose" },
  { to: "/rewrite", label: "Rewrite", hint: "Transform a draft" },
  { to: "/create", label: "Create", hint: "Generate publish-ready content" },
] as const;

export function WorkspaceShell({
  title,
  kicker,
  children,
  active,
}: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
  active?: string;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-10 sm:px-6">
      <TopNav />
      <div className="flex flex-1 flex-col gap-6 pt-5 sm:pt-7">
        <nav className="workspace-nav -mx-1 flex gap-1 overflow-x-auto border-b border-line/80 px-1 pb-2" aria-label="Workspace">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "group shrink-0 rounded-lg border border-transparent px-3 py-2.5 text-xs text-muted transition",
                "hover:border-line hover:bg-surface/70 hover:text-fg",
                active === item.to && "border-accent/25 bg-accent/8 text-accent",
              )}
            >
              <span className="block font-mono font-medium tracking-wide uppercase">{item.label}</span>
              <span className="mt-0.5 hidden text-[10px] text-subtle group-hover:text-muted sm:block">{item.hint}</span>
            </Link>
          ))}
        </nav>

        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            {kicker ? <p className="kicker">{kicker}</p> : null}
            <h1 className="mt-1 text-2xl sm:text-3xl">{title}</h1>
          </div>
          <Link
            to="/analyze"
            className="hidden rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-accent/40 hover:text-accent sm:inline-flex"
          >
            Analyze a link →
          </Link>
        </header>

        {children}
      </div>
    </main>
  );
}
