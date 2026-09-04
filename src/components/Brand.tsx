import { BRAND } from '@/lib/brand';

/**
 * The mark: a page of prose whose last line resolves into a tick.
 *
 * Three lines of text and one of them finishing as a check is the whole
 * product in a glyph — say it, and it is done. Drawn in currentColor so it
 * sits on any surface, with the tick in the accent when one is available.
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={BRAND.name}
    >
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="currentColor" />
      <path
        d="M9 10.5h14M9 16h9"
        stroke="var(--brand-paper, #fff)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M9 21.5h4l2.6 2.6 6.4-6.4"
        fill="none"
        stroke="var(--brand-accent-on-ink, #5FD4CF)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mark plus wordmark, for headers. */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="wordmark">
      <BrandMark size={size} className="wordmark__mark" />
      <span className="wordmark__name">{BRAND.name}</span>
    </span>
  );
}
