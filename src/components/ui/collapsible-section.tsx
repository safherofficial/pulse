import { ChevronDown } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { collapsibleAria, toggleOpen } from "@/lib/xpulse/ui-behavior";

export function CollapsibleSection({
  title,
  kicker,
  badge,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
  contentClassName,
  activityKey,
}: {
  title: string;
  kicker?: string;
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  contentClassName?: string;
  /** A changing key means new activity is available while the section is closed. */
  activityKey?: string | number | null;
}) {
  const reactId = useId();
  const panelId = `section-${reactId}`;
  const labelId = `section-label-${reactId}`;
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const [unseen, setUnseen] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const activityStorageKey = activityKey == null ? null : `xpulse.section.seen.${panelId}`;

  useEffect(() => {
    if (activityKey == null || typeof window === "undefined") return;
    const seen = window.localStorage.getItem(activityStorageKey!);
    setUnseen(seen !== String(activityKey));
  }, [activityKey, activityStorageKey]);

  function onToggle() {
    const next = toggleOpen(open);
    onOpenChange?.(next);
    if (next && activityKey != null) {
      setUnseen(false);
      if (typeof window !== "undefined" && activityStorageKey) {
        window.localStorage.setItem(activityStorageKey, String(activityKey));
      }
    }
    if (controlledOpen === undefined) setUncontrolled(next);
  }

  const aria = collapsibleAria(open, panelId);

  return (
    <section className={cn("panel overflow-hidden", className)}>
      <h2 className="m-0">
        <button
          type="button"
          id={labelId}
          className="flex w-full items-center gap-3 px-4 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:px-5"
          aria-expanded={aria["aria-expanded"]}
          aria-controls={aria["aria-controls"]}
          onClick={onToggle}
        >
          <span className="min-w-0 flex-1">
            {kicker ? <span className="kicker block">{kicker}</span> : null}
            <span className={cn("block text-xl", kicker && "mt-1")}>{title}</span>
          </span>
          {unseen ? <span aria-label="New activity" title="New activity" className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_currentColor]" /> : null}
          {badge ? <span className="shrink-0">{badge}</span> : null}
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 text-accent transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
      </h2>
      <div
        id={panelId}
        role="region"
        aria-labelledby={labelId}
        aria-hidden={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className={cn("overflow-hidden", !open && "invisible")}>
          <div className={cn("space-y-3 px-4 pb-5 sm:px-5", contentClassName)} inert={open ? undefined : true}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
