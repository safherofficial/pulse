import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export function TopNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="relative z-30">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
        <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <BrandMark />
          <span className="wordmark text-sm text-fg">XPulse</span>
        </Link>
        <button
          type="button"
          className="tap inline-flex h-11 items-center px-3 font-mono text-xs tracking-widest text-muted uppercase md:hidden"
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "Menu"}
        </button>
        <div className="hidden md:block">
          <NavLinks onNavigate={() => setOpen(false)} />
        </div>
      </div>
      {open ? (
        <div id="site-nav" className="panel absolute inset-x-0 top-full mt-2 p-3 md:hidden">
          <NavLinks stacked onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </header>
  );
}

function NavLinks({ stacked = false, onNavigate }: { stacked?: boolean; onNavigate: () => void }) {
  const item = `nav-link inline-flex h-11 items-center px-3 text-sm text-muted hover:text-fg ${stacked ? "w-full" : ""}`;

  return (
    <nav
      className={stacked ? "flex flex-col" : "flex flex-wrap items-center gap-1"}
      aria-label="Primary"
    >
      <Link
        to="/research"
        className={item}
        activeProps={{ className: `${item} text-fg`, "data-active": "true" }}
        onClick={onNavigate}
      >
        Research
      </Link>
      <Link
        to="/tokens"
        className={item}
        activeProps={{ className: `${item} text-fg`, "data-active": "true" }}
        onClick={onNavigate}
      >
        Tokens
      </Link>
      <Link
        to="/create"
        className={item}
        activeProps={{ className: `${item} text-fg`, "data-active": "true" }}
        onClick={onNavigate}
      >
        Create
      </Link>
      <Link
        to="/analyze"
        className={item}
        activeProps={{ className: `${item} text-fg`, "data-active": "true" }}
        onClick={onNavigate}
      >
        Analyze
      </Link>
      <Link
        to="/studio"
        className={item}
        activeProps={{ className: `${item} text-fg`, "data-active": "true" }}
        onClick={onNavigate}
      >
        Chamber
      </Link>
      <AuthSlot onNavigate={onNavigate} stacked={stacked} />
    </nav>
  );
}

function AuthSlot({ onNavigate, stacked }: { onNavigate: () => void; stacked: boolean }) {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return <div className="skeleton h-11 w-28 bg-surface" aria-hidden />;
  }

  if (!user) {
    return (
      <Link to="/login" className={buttonVariants({ variant: "quiet" })} onClick={onNavigate}>
        Sign in with wallet
      </Link>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${stacked ? "flex-wrap px-3 py-2" : ""}`}>
      <Link
        to="/pulse"
        className="inline-flex h-11 items-center px-3 text-sm text-fg"
        onClick={onNavigate}
      >
        Your chamber
      </Link>
      <UserButton />
    </div>
  );
}
