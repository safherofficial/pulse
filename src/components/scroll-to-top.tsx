import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { scrollPageToTop, shouldShowScrollTop } from "@/lib/xpulse/ui-behavior";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(shouldShowScrollTop(window.scrollY));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      onClick={() => scrollPageToTop(window)}
      className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 grid h-11 w-11 place-items-center rounded-full border border-accent/40 bg-surface/90 text-accent shadow-[0_0_22px_color-mix(in_srgb,var(--color-accent)_32%,transparent)] backdrop-blur-md transition hover:border-accent hover:bg-surface-2 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:right-6 sm:bottom-6"
    >
      <ArrowUp className="h-4 w-4" aria-hidden />
    </button>
  );
}
