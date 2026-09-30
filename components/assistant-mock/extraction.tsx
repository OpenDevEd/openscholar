"use client";

// A running extraction that fills in as the job reads each paper, with gaps marked
// where the abstract doesn't say, then the findings.

import { useState } from "react";
import { motion } from "motion/react";
import { Coins, ExternalLink, FileSearch, FlaskConical, MapPin, Users } from "lucide-react";
import { Segmented } from "@/components/settings/parts";
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

const FIELD_ICONS = { design: FlaskConical, setting: MapPin, sample: Users } as const;
type FieldKey = (typeof EXTRACT_FIELDS)[number]["key"];

/**
 * A running extraction, read one field at a time: pick Design, Country and grades
 * or Sample, and the four papers line up under it for comparison. Each row holds the
 * height of its longest value, so switching fields or values arriving never moves it.
 */
export function ExtractionCard({ filled, stopped }: { filled: number; stopped?: boolean }) {
  const [field, setField] = useState<FieldKey>("design");
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
      <div className="px-3 pb-3">
        <Segmented
          label="Field"
          value={field}
          onChange={setField}
          fill
          options={EXTRACT_FIELDS.map((f) => ({ id: f.key, label: f.label, icon: FIELD_ICONS[f.key] }))}
        />
        <ol className="mt-2 space-y-0.5">
          {EXTRACT_ROWS.map((row, r) => (
            <li key={row.cite} className="flex gap-3 rounded-xl px-2 py-2.5">
              <span className="flex h-5 items-center">
                <Cite n={row.cite} />
              </span>
              <div className="min-w-0 flex-1">
                {/* Every field's value shares one cell; only the picked one shows. */}
                <div className="grid text-sm leading-snug [&>*]:col-start-1 [&>*]:row-start-1">
                  {EXTRACT_FIELDS.map((f, c) => {
                    const cell = row[f.key];
                    const on = f.key === field;
                    const shown = r * EXTRACT_FIELDS.length + c < filled;
                    return (
                      <div key={f.key} className="relative" aria-hidden={!on}>
                        <motion.span
                          initial={false}
                          animate={{ opacity: on && shown ? 1 : 0, y: on && shown ? 0 : 3 }}
                          transition={{ duration: 0.25, ease: EASE }}
                          className={cn("block", cell.missing ? "italic text-muted-foreground" : "font-medium text-foreground")}
                        >
                          {cell.value}
                        </motion.span>
                        <motion.span
                          aria-hidden
                          initial={false}
                          animate={{ opacity: on && !shown ? 1 : 0 }}
                          transition={{ duration: 0.15 }}
                          className="absolute left-0 top-1 h-3 w-3/5 rounded-full bg-foreground/[0.07]"
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1 flex h-[18px] min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{row.paper}</span>
                  {row.needsPdf && filled >= (r + 1) * EXTRACT_FIELDS.length ? (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-px text-[11px] font-medium text-amber-700 dark:text-amber-300"
                    >
                      <FileSearch className="size-3" /> Needs the PDF
                    </motion.span>
                  ) : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
