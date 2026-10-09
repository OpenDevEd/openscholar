/**
 * A thin ring over its parent's box, filled clockwise from the top to `value` (0 to 1) in
 * `color`. `dashed` draws the whole track in that colour, broken, for something queued.
 */
export function Ring({ value, color, dashed = false }: { value: number; color: string; dashed?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 36 36" fill="none" className="pointer-events-none absolute inset-0 size-full -rotate-90">
      <circle cx="18" cy="18" r="17" strokeWidth="2" className={dashed ? undefined : "stroke-foreground/[0.06]"} style={dashed ? { stroke: color } : undefined} strokeDasharray={dashed ? "2.5 3.2" : undefined} />
      {value > 0 && !dashed ? (
        <circle cx="18" cy="18" r="17" strokeWidth="2" strokeLinecap="round" pathLength={100} strokeDasharray={`${Math.max(value * 100, 4)} 100`} style={{ stroke: color }} />
      ) : null}
    </svg>
  );
}
