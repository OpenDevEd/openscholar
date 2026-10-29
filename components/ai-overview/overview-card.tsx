"use client";

// Mock (mock/ai-overview): an AI overview of the search on screen, read through a lens the person
// picks, written live by the Cheap preset's model (app/api/overview-mock/route.ts). On Go and above
// the open lens writes itself as results load and costs no credits, up to a daily cap; on the free
// plan it waits for Write overview and costs credits. The lens menu switches between the two.

import { useState } from "react";
import Link from "next/link";
import useSWRSubscription from "swr/subscription";
import { motion, useReducedMotion } from "motion/react";
import { AiIcon, ChevronDown, Coins, Copy, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, UpgradeIcon, Users } from "@/components/icons";
import { IconButton, WorkingText } from "@/components/assistant/parts";
import { RECORD_CHIP, recordChipStyle } from "@/components/assistant/mentions";
import { EASE } from "@/components/settings/model-map";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pills } from "@/components/ui/pills";
import { Ring } from "@/components/ui/progress-ring";
import { TooltipHint } from "@/components/ui/tooltip";
import { useSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import { useWorkspaceHref } from "@/lib/workspaces/href";
import { ChangeBars, PaperRows, ShareBars, YearBars } from "./charts";
import { LensDialog } from "./lens-dialog";
import { DAILY_CAP, useLenses, type Lens } from "./lenses";
import { blocksOf, plainText, subscribeRun, type Block, type Cite, type Run } from "./run";

const thisYear = new Date().getFullYear();

export function AiOverview() {
  const search = useSearch();
  const { lenses, open, collapsed, usedToday, freePlan: free, setFreePlan, pick, remove, toggle } = useLenses();
  const lens = lenses.find((l) => l.id === open) ?? lenses[0];
  const query = search.params.q;
  const filters = search.toSearchFilters();
  const [nonce, setNonce] = useState(0);
  const runKey = JSON.stringify([lens.id, lens.instruction, query, filters, nonce]);
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<{ lens: Lens | null } | null>(null);
  const wanted = !free || requested.has(runKey);
  const { data: run, error } = useSWRSubscription(wanted ? ["ai-overview", runKey, JSON.stringify({ query, filters, lens: { name: lens.name, instruction: lens.instruction } })] : null, subscribeRun);
  const working = wanted && !error && !run?.done;
  const blocks = run ? blocksOf(run.text, !run.done) : [];

  // The first overview streams in a paragraph at a time. After that, the last one written stays, dimmed, until the
  // next is whole, so the card never empties and a chart never gives way to a half-written paragraph.
  const [last, setLast] = useState<{ key: string; run: Run } | null>(null);
  if (run?.done && !run.error && last?.key !== runKey) setLast({ key: runKey, run });
  const shown = run && (run.done || !last) && blocks.length ? { key: runKey, run } : working ? last : null;
  const shownBlocks = shown ? blocksOf(shown.run.text, !shown.run.done) : [];
  const failure = error?.message ?? run?.error;

  return (
    <section aria-label="AI overview" className="mb-6 rounded-2xl border border-border-subtle bg-card shadow-surface">
      <header className="flex items-center gap-2 py-2.5 pr-2.5 pl-4">
        <AiIcon size={18} working={working} className="shrink-0" />
        <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] mask-r-from-[calc(100%-2rem)]">
          <div className="w-max">
            <Pills label="Lens" value={lens.id} onChange={pick} options={lenses.map((l) => ({ id: l.id, label: l.name, icon: l.shared ? Users : undefined }))} />
          </div>
        </div>
        {free ? null : <CapRing usedToday={usedToday} />}
        {/* Named in words where there's room, so it needs no tooltip. */}
        <button type="button" aria-label="New lens" onClick={() => setEditing({ lens: null })} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:px-2.5">
          <Plus className="size-4" />
          <span className="hidden sm:inline">New lens</span>
        </button>
        <DropdownMenu>
          <TooltipHint label="Lens options">
            <DropdownMenuTrigger aria-label="Lens options" className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
          </TooltipHint>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={!blocks.length || !run?.done} onSelect={() => navigator.clipboard.writeText(plainText(blocks))}>
              <Copy /> Copy overview
            </DropdownMenuItem>
            <DropdownMenuItem disabled={working || !wanted} onSelect={() => setNonce((n) => n + 1)}>
              <RefreshCw /> Write again
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {lens.mine ? (
              <DropdownMenuItem onSelect={() => setEditing({ lens })}>
                <Pencil /> Edit lens
              </DropdownMenuItem>
            ) : null}
            {lens.mine && lens.id !== "overview" ? (
              <DropdownMenuItem onSelect={() => useLenses.getState().save({ ...lens, shared: !lens.shared })}>
                <Users /> {lens.shared ? "Stop sharing" : "Share with workspace"}
              </DropdownMenuItem>
            ) : null}
            {lens.id !== "overview" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => remove(lens.id)}>
                  <Trash2 /> {lens.mine ? "Delete lens" : "Remove from my lenses"}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setFreePlan(!free)}>
              <UpgradeIcon /> {free ? "Mock: show Go plan" : "Mock: show free plan"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* One name in both states, so its tooltip doesn't change words as it closes on the click. */}
        <TooltipHint label="Show or hide overview">
          <button type="button" aria-label="Show or hide overview" aria-expanded={!collapsed} onClick={toggle} className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronDown className={cn("size-4 transition-transform duration-300", !collapsed && "rotate-180")} />
          </button>
        </TooltipHint>
      </header>

      <AutoHeight>
        {collapsed ? null : (
          <div className="px-5 pb-4">
            {working || shown ? (
              // One line for the whole run: its steps while it works, then what it read. A grid stretches the label across
              // the line, so it keeps its width as its words change.
              <p className="grid pb-2 text-sm text-muted-foreground">
                {working ? <WorkingText>{run?.step ?? "Reading the results"}</WorkingText> : <span>{shown ? readOf(shown.run) : null}</span>}
              </p>
            ) : null}
            {failure ? (
              <div className="flex items-center gap-3 py-1 text-sm text-muted-foreground">
                <span className="flex-1">The overview didn&apos;t finish: {failure}</span>
                <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}>
                  <RefreshCw /> Try again
                </Button>
              </div>
            ) : shown ? (
              <div inert={shown.key !== runKey} className={cn("transition-opacity duration-300", shown.key !== runKey && "opacity-40")}>
                <Written key={shown.key} blocks={shownBlocks} run={shown.run} />
              </div>
            ) : !wanted ? (
              <Ask total={search.totalCount} onGenerate={() => setRequested((s) => new Set(s).add(runKey))} />
            ) : null}
          </div>
        )}
      </AutoHeight>

      <LensDialog lens={editing?.lens ?? null} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
    </section>
  );
}

/** The free plan's start: the overview waits to be asked for, and says what it costs. */
function Ask({ total, onGenerate }: { total: number; onGenerate: () => void }) {
  const href = useWorkspaceHref();
  return (
    <div className="flex flex-wrap items-center gap-3 py-1">
      <Button size="sm" variant="ai" onClick={onGenerate}>
        <AiIcon size={14} /> Write overview
        <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          <Coins className="size-3.5" /> 2
        </span>
      </Button>
      <span className="text-sm text-muted-foreground">Reads all {total.toLocaleString("en")} results</span>
      <Link href={href("/pricing")} className="ml-auto flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <UpgradeIcon className="size-4" /> Free and automatic on Go
      </Link>
    </div>
  );
}

function Written({ blocks, run }: { blocks: Block[]; run: Run }) {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => (
        <motion.div key={i} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE }}>
          <BlockView block={block} run={run} />
        </motion.div>
      ))}
    </div>
  );
}

const GROUP_LABEL: Record<string, string> = { year: "year", country: "country", type: "type", field: "field", topic: "topic", openAccess: "open access", journal: "journal", institution: "institution", funder: "funder", language: "language", sdg: "SDG" };

function BlockView({ block, run }: { block: Block; run: Run }) {
  if (block.kind === "text") return <p className="text-[0.9375rem] leading-relaxed text-foreground">{block.parts.map((part, i) => (typeof part === "string" ? part : <CiteChip key={i} cite={part} run={run} />))}</p>;
  if (block.kind === "papers") {
    const list = run.lists[block.id];
    return list ? <PaperRows papers={list.papers} /> : null;
  }
  const count = run.counts[block.id];
  if (!count) return null;
  const span = count.years ? ` in ${count.years.from ?? ""}–${count.years.to ?? ""}` : "";
  if (count.by === "year") {
    // A year still running is left out of a year-on-year chart: its count only grows.
    const full = count.groups.filter((g) => Number(g.key) < thisYear);
    if (!block.change) return <YearBars groups={full.slice(-20)} label={`Papers per year${span}`} />;
    const change = full.slice(1).map((g, i) => ({ ...g, count: full[i].count ? Math.round(((g.count - full[i].count) / full[i].count) * 100) : 0 })).slice(-12);
    return <ChangeBars groups={change} />;
  }
  const groups = count.by === "openAccess" ? count.groups.map((g) => ({ ...g, name: g.key === "true" ? "Free to read" : "Not free" })) : count.groups;
  return <ShareBars groups={groups.slice(0, 8)} total={count.total} label={`Share of papers by ${GROUP_LABEL[count.by] ?? count.by}${span}`} />;
}

/** A cited paper as the assistant's record chip, in the words the model chose; the full title shows on hover. */
function CiteChip({ cite, run }: { cite: Cite; run: Run }) {
  const paper = Object.values(run.lists)
    .flatMap((l) => l.papers)
    .find((p) => p.id === cite.id);
  return (
    <TooltipHint label={paper ? `${paper.title} (${paper.year})` : undefined}>
      <a href={`https://openalex.org/works/${cite.id}`} target="_blank" rel="noreferrer" className={cn(RECORD_CHIP, "text-sm hover:underline")} style={recordChipStyle("var(--primary)")}>
        {cite.text}
      </a>
    </TooltipHint>
  );
}

function CapRing({ usedToday }: { usedToday: number }) {
  const left = Math.max(0, DAILY_CAP - usedToday);
  return (
    <TooltipHint label={`${left} of ${DAILY_CAP} free overviews left today`}>
      <span tabIndex={0} className="relative flex size-6 shrink-0 items-center justify-center text-[10px] font-medium tabular-nums text-muted-foreground" aria-label={`${left} of ${DAILY_CAP} free overviews left today`}>
        <Ring value={left / DAILY_CAP} color="var(--primary)" />
        {left}
      </span>
    </TooltipHint>
  );
}

/** What a run read, in a line: the groupings it counted by and the papers it opened. */
function readOf(run: Run) {
  const by = [...new Set(Object.values(run.counts).map((c) => GROUP_LABEL[c.by] ?? c.by))];
  const papers = new Set(Object.values(run.lists).flatMap((l) => l.papers.map((p) => p.id))).size;
  const parts = [by.length ? `Counted papers by ${by.length > 1 ? `${by.slice(0, -1).join(", ")} and ${by.at(-1)}` : by[0]}` : "", papers ? `read ${papers} ${papers === 1 ? "paper" : "papers"}` : ""].filter(Boolean);
  const line = parts.join(", ");
  return line ? line[0].toUpperCase() + line.slice(1) : "Read the results";
}
