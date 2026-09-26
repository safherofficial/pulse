import { Link } from "@tanstack/react-router";
import { TopNav } from "@/components/top-nav";
import { cn } from "@/lib/cn";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/research", label: "Research" },
  { to: "/tokens", label: "Tokens" },
  { to: "/create", label: "Create" },
  { to: "/analyze", label: "Analyze" },
  { to: "/pulse", label: "Your Chamber" },
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
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 sm:py-7">
      <TopNav />
      <nav
        className="flex gap-1 overflow-x-auto border-b border-line pb-2"
        aria-label="Workspace"
      >
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "shrink-0 rounded-md px-3 py-2 font-mono text-xs tracking-wide uppercase text-muted transition hover:text-fg",
              active === item.to && "bg-surface-2 text-accent",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <header>
        {kicker ? <p className="kicker">{kicker}</p> : null}
        <h1 className="mt-1 text-2xl sm:text-3xl">{title}</h1>
      </header>
      {children}
    </main>
  );
}
