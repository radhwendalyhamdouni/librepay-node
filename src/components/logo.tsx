import Link from "next/link";

/**
 * Unified LibrePay logo: ⚡ bolt chip + "LibrePay" wordmark.
 * The bolt is an inline SVG (not an emoji) so it renders identically
 * on every platform/OS — consistent with the ⚡ used in the repo description.
 */
export function Logo({ href = "/", size = "md" }: { href?: string; size?: "sm" | "md" }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-extrabold tracking-tight">
      <span
        aria-hidden="true"
        className={`grid place-items-center rounded-lg bg-primary-foreground text-[#fbbf24] ring-1 ring-primary/40 ${
          size === "sm" ? "h-6 w-6" : "h-8 w-8"
        }`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} aria-hidden="true">
          <path d="M13.12 2.09a.5.5 0 0 0-.87.33l-1.5 8.08H5.4a.5.5 0 0 0-.4.8l6.88 8.61a.5.5 0 0 0 .87-.33l1.5-8.08h5.35a.5.5 0 0 0 .4-.8l-6.88-8.61Z" />
        </svg>
      </span>
      <span className={size === "sm" ? "text-base" : "text-lg"}>
        Libre<span className="text-primary">Pay</span>
      </span>
    </Link>
  );
}
