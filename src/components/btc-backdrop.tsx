/**
 * Animated ₿ backdrop for public-facing pages.
 * Pure CSS — no JS cost. Glyphs sit behind all content (-z-10),
 * never capture pointer events and are skipped by screen readers.
 * Motion is disabled for users who prefer reduced motion (see globals.css).
 */

const COINS: { start: string; top: string; size: number; dur: string; delay: string; op: number; rot: number }[] = [
  { start: "3%",  top: "9%",  size: 150, dur: "21s",  delay: "0s",    op: 0.050, rot: -10 },
  { start: "78%", top: "4%",  size: 90,  dur: "17s",  delay: "-6s",   op: 0.045, rot: 12 },
  { start: "88%", top: "46%", size: 190, dur: "26s",  delay: "-11s",  op: 0.040, rot: -6 },
  { start: "10%", top: "58%", size: 110, dur: "19s",  delay: "-3s",   op: 0.055, rot: 8 },
  { start: "55%", top: "74%", size: 80,  dur: "15s",  delay: "-8s",   op: 0.045, rot: -14 },
  { start: "38%", top: "28%", size: 60,  dur: "14s",  delay: "-2s",   op: 0.060, rot: 10 },
];

export function BtcBackdrop() {
  return (
    <div className="btc-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none" aria-hidden="true">
      {COINS.map((c, i) => (
        <span
          key={i}
          className="absolute font-black leading-none text-primary"
          style={{
            insetInlineStart: c.start,
            top: c.top,
            fontSize: c.size,
            opacity: c.op,
            animationDuration: c.dur,
            animationDelay: c.delay,
            ["--btc-rot" as string]: `${c.rot}deg`,
          }}
        >
          ₿
        </span>
      ))}
    </div>
  );
}
