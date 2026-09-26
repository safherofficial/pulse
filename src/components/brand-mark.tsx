export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" className="fill-bg stroke-line" strokeWidth="1" />
      <path
        d="M4.5 18h6.2l2.2-6.1 3.4 11.4 2.3-5.3H27.5"
        fill="none"
        className="stroke-accent"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
