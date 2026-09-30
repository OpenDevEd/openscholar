"use client";

// A running extraction: a table that fills in cell by cell as the job reads each
// paper, with gaps marked where the abstract doesn't say, then the findings.

import { AnimatePresence, motion } from "motion/react";
import { Coins, ExternalLink, FileSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE } from "@/components/settings/model-map";
import { KindTile, WorkingText } from "./run-map";
import { EXTRACT_CREDITS, EXTRACT_FIELDS, EXTRACT_ROWS } from "./data";

export const EXTRACT_CELLS = EXTRACT_ROWS.length * EXTRACT_FIELDS.length;

/** A numbered citation, matching the row it comes from. */
export function Cite({ n }: { n: number }) {
  return (
    <span className="mx-0.5 inline-flex h-[18px] min-w-[18px] translate-y-[-1px] items-center justify-center rounded-md bg-[color-mix(in_oklab,#fb923c_18%,transparent)] px-1 align-middle text-[11px] font-semibold tabular-nums text-[#fb923c]">
      {n}
    </span>
  );
}

export function ExtractionCard({ filled, stopped }: { filled: number; stopped?: boolean }) {
  const finished = filled >= EXTRACT_CELLS;
  const papers = Math.floor(filled / EXTRACT_FIELDS.length);
  const credits = Math.round((filled / EXTRACT_CELLS) * EXTRACT_CREDITS);
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-muted/40">
      <div className="flex items-center gap-3 p-4 pb-3">
        <KindTile kind="extraction" working={!finished && !stopped} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {finished ? "Extracted from 4 papers" : stopped ? `Stopped at ${papers} of 4 papers` : <WorkingText>Extracting from 4 papers</WorkingText>}
          </p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Coins className="size-3" /> <span className="tabular-nums">{credits}</span> credits
          </p>
        </div>
        <button type="button" className="flex items-center gap-1 text-xs font-medium text-foreground/80 hover:text-foreground">
          Open <ExternalLink className="size-3" />
        </button>
      </div>
      {/* Every cell has its final size from the start, so values arriving never move the table. */}
      <div className="border-t border-border/50">
        <div className="grid grid-cols-[1.5rem_1fr_1fr_1fr] gap-x-3 px-4 py-2 text-[11px] font-medium text-muted-foreground">
          <span />
          {EXTRACT_FIELDS.map((f) => (
            <span key={f.key}>{f.label}</span>
          ))}
        </div>
        {EXTRACT_ROWS.map((row, r) => (
          <div key={row.cite} className="grid grid-cols-[1.5rem_1fr_1fr_1fr] items-start gap-x-3 border-t border-border/40 px-4 py-2.5">
            <Cite n={row.cite} />
            {EXTRACT_FIELDS.map((f, c) => {
              const cell = row[f.key];
              const shown = r * EXTRACT_FIELDS.length + c < filled;
              return (
                <div key={f.key} className="min-h-8 text-xs leading-snug">
                  <AnimatePresence mode="wait" initial={false}>
                    {shown ? (
                      <motion.span
                        key="value"
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: EASE }}
                        className={cn("block", cell.missing ? "italic text-muted-foreground" : "text-foreground/90")}
                      >
                        {cell.value}
                      </motion.span>
                    ) : (
                      <motion.span
                        key="pending"
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className="mt-1 block h-2.5 w-4/5 rounded-full bg-foreground/[0.07]"
                      />
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            <p className="col-span-3 col-start-2 mt-1 truncate text-[11px] text-muted-foreground">
              {row.paper}
              {row.needsPdf && filled >= (r + 1) * EXTRACT_FIELDS.length ? (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-px font-medium text-amber-700 dark:text-amber-300">
                  <FileSearch className="size-3" /> Needs the PDF
                </span>
              ) : null}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
