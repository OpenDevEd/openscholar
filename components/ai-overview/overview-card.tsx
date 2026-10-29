"use client";

// Mock (mock/ai-overview): an AI overview of the search on screen, read through a lens the person
// picks. On Go and above the open lens writes itself as results load and costs no credits, up to a
// daily cap; on the free plan it waits for Generate and costs credits. `?plan=free` shows that.

import { useEffect, useState } from "react";
import useSWR from "swr";
import { motion, useReducedMotion } from "motion/react";
import { overviewData } from "@/app/actions/overview-mock";
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
import Link from "next/link";
import { useWorkspaceHref } from "@/lib/workspaces/href";
import { ChangeBars, PaperRows, ShareBars, YearBars } from "./charts";
import { LensDialog } from "./lens-dialog";
import { DAILY_CAP, useLenses, type Lens } from "./lenses";
import { plainText, write, type Block, type Part } from "./write";

/** How long the mock's model reads before it writes. */
const READING_MS = 1600;
const STEPS: Record<Lens["angle"], string> = {
  overview: "Counting papers by year and type",
  trend: "Counting papers in each year",
  geography: "Counting papers by country",
  landmarks: "Reading the most cited papers",
};

export function AiOverview() {
  const search = useSearch();
  const { lenses, open, collapsed, usedToday, freePlan: free, setFreePlan, pick, remove, toggle, spend } = useLenses();
  const lens = lenses.find((l) => l.id === open) ?? lenses[0];
  const query = search.params.q;
  const filters = search.toSearchFilters();
  const searchKey = JSON.stringify([query, filters]);
  const { data, error } = useSWR(["ai-overview", searchKey], () => overviewData(query, filters), { keepPreviousData: true, revalidateOnFocus: false });
  const runKey = `${lens.id}:${lens.instruction}:${searchKey}`;
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  const [written, setWritten] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<{ lens: Lens | null } | null>(null);
  const wanted = !free || requested.has(runKey);
  const ready = data !== undefined;
  const done = written.has(runKey);
  const reading = wanted && !done;

  // A timer: the mock's stand-in for the model's run.
  useEffect(() => {
    if (!wanted || done || !ready) return;
    const timer = setTimeout(() => {
      setWritten((s) => new Set(s).add(runKey));
      // The free plan pays in credits; Go and above count against the daily cap.
      if (!free) spend();
    }, READING_MS);
    return () => clearTimeout(timer);
  }, [wanted, done, ready, runKey, spend, free]);

  const blocks = done && data ? write(lens.angle, data) : null;
  // The last overview written stays, dimmed, while the next one is read, so the card never empties.
  const [last, setLast] = useState<{ key: string; blocks: Block[] } | null>(null);
  if (blocks && last?.key !== runKey) setLast({ key: runKey, blocks });
  const shown = blocks ? { key: runKey, blocks } : reading ? last : null;
  const regenerate = () => {
    setWritten((s) => {
      const next = new Set(s);
      next.delete(runKey);
      return next;
    });
  };

  return (
    <section aria-label="AI overview" className="mb-6 rounded-2xl border border-border-subtle bg-card shadow-surface">
      <header className="flex items-center gap-2 py-2.5 pr-2.5 pl-4">
        <AiIcon size={18} working={reading} className="shrink-0" />
        <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] mask-r-from-[calc(100%-2rem)]">
          <div className="w-max">
          <Pills
            label="Lens"
            value={lens.id}
            onChange={pick}
            options={lenses.map((l) => ({ id: l.id, label: l.name, icon: l.shared ? Users : undefined }))}
          />
          </div>
        </div>
        <IconButton label="New lens" icon={<Plus className="size-4" />} onClick={() => setEditing({ lens: null })} />
        <DropdownMenu>
          <TooltipHint label="Lens options">
            <DropdownMenuTrigger aria-label="Lens options" className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
          </TooltipHint>
          <DropdownMenuContent align="end" className="w-56">
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
        <IconButton label={collapsed ? "Show overview" : "Hide overview"} icon={<ChevronDown className={cn("size-4 transition-transform duration-300", !collapsed && "rotate-180")} />} onClick={toggle} />
      </header>

      <AutoHeight>
        {collapsed ? null : (
          <div className="px-5 pb-4">
            <AutoHeight>
            {error ? (
              <p className="text-sm text-muted-foreground">OpenAlex didn&apos;t answer. Try again in a moment.</p>
            ) : data === null ? (
              <p className="text-sm text-muted-foreground">A search written in OQL can&apos;t be counted yet, so it has no overview.</p>
            ) : shown ? (
              <div inert={!blocks} className={cn("transition-opacity duration-300", !blocks && "opacity-40")}>
                <Written key={shown.key} blocks={shown.blocks} />
              </div>
            ) : reading ? (
              <p className="py-1 text-sm">
                <WorkingText>{STEPS[lens.angle]}</WorkingText>
              </p>
            ) : (
              <Ask total={search.totalCount} onGenerate={() => setRequested((s) => new Set(s).add(runKey))} />
            )}
            </AutoHeight>
            {shown ? (
              <motion.div inert={!blocks} initial={{ opacity: 0 }} animate={{ opacity: blocks ? 1 : 0.4 }} transition={{ duration: 0.3, ease: EASE }}>
                <Footer total={data?.total ?? 0} free={free} usedToday={usedToday} onRegenerate={regenerate} onCopy={() => navigator.clipboard.writeText(plainText(shown.blocks))} />
              </motion.div>
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

function Written({ blocks }: { blocks: Block[] }) {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => (
        <motion.div key={i} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE, delay: i * 0.12 }}>
          <BlockView block={block} />
        </motion.div>
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "text":
      return <p className="text-[0.9375rem] leading-relaxed text-foreground">{block.parts.map((part, i) => <PartView key={i} part={part} />)}</p>;
    case "years":
      return <YearBars groups={block.groups} />;
    case "change":
      return <ChangeBars groups={block.groups} />;
    case "shares":
      return <ShareBars groups={block.groups} total={block.total} />;
    case "papers":
      return <PaperRows papers={block.papers} />;
  }
}

/** A cited paper as the assistant's record chip, by the start of its title; the whole title shows on hover. */
function PartView({ part }: { part: Part }) {
  if (typeof part === "string") return part;
  const words = part.cite.title.split(" ");
  const short = words.length > 6 ? `${words.slice(0, 6).join(" ")}…` : part.cite.title;
  return (
    <TooltipHint label={`${part.cite.title} (${part.cite.year})`}>
      <a href={`https://openalex.org/works/${part.cite.id}`} target="_blank" rel="noreferrer" className={cn(RECORD_CHIP, "text-sm hover:underline")} style={recordChipStyle("var(--primary)")}>
        {short}
      </a>
    </TooltipHint>
  );
}

function Footer({ total, free, usedToday, onRegenerate, onCopy }: { total: number; free: boolean; usedToday: number; onRegenerate: () => void; onCopy: () => void }) {
  const left = DAILY_CAP - usedToday;
  return (
    <div className="mt-3 flex items-center gap-1">
      <span className="flex-1 text-xs text-muted-foreground">From all {total.toLocaleString("en")} results.</span>
      {free ? null : (
        <TooltipHint label={`${left} of ${DAILY_CAP} free overviews left today`}>
          <span className="relative mr-1 flex size-6 items-center justify-center text-[10px] font-medium tabular-nums text-muted-foreground" aria-label={`${left} free overviews left today`}>
            <Ring value={left / DAILY_CAP} color="var(--primary)" />
            {left}
          </span>
        </TooltipHint>
      )}
      <IconButton small label="Copy" icon={<Copy className="size-3.5" />} onClick={onCopy} />
      <IconButton small label="Write again" icon={<RefreshCw className="size-3.5" />} onClick={onRegenerate} />
    </div>
  );
}
