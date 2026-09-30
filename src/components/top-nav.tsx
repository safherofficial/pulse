import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const PRIMARY = [
  { to: "/tokens", label: "Token" },
  { to: "/analyze", label: "Analyze" },
  { to: "/create", label: "Create" },
  { to: "/rewrite", label: "Rewrite" },
] as const;

export function TopNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 -mx-4 border-b border-line/80 bg-bg/88 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
      <div className="flex min-h-11 items-center justify-between gap-4">
        <Link to="/" className="flex shrink-0 items-center gap-2" onClick={() => setOpen(false)} aria-label="XPulse home">
          <BrandMark />
          <span className="wordmark text-sm text-fg">XPulse</span>
        </Link>

        <div className="hidden min-w-0 items-center gap-1 md:flex">
          <NavLinks onNavigate={() => setOpen(false)} />
        </div>

        <div className="flex items-center gap-2">
          <AuthSlot onNavigate={() => setOpen(false)} compact />
          <button
            type="button"
            className="tap inline-flex h-10 items-center rounded-md border border-line px-3 font-mono text-[11px] tracking-widest text-muted uppercase hover:border-accent/40 hover:text-fg md:hidden"
            aria-expanded={open}
            aria-controls="site-nav"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {open ? (
        <div id="site-nav" className="mt-3 border-t border-line/60 pt-3 md:hidden">
          <NavLinks stacked onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </header>
  );
}

function NavLinks({ stacked = false, onNavigate }: { stacked?: boolean; onNavigate: () => void }) {
  const item = `nav-link inline-flex min-h-10 items-center rounded-md px-3 text-sm text-muted hover:bg-surface/70 hover:text-fg ${stacked ? "w-full" : ""}`;

  return (
    <nav className={stacked ? "grid gap-1" : "flex items-center gap-1"} aria-label="Primary">
      {PRIMARY.map((itemDef) => (
        <Link
          key={itemDef.to}
          to={itemDef.to}
          className={item}
          activeProps={{ className: `${item} text-fg`, "data-active": "true" }}
          onClick={onNavigate}
        >
          {itemDef.label}
        </Link>
      ))}
    </nav>
  );
}

function AuthSlot({
  onNavigate,
  stacked = false,
  compact = false,
}: {
  onNavigate: () => void;
  stacked?: boolean;
  compact?: boolean;
}) {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return <div className="skeleton h-9 w-24 rounded-md bg-surface" aria-hidden />;
  }

  if (!user) {
    return (
      <Link
        to="/login"
        className={buttonVariants({ variant: "quiet", className: compact ? "ml-1 h-9" : "" })}
        onClick={onNavigate}
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className={`flex items-center gap-1 ${stacked ? "mt-2 flex-wrap border-t border-line/60 px-1 pt-3" : "ml-1"}`}>
      <Link
        to="/pulse"
        className="nav-link inline-flex min-h-10 items-center rounded-md px-3 text-sm text-muted hover:bg-surface/70 hover:text-fg"
        activeProps={{ "data-active": "true", className: "nav-link inline-flex min-h-10 items-center rounded-md bg-surface px-3 text-sm text-fg" }}
        onClick={onNavigate}
      >
        Chamber
      </Link>
      <UserButton />
    </div>
  );
}
