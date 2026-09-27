/** Scroll-to-top and collapsible section behavior shared by the shell. */

export const SCROLL_TOP_THRESHOLD = 480;

export function shouldShowScrollTop(scrollY: number): boolean {
  return Number.isFinite(scrollY) && scrollY > SCROLL_TOP_THRESHOLD;
}

export function scrollPageToTop(target: { scrollTo: (options: ScrollToOptions) => void }): void {
  target.scrollTo({ top: 0, behavior: "smooth" });
}

export function toggleOpen(open: boolean): boolean {
  return !open;
}

export function collapsibleAria(open: boolean, panelId: string): {
  "aria-expanded": boolean;
  "aria-controls": string;
} {
  return { "aria-expanded": open, "aria-controls": panelId };
}
