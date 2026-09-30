"use client";

// A running extraction: a table that fills in cell by cell as the job reads each
// paper, with gaps marked where the abstract doesn't say, then the findings.

import { motion } from "motion/react";
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
      <div className="border-t border-border/50">
        <div className="grid grid-cols-[1.5rem_1fr_1fr_1fr] gap-x-4 px-4 py-2.5 text-[11px] font-medium text-muted-foreground">
          <span />
          {EXTRACT_FIELDS.map((f) => (
            <span key={f.key}>{f.label}</span>
          ))}
        </div>
        {EXTRACT_ROWS.map((row, r) => (
          // The paper leads its row; its values sit under it, in the header's columns.
          <div key={row.cite} className="grid grid-cols-[1.5rem_1fr_1fr_1fr] items-start gap-x-4 gap-y-1.5 border-t border-border/40 px-4 py-3.5">
            <Cite n={row.cite} />
            <p className="col-span-3 flex h-[18px] min-w-0 items-center gap-2 text-xs font-medium text-foreground/80">
              <span className="truncate">{row.paper}</span>
              {row.needsPdf && filled >= (r + 1) * EXTRACT_FIELDS.length ? (
                <motion.span
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-px text-[11px] text-amber-700 dark:text-amber-300"
                >
                  <FileSearch className="size-3" /> Needs the PDF
                </motion.span>
              ) : null}
            </p>
            {EXTRACT_FIELDS.map((f, c) => {
              const cell = row[f.key];
              const shown = r * EXTRACT_FIELDS.length + c < filled;
              return (
                // The value is laid out from the start, invisible, so the row has its final height before it arrives.
                <div key={f.key} className={cn("relative text-xs leading-relaxed", c === 0 && "col-start-2")}>
                  <motion.span
                    aria-hidden={!shown}
                    initial={false}
                    animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : 3 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className={cn("block", cell.missing ? "italic text-muted-foreground" : "text-foreground/90")}
                  >
                    {cell.value}
                  </motion.span>
                  <motion.span
                    aria-hidden
                    initial={false}
                    animate={{ opacity: shown ? 0 : 1 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-0 top-[5px] h-2.5 w-4/5 rounded-full bg-foreground/[0.07]"
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
