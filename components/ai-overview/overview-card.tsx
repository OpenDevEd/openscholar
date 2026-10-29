"use client";

// An AI overview of the search on screen (#967), read through a lens the person picks and written by the Cheap preset's
// model in Convex (convex/research/overviewsAction.ts). On a plan with free overviews the open lens writes itself, and
// past them, or without them, it waits for Write overview and costs credits. Folded, nothing is written: that's how a
// person pauses it.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import useSWRSubscription from "swr/subscription";
import { useConvex, useMutation } from "convex/react";
import { motion, useReducedMotion } from "motion/react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Grouping } from "@/convex/research/searchValidators";
import { readCitedPapers } from "@/app/actions/overview-papers";
import { AiIcon, ChevronDown, Coins, Copy, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, UpgradeIcon, Users } from "@/components/icons";
import { WorkingText } from "@/components/assistant/parts";
import { RECORD_CHIP, recordChipStyle } from "@/components/assistant/mentions";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { EASE } from "@/components/settings/model-map";
import { useSpendable } from "@/components/workspaces/credit-check";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pills } from "@/components/ui/pills";
import { Ring } from "@/components/ui/progress-ring";
import { TooltipHint } from "@/components/ui/tooltip";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useResearchScope } from "@/lib/research/reads";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import type { PaperResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspaceHref } from "@/lib/workspaces/href";
import { ChangeBars, PaperRows, ShareBars, YearBars } from "./charts";
import { openCited } from "./focus";
import { LensDialog, type Lens } from "./lens-dialog";
import { blocksOf, citedPapers, plainText, type Block, type Cite } from "./text";

type Scope = { accountId: string; workspaceId: Id<"workspaces"> };
type View = FunctionReturnType<typeof api.research.overviews.view>;
type Overview = NonNullable<FunctionReturnType<typeof api.research.overviews.get>["overview"]>;

/** Today in UTC, as the server counts a person's overviews: a new day starts them again. */
const today = () => new Date().toISOString().slice(0, 10);
/** When the day's free overviews come back: midnight UTC. */
const nextDay = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
};
const thisYear = new Date().getUTCFullYear();

/** Runs the open lens's overview once nothing is written for it, on a plan where it's free: a Convex mutation is the outside system. */
function subscribeEnsure(convex: ReturnType<typeof useConvex>) {
  return ([, scope, searchId, lens]: [string, Scope, string, string], { next }: { next: (error?: Error | null, data?: string) => void }) => {
    convex.mutation(api.research.overviews.ensure, { ...scope, searchId, lens }).then(
      (state) => next(null, state),
      (error: unknown) => next(error instanceof Error ? error : new Error(String(error))),
    );
    return () => {};
  };
}

export function AiOverview({ searchId }: { searchId: string }) {
  const scope = useResearchScope();
  const { data: view } = useProtectedQuery(api.research.overviews.view, scope ?? "skip");
  // Signed out there's no account to keep lenses in, and no overview.
  if (!scope || !view) return null;
  return <Card scope={scope} view={view} searchId={searchId} />;
}

function Card({ scope, view, searchId }: { scope: Scope; view: View; searchId: string }) {
  const t = useTranslations("overview");
  const toast = useAppToast();
  const convex = useConvex();
  const format = useFormatter();
  const lens = view.lenses.find((one) => one.id === view.open) ?? view.lenses[0];
  const setView = useMutation(api.research.overviews.setView).withOptimisticUpdate((store, { open, collapsed }) => {
    const current = store.getQuery(api.research.overviews.view, scope);
    if (current) store.setQuery(api.research.overviews.view, scope, { ...current, ...(open !== undefined ? { open } : {}), ...(collapsed !== undefined ? { collapsed } : {}) });
  });
  const ensure = useMutation(api.research.overviews.ensure);
  const removeLens = useMutation(api.research.overviews.removeLens);
  const saveLens = useMutation(api.research.overviews.saveLens);
  const [editing, setEditing] = useState<{ lens: Lens | null } | null>(null);

  const day = today();
  const freeUsed = view.day === day ? view.free : 0;
  const paidUsed = view.day === day ? view.paid : 0;
  const freeLeft = view.perDay === null ? null : Math.max(0, view.perDay - freeUsed);
  const free = freeLeft === null || freeLeft > 0;

  const { data: shown } = useProtectedQuery(api.research.overviews.get, view.collapsed ? "skip" : { ...scope, searchId, lens: lens.id });
  const overview = shown?.available ? shown.overview : null;
  // Free, an overview nothing has written is started as the card shows it.
  const { error: startError } = useSWRSubscription(shown?.available && !overview && free ? (["ai-overview", scope, searchId, lens.id] as [string, Scope, string, string]) : null, subscribeEnsure(convex));
  const working = Boolean(shown?.available && ((!overview && free && !startError) || overview?.status === "running"));

  // The last overview written stays, dimmed, until the next one is whole, so the card never empties and a chart never
  // gives way to a half-written paragraph. The first one shows its paragraphs as they're written.
  const key = `${searchId}:${lens.id}:${lens.version}`;
  const [last, setLast] = useState<{ key: string; overview: Overview } | null>(null);
  if (overview?.status === "done" && last?.key !== key) setLast({ key, overview });
  const live = overview && overview.status !== "failed" && overview.text && (overview.status === "done" || !last) ? { key, overview } : null;
  const showing = live ?? (working ? last : null);
  const blocks = showing ? blocksOf(showing.overview.text) : [];

  const run = async (args: { pay?: boolean; again?: boolean }) => {
    try {
      const state = await ensure({ ...scope, searchId, lens: lens.id, ...args });
      if (state === "limit") toast.error(t("label"), t("ask.limit", { count: view.paidPerDay, time: format.dateTime(nextDay(), { hour: "numeric", minute: "2-digit" }) }));
    } catch (error) {
      toast.error(t("label"), getErrorMessage(error, ""));
    }
  };

  return (
    <section aria-label={t("label")} className="mb-6 rounded-2xl border border-border-subtle bg-card shadow-surface">
      <header className="flex items-center gap-2 pt-3 pr-3 pb-2.5 pl-4">
        <AiIcon size={18} working={working} className="shrink-0" />
        <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] mask-r-from-[calc(100%-2rem)]">
          <div className="w-max">
            <Pills
              label={t("lens")}
              value={lens.id}
              onChange={(open) => void setView({ ...scope, open })}
              options={view.lenses.map((one) => ({ id: one.id, label: one.builtIn ? t(`lenses.${one.builtIn}`) : (one.name ?? ""), icon: one.shared ? Users : undefined }))}
            />
          </div>
        </div>
        {view.perDay ? <CapRing left={freeLeft ?? 0} perDay={view.perDay} /> : null}
        {/* Named in words where there's room, so it needs no tooltip. */}
        <button type="button" aria-label={t("newLens")} onClick={() => setEditing({ lens: null })} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:px-2.5">
          <Plus className="size-4" />
          <span className="hidden sm:inline">{t("newLens")}</span>
        </button>
        <DropdownMenu>
          <TooltipHint label={t("options")}>
            <DropdownMenuTrigger aria-label={t("options")} className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
          </TooltipHint>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={overview?.status !== "done"} onSelect={() => void navigator.clipboard.writeText(plainText(blocks))}>
              <Copy /> {t("copy")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={working || !shown?.available || view.collapsed} onSelect={() => void run({ again: true, ...(free ? {} : { pay: true }) })}>
              <RefreshCw /> {t("writeAgain")}
            </DropdownMenuItem>
            {lens.mine ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setEditing({ lens })}>
                  <Pencil /> {t("editLens")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void saveLens({ ...scope, id: lens.id, name: lens.name ?? "", instruction: lens.instruction, shared: !lens.shared }).catch((error) => toast.error(t("label"), getErrorMessage(error, "")))}>
                  <Users /> {lens.shared ? t("stopSharing") : t("share")}
                </DropdownMenuItem>
              </>
            ) : null}
            {lens.id !== "overview" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void removeLens({ ...scope, id: lens.id })}>
                  <Trash2 /> {lens.mine ? t("deleteLens") : t("hideLens")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* One name in both states, so its tooltip doesn't change words as it closes on the click. */}
        <TooltipHint label={t("fold")}>
          <button type="button" aria-label={t("fold")} aria-expanded={!view.collapsed} onClick={() => void setView({ ...scope, collapsed: !view.collapsed })} className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronDown className={cn("size-4 transition-transform duration-300", !view.collapsed && "rotate-180")} />
          </button>
        </TooltipHint>
      </header>

      <AutoHeight>
        {view.collapsed || !shown ? null : (
          <div className="px-4 pb-4">
            {!shown.available ? (
              <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
            ) : overview?.status === "failed" ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex-1">{t(`failed.${overview.error ?? "failed"}`)}</span>
                <Button size="sm" variant="outline" onClick={() => void run({ again: true, ...(free ? {} : { pay: true }) })}>
                  <RefreshCw /> {t("tryAgain")}
                </Button>
              </div>
            ) : working || showing ? (
              <>
                {/* One line for the whole run: its steps while it works, then what it read. A grid stretches the label
                    across the line, so it keeps its width as its words change. */}
                <p className="grid pb-2 text-sm text-muted-foreground">{working ? <WorkingText>{stepText(t, overview?.step)}</WorkingText> : <span>{showing ? <ReadText overview={showing.overview} /> : null}</span>}</p>
                {showing ? (
                  <div inert={showing.key !== key || showing.overview !== overview} className={cn("transition-opacity duration-300", showing.key !== key && "opacity-40")}>
                    <Written key={showing.key} blocks={blocks} overview={showing.overview} />
                  </div>
                ) : (
                  // Lines at the text's own height while nothing is written yet; the first paragraph takes their place.
                  <div aria-hidden>
                    {["w-full", "w-[94%]", "w-3/5"].map((width) => (
                      <div key={width} className="flex h-[1.5234rem] items-center">
                        <SkeletonBar className={width} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Ask view={view} freePlan={view.perDay === 0} paidUsed={paidUsed} onWrite={() => void run({ pay: true })} />
            )}
          </div>
        )}
      </AutoHeight>

      <LensDialog scope={scope} lens={editing?.lens ?? null} open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} />
    </section>
  );
}

/** What the model is doing, in words. */
function stepText(t: ReturnType<typeof useTranslations<"overview">>, step: string | undefined) {
  if (!step) return t("step.reading");
  if (step === "writing") return t("step.writing");
  const [kind, value, from, to] = step.split(":");
  if (kind === "count") {
    const by = t(`by.${value as Grouping}`);
    return from || to ? t("step.countIn", { by, from, to }) : t("step.count", { by });
  }
  return t(`step.${value as "cited" | "newest" | "relevance"}`);
}

/** What a run read, in a line: the groupings it counted by and the papers it opened. */
function ReadText({ overview }: { overview: Overview }) {
  const t = useTranslations("overview");
  const locale = useLocale();
  const by = new Intl.ListFormat(locale, { type: "conjunction" }).format([...new Set(overview.counts.map((count) => t(`by.${count.by}`)))]);
  const papers = new Set(overview.lists.flatMap((list) => list.papers.map((paper) => paper.id))).size;
  if (overview.counts.length && papers) return t("read.both", { by, papers });
  if (overview.counts.length) return t("read.counted", { by });
  return papers ? t("read.papers", { papers }) : t("read.none");
}

/**
 * An overview that waits to be asked for, and what it costs: on a plan without free ones, and once the day's free ones
 * are used. With no credits left, or the day's paid ones used, the button can't start one and says why.
 */
function Ask({ view, freePlan, paidUsed, onWrite }: { view: View; freePlan: boolean; paidUsed: number; onWrite: () => void }) {
  const t = useTranslations("overview.ask");
  const href = useWorkspaceHref();
  const format = useFormatter();
  const spendable = useSpendable();
  const time = format.dateTime(nextDay(), { hour: "numeric", minute: "2-digit" });
  const credits = view.credits ?? 0;
  const noCredits = spendable.loaded && spendable.balance < credits;
  const atLimit = paidUsed >= view.paidPerDay;
  const reason = atLimit ? t("limit", { count: view.paidPerDay, time }) : noCredits ? t("noCredits") : undefined;
  // A pill as tall as the lens pills above it.
  const button = (
    <Button variant="ai" onClick={onWrite} disabled={Boolean(reason) || view.credits === null} className="h-9 rounded-full px-4">
      {t("write")}
      <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
        <Coins className="size-3.5" /> {credits}
      </span>
    </Button>
  );
  return (
    <div className="flex flex-wrap items-center gap-3">
      {reason ? (
        <TooltipHint label={reason}>
          {/* A disabled button takes no pointer, so its reason hangs on a wrapper that does. */}
          <span tabIndex={0} className="inline-flex rounded-full">
            {button}
          </span>
        </TooltipHint>
      ) : (
        button
      )}
      <span className="text-sm text-muted-foreground">{atLimit ? reason : freePlan ? t("go") : t("back", { time })}</span>
      {noCredits && !atLimit ? (
        <Link href={href("/settings/billing")} className="ml-auto flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          <Coins className="size-4" /> {t("getCredits")}
        </Link>
      ) : !freePlan && view.proPerDay !== null && view.perDay !== null && view.proPerDay > view.perDay ? (
        <Link href={href("/pricing")} className="ml-auto flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          <UpgradeIcon className="size-4" /> {t("pro", { count: view.proPerDay })}
        </Link>
      ) : freePlan ? (
        <Link href={href("/pricing")} className="ml-auto flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          <UpgradeIcon className="size-4" /> {t("go")}
        </Link>
      ) : null}
    </div>
  );
}

function Written({ blocks, overview }: { blocks: Block[]; overview: Overview }) {
  const t = useTranslations("overview.chart");
  const reduce = useReducedMotion();
  const cited = citedPapers(blocks, overview.lists);
  // The cited papers' whole records, for focus mode to open with everything a result card shows; read once it's written.
  const ids = cited.map((paper) => paper.id);
  const { data: records } = useSWR(overview.status === "done" && ids.length ? ["ai-overview-cited", ...ids] : null, () => readCitedPapers(ids), { revalidateOnFocus: false });
  const works = Array.isArray(records) ? records : null;
  const open = (index: number) => {
    // Until the records are read, a paper opens with what the overview knows of it.
    const papers: PaperResult[] = works?.length === cited.length ? works : cited.map((paper) => ({ id: `https://openalex.org/${paper.id}`, title: paper.title, display_name: paper.title, publication_year: paper.year, cited_by_count: paper.cited }) as PaperResult);
    openCited(papers, index);
  };
  const openId = (id: string) => open(cited.findIndex((paper) => paper.id === id));
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => (
        <motion.div key={i} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE }}>
          {block.kind === "text" ? (
            <p className="text-[0.9375rem] leading-relaxed text-foreground">{block.parts.map((part, j) => (typeof part === "string" ? part : <CiteChip key={j} cite={part} overview={overview} onOpen={openId} />))}</p>
          ) : (
            <Chart block={block} overview={overview} t={t} />
          )}
        </motion.div>
      ))}
      {overview.status === "done" && cited.length ? (
        <motion.div initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE }}>
          <PaperRows papers={cited} onOpen={open} />
        </motion.div>
      ) : null}
    </div>
  );
}

function Chart({ block, overview, t }: { block: Extract<Block, { kind: "chart" }>; overview: Overview; t: ReturnType<typeof useTranslations<"overview.chart">> }) {
  const tb = useTranslations("overview.by");
  const count = overview.counts.find((one) => one.id === block.id);
  if (!count) return null;
  const span = count.years && (count.years.from || count.years.to) ? { from: String(count.years.from ?? ""), to: String(count.years.to ?? "") } : null;
  if (count.by === "year") {
    // A year still running is left out: its count only grows.
    const full = count.groups.filter((group) => Number(group.key) < thisYear);
    if (!block.change) return <YearBars groups={full.slice(-20)} label={span ? t("perYearIn", span) : t("perYear")} />;
    const change = full.slice(1).map((group, i) => ({ ...group, count: full[i].count ? Math.round(((group.count - full[i].count) / full[i].count) * 100) : 0 })).slice(-12);
    return <ChangeBars groups={change} label={t("change")} />;
  }
  const groups = count.by === "openAccess" ? count.groups.map((group) => ({ ...group, name: group.key === "true" ? t("freeToRead") : t("notFree") })) : count.groups;
  const by = tb(count.by);
  return <ShareBars groups={groups.slice(0, 8)} total={count.total} label={span ? t("shareIn", { by, ...span }) : t("share", { by })} />;
}

/**
 * A cited paper as the assistant's record chip, in the words the model chose; the full title shows on hover, and a
 * click opens it in focus mode. A paper no paper list gave stays plain words: there's nothing to open.
 */
function CiteChip({ cite, overview, onOpen }: { cite: Cite; overview: Overview; onOpen: (id: string) => void }) {
  const paper = overview.lists.flatMap((list) => list.papers).find((one) => one.id === cite.id);
  if (!paper) return cite.text;
  return (
    <TooltipHint label={paper.year ? `${paper.title} (${paper.year})` : paper.title}>
      <button type="button" onClick={() => onOpen(cite.id)} className={cn(RECORD_CHIP, "text-sm hover:underline")} style={recordChipStyle("var(--primary)")}>
        {cite.text}
      </button>
    </TooltipHint>
  );
}

function CapRing({ left, perDay }: { left: number; perDay: number }) {
  const t = useTranslations("overview");
  const format = useFormatter();
  const label = left ? t("left", { left, perDay }) : t("noneLeft", { time: format.dateTime(nextDay(), { hour: "numeric", minute: "2-digit" }) });
  return (
    <TooltipHint label={label}>
      <span tabIndex={0} className={cn("relative flex size-6 shrink-0 items-center justify-center text-[10px] font-medium tabular-nums", left ? "text-muted-foreground" : "text-destructive")} aria-label={label}>
        <Ring value={left / perDay} color="var(--primary)" />
        {left}
      </span>
    </TooltipHint>
  );
}
