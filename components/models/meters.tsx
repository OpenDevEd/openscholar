// A model's three measures, each with one look everywhere: intelligence is a
// horizontal fill with its index, reasoning effort is rising bars, and cost is
// its price or a $ scale.

import { cn } from "@/lib/utils";
import type { Effort } from "@/lib/ai/core/call-options";

export const money = (n: number) => (n >= 10 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(1).replace(/\.0$/, "")}` : `$${n.toFixed(2)}`);

/** Price per 1M tokens, input then output. */
export const priceLabel = (input: number, output: number) => `${money(input)} / ${money(output)}`;

/** The Intelligence Index tops out in the high 50s today; a full meter means 60. */
const INTELLIGENCE_SCALE = 60;

/**
 * Artificial Analysis Intelligence Index as a filled track and its number. A model
 * with no score shows the empty track, so rows still line up.
 */
export function IntelligenceMeter({ index, className }: { index?: number | null; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-foreground/10">
        {index != null ? (
          <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (index / INTELLIGENCE_SCALE) * 100)}%` }} />
        ) : null}
      </span>
      <span className="w-5 text-right text-xs tabular-nums text-foreground/80">{index != null ? Math.round(index) : null}</span>
    </span>
  );
}

/** Reasoning effort as rising bars, out of the levels the model takes; "none" fills none. */
export function EffortMeter({ levels, level, filled = "bg-primary", small }: { levels: Effort[]; level: Effort; filled?: string; small?: boolean }) {
  const scale: Effort[] = levels.filter((l) => l !== "none");
  const on = scale.indexOf(level) + 1;
  const [low, high] = small ? [3, 10] : [5, 16];
  return (
    <span className={cn("flex items-end", small ? "h-2.5 gap-[2px]" : "h-4 gap-[3px]")} aria-hidden>
      {scale.map((l, i) => (
        <span
          key={l}
          className={cn("rounded-full", small ? "w-[2px]" : "w-[3px]", i < on ? filled : "bg-foreground/15")}
          style={{ height: `${low + (i * (high - low)) / Math.max(1, scale.length - 1)}px` }}
        />
      ))}
    </span>
  );
}

/** Cost as $ to $$$$, on a log scale from $0.05 to $50 per 1M tokens (input and output blended 1:3); free shows none. */
export function PriceScale({ input, output, className }: { input: number; output: number; className?: string }) {
  const blended = (input + output * 3) / 4;
  const level = blended <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(((Math.log10(blended) + 1.3) / 3) * 4)));
  return (
    <span className={cn("flex text-xs font-semibold tracking-tight", className)} aria-hidden>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={i <= level ? "text-foreground/80" : "text-foreground/20"}>
          $
        </span>
      ))}
    </span>
  );
}
