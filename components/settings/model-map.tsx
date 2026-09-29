"use client";

// The tasks-to-models map shared by the AI settings page and the admin AI models
// page, and the cost meter.

import { useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  ArrowUpDown, Brain, Check, ChevronsUpDown, Cloud, Filter, Languages, ListChecks, MessageSquare, PiggyBank, SlidersHorizontal,
  Search, TableProperties, Wand2, Scale, Zap,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { getModelIcon } from "@/components/icons/provider-icons";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { isVariant } from "@/lib/ai/native-model-id";
import { BROWSER_TASKS, CLOUD_TASKS, PRESET_KEYS, type AiTask, type PresetKey } from "@/lib/ai/tasks";
import type { Effort } from "@/lib/ai/core/call-options";
import { Segmented, type Ico } from "./parts";
import { EffortMeter, IntelligenceMeter, PriceScale, priceLabel } from "@/components/models/meters";

export type MapModel = {
  _id?: Id<"models">;
  /** The catalog slug, such as "anthropic/claude-sonnet-4.6". */
  id: string;
  name: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  /** A key model the catalog doesn't list, so there's no price to show. */
  unpriced?: boolean;
  /** The effort this pick runs at; none means the model's default. */
  effort?: Effort;
  /** The effort levels the model takes, lowest first; absent when it doesn't reason. */
  reasoningEfforts?: Effort[];
  defaultEffort?: Effort;
  /** Artificial Analysis Intelligence Index; absent when unmeasured. */
  intelligenceIndex?: number;
};

/** Whether a model takes a reasoning effort. */
export const reasons = (model: Pick<MapModel, "reasoningEfforts">) => Boolean(model.reasoningEfforts?.length);
/** The effort a model runs at: its pick's, else its own default. Null when it doesn't reason or OpenRouter names no default. */
export const effortOf = (model: Pick<MapModel, "effort" | "reasoningEfforts" | "defaultEffort">): Effort | null => (reasons(model) ? (model.effort ?? model.defaultEffort ?? null) : null);

export const PRESET_ICONS: Record<PresetKey, Ico> = { cheap: PiggyBank, fast: Zap, balanced: Scale, intelligent: Brain };

export const TASK_ICONS: Record<AiTask, Ico> = {
  chat: MessageSquare,
  extraction: TableProperties,
  screenAll: ListChecks,
  screening: Filter,
  questionToQuery: Search,
  refine: Wand2,
  translate: Languages,
  broadenNarrow: ArrowUpDown,
};

/** One tint per provider, so a colour always means the same vendor. */
const PROVIDER_TINT: Array<[string, string]> = [
  ["anthropic/", "#d9a27c"], ["~anthropic/", "#d9a27c"], ["typesafe/", "#a78bfa"], ["google/", "#60a5fa"],
  ["openai/", "#34d399"], ["deepseek/", "#fb923c"], ["z-ai/", "#2dd4bf"], ["meta-llama/", "#818cf8"],
  ["mistralai/", "#f472b6"], ["x-ai/", "#e5e7eb"], ["qwen/", "#c084fc"],
];
export const KEY_TINT = "var(--primary)";
export const tintOf = (modelId: string) => PROVIDER_TINT.find(([prefix]) => modelId.startsWith(prefix))?.[1] ?? "#94a3b8";

/** A catalog model, which always has an id. */
export type PickedModel = MapModel & { _id: Id<"models"> };

export function toMapModel(
  row: {
    _id: Id<"models">;
    modelId: string;
    name: string;
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    reasoningEfforts?: Effort[];
    defaultEffort?: Effort;
    intelligenceIndex?: number;
  },
  effort?: Effort | null,
): PickedModel {
  return {
    _id: row._id,
    id: row.modelId,
    name: row.name,
    inputPricePerMillion: row.inputPricePerMillion,
    outputPricePerMillion: row.outputPricePerMillion,
    reasoningEfforts: row.reasoningEfforts,
    defaultEffort: row.defaultEffort,
    intelligenceIndex: row.intelligenceIndex,
    ...(effort && { effort }),
  };
}

export type PresetPick = { id: PresetKey; models: MapModel[]; onSelect: () => void };

// Diagram geometry, in px.
const ROW = 46;
const LABEL = 34;
const GAP = 14;
export const NODE_H = 64;
const NODE_GAP = 12;
export const ZONE_LABEL = 28;
const BROWSER_TOP = LABEL + CLOUD_TASKS.length * ROW + GAP;
const HEIGHT = BROWSER_TOP + LABEL + BROWSER_TASKS.length * ROW;
const TASK_Y = Object.fromEntries([
  ...CLOUD_TASKS.map((t, i) => [t, LABEL + i * ROW + ROW / 2]),
  ...BROWSER_TASKS.map((t, i) => [t, BROWSER_TOP + LABEL + i * ROW + ROW / 2]),
]) as Record<AiTask, number>;
export const EASE = [0.32, 0.72, 0, 1] as const;

export type MapNode = { id: string; model: MapModel; paidBy: "credits" | "key"; tasks: AiTask[]; target: number };
type Edge = { task: AiTask; node: string; y0: number };
export type Hover = { task?: AiTask; node?: string } | null;

const onKey = (n: MapNode) => (n.paidBy === "key" ? 1 : 0);

/**
 * Stacks nodes near the mean height of their tasks without overlapping or leaving
 * the frame. Cards on the user's key go last, with room above the first for its tab.
 */
function placeNodes(nodes: MapNode[], height: number): Record<string, number> {
  const sorted = [...nodes].sort((a, b) => onKey(a) - onKey(b) || a.target - b.target);
  const gapBefore = (i: number) => NODE_GAP + (onKey(sorted[i]!) && !onKey(sorted[i - 1]!) ? ZONE_LABEL : 0);
  const tops: number[] = [];
  sorted.forEach((n, i) => {
    const want = Math.max(LABEL, n.target - NODE_H / 2);
    tops.push(i === 0 ? want : Math.max(want, tops[i - 1]! + NODE_H + gapBefore(i)));
  });
  for (let i = tops.length - 1; i >= 0; i--) {
    const limit = i === tops.length - 1 ? height - NODE_H : tops[i + 1]! - NODE_H - gapBefore(i + 1);
    tops[i] = Math.max(LABEL, Math.min(tops[i]!, limit));
  }
  return Object.fromEntries(sorted.map((n, i) => [n.id, tops[i]!]));
}

const curve = (y0: number, y1: number) => `M 0 ${y0} C 55 ${y0}, 45 ${y1}, 100 ${y1}`;

export type Routing = ReturnType<typeof useRouting>;

/** Lays out the map: which node each task runs on, and where the nodes sit. */
export function useRouting({
  modelFor,
  onKey: runsOnKey = () => false,
}: {
  modelFor: (t: AiTask) => MapModel | null;
  /** Whether the task runs on the user's own key rather than on credits. */
  onKey?: (t: AiTask) => boolean;
}) {
  const edges: Edge[] = [];
  const nodes: MapNode[] = [];
  // Tasks on the same model, effort and payment share a card.
  const cards = new Map<string, MapNode>();
  for (const task of [...CLOUD_TASKS, ...BROWSER_TASKS]) {
    const model = modelFor(task);
    if (!model) continue;
    const paidBy = runsOnKey(task) ? "key" : "credits";
    const group = `${paidBy}:${model.id}:${effortOf(model) ?? ""}`;
    let n = cards.get(group);
    // A card is named after its first task, so a new model updates it in place instead of replacing it.
    if (!n) {
      n = { id: task, model, paidBy, tasks: [], target: 0 };
      cards.set(group, n);
      nodes.push(n);
    }
    n.tasks.push(task);
    edges.push({ task, node: n.id, y0: TASK_Y[task] });
  }
  for (const n of nodes) n.target = n.tasks.reduce((sum, t) => sum + TASK_Y[t], 0) / n.tasks.length;
  // Grow past the task list when the cards need more room than it has.
  const stacked = LABEL + nodes.length * (NODE_H + NODE_GAP) - NODE_GAP + (nodes.some(onKey) ? ZONE_LABEL : 0);
  const height = Math.max(HEIGHT, stacked);
  const tops = placeNodes(nodes, height);
  const ordered = [...nodes].sort((a, b) => tops[a.id]! - tops[b.id]!);
  const colorOf = (id: string) => {
    const n = nodes.find((x) => x.id === id)!;
    return n.paidBy === "key" ? KEY_TINT : tintOf(n.model.id);
  };
  return {
    edges, nodes, ordered, tops, height, colorOf,
    firstKey: ordered.find(onKey)?.id,
    modelCount: new Set(nodes.map((n) => n.model.id)).size,
  };
}

/** The map. `renderNode` draws each model card; `wrapTask` can turn a task row into a trigger. */
export function RoutingMap({
  routing,
  hover: hoverIn,
  setHover,
  browserLabel,
  browserActive,
  renderNode,
  wrapTask,
  wrapBrowserLabel,
}: {
  routing: Routing;
  hover: Hover;
  setHover: (h: Hover) => void;
  browserLabel: string;
  browserActive?: boolean;
  renderNode: (n: MapNode) => ReactNode;
  wrapTask?: (task: AiTask, row: ReactNode) => ReactNode;
  /** Turns the browser tasks' label into a control, such as how they're paid for. */
  wrapBrowserLabel?: (label: ReactNode) => ReactNode;
}) {
  const tm = useTranslations("settingsAi");
  const { edges, nodes, tops, height, colorOf } = routing;
  // Picking a model replaces its card before the pointer can leave it, so a hovered card may be gone.
  const hover = hoverIn?.node && !nodes.some((n) => n.id === hoverIn.node) ? null : hoverIn;
  const reduceMotion = useReducedMotion();
  const nodeY = (id: string) => tops[id]! + NODE_H / 2;
  const lit = (e: Edge) => !hover || (hover.task ? e.task === hover.task : e.node === hover.node);
  const nodeLit = (n: MapNode) => !hover || (hover.node ? hover.node === n.id : n.tasks.includes(hover.task!));
  const taskColor = (t: AiTask) => {
    const edge = edges.find((e) => e.task === t);
    return edge ? colorOf(edge.node) : undefined;
  };

  const taskRow = (task: AiTask) => {
    const Icon = TASK_ICONS[task];
    const row = (
      <div
        onMouseEnter={() => setHover({ task })}
        onMouseLeave={() => setHover(null)}
        className={cn(
          "flex h-11 w-full items-center gap-3 rounded-l-xl pl-3 text-left transition-colors",
          hover?.task === task && "bg-muted/50",
          wrapTask && "cursor-pointer",
        )}
      >
        <span className="flex shrink-0 transition-colors" style={{ color: taskColor(task) }}>
          <Icon className="size-4" />
        </span>
        <span className={cn("truncate text-sm font-medium transition-colors", hover && !edges.some((e) => e.task === task && lit(e)) && "text-muted-foreground")}>
          {tm(`tasks.${task}`)}
        </span>
        {wrapTask ? <ChevronsUpDown className="ml-auto mr-2 size-3.5 shrink-0 text-muted-foreground/60" /> : null}
      </div>
    );
    return <div key={task}>{wrapTask ? wrapTask(task, row) : row}</div>;
  };

  return (
    // Narrow screens scroll the map sideways rather than squeezing its columns.
    <div className="overflow-x-auto overflow-y-hidden">
      <motion.div
        className="grid min-w-[36rem] grid-cols-[200px_1fr_300px]"
        initial={false}
        animate={{ height }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: EASE }}
      >
        <div>
          <div className="flex items-center pl-3 text-xs font-medium text-muted-foreground" style={{ height: LABEL }}>
            {tm("cloudOnly")}
          </div>
          {CLOUD_TASKS.map(taskRow)}
          <div style={{ height: GAP }} />
          <div className={cn("flex items-center pl-3 text-xs font-medium transition-colors", browserActive ? "text-primary" : "text-muted-foreground")} style={{ height: LABEL }}>
            {(wrapBrowserLabel ?? ((label: ReactNode) => label))(
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={browserLabel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  {browserLabel}
                </motion.span>
              </AnimatePresence>,
            )}
          </div>
          {BROWSER_TASKS.map(taskRow)}
        </div>

        <svg className="w-full overflow-visible" style={{ height }} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden>
          {edges.map((e) => (
            <motion.path
              key={e.task}
              initial={false}
              animate={{ d: curve(e.y0, nodeY(e.node)), opacity: lit(e) ? 1 : 0.15 }}
              transition={{ duration: 0.45, ease: EASE }}
              fill="none"
              stroke={colorOf(e.node)}
              strokeWidth={2}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        <div className="relative">
          <div className="flex items-center gap-1.5 pl-1 text-xs font-medium text-muted-foreground" style={{ height: LABEL }}>
            <Cloud className="size-3.5" /> {tm("openScholarCloud")}
          </div>
          <AnimatePresence initial={false}>
            {nodes.map((n) => (
              <motion.div
                key={n.id}
                className="absolute inset-x-0 top-0"
                initial={{ opacity: 0, y: tops[n.id], scale: 0.96 }}
                animate={{ opacity: nodeLit(n) ? 1 : 0.4, y: tops[n.id], scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.45, ease: EASE }}
                onMouseEnter={() => setHover({ node: n.id })}
                onMouseLeave={() => setHover(null)}
              >
                {renderNode(n)}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * A model card on the map: brand tile, name, and the effort it runs at with its price.
 * Who pays and how many tasks it runs already show on the map; `note` replaces the
 * price only for what the map doesn't say, such as a missing key.
 */
export function NodeCard({
  model, paidBy, interactive, note, ...props
}: { model: MapModel; paidBy: "credits" | "key"; interactive?: boolean; note?: ReactNode } & React.ComponentProps<"button">) {
  const tm = useTranslations("settingsAi");
  const key = paidBy === "key";
  const Brand = getModelIcon(model.id);
  const tint = key ? KEY_TINT : tintOf(model.id);
  const effort = effortOf(model);
  const free = model.inputPricePerMillion + model.outputPricePerMillion === 0;
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-3 text-left transition-[background-color,border-color]",
        key ? "rounded-tl-none bg-primary/10 hover:bg-primary/15" : "border border-border/60 bg-muted/40",
        interactive ? "cursor-pointer" : "cursor-default",
        interactive && !key && "hover:border-border hover:bg-muted/70",
      )}
      style={{ height: NODE_H }}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}>
        <Brand className="size-5" />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <TooltipHint label={stripProviderPrefix(model.name)} onlyWhenClipped>
          <span className="block truncate text-sm font-semibold">{stripProviderPrefix(model.name)}</span>
        </TooltipHint>
        <span className="flex items-center justify-between gap-3 whitespace-nowrap text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {effort ? (
              <>
                <EffortMeter levels={model.reasoningEfforts!} level={effort} filled="bg-current" />
                {tm(`efforts.${effort}`)}
              </>
            ) : null}
          </span>
          {note ?? <span className="tabular-nums">{model.unpriced ? null : free ? tm("free") : priceLabel(model.inputPricePerMillion, model.outputPricePerMillion)}</span>}
        </span>
      </span>
      {interactive ? <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" /> : null}
    </button>
  );
}

/** The models in play as overlapping tiles, with how the tasks split between them. */
export function MapSummary({
  routing,
  title,
  hovered,
  onHover,
}: {
  routing: Routing;
  title: ReactNode;
  hovered?: string;
  onHover: (id: string | null) => void;
}) {
  const tm = useTranslations("settingsAi");
  const shown = routing.ordered;
  // A card replaced while hovered (a new pick) no longer dims the rest.
  const live = hovered && routing.nodes.some((n) => n.id === hovered) ? hovered : undefined;
  const total = routing.nodes.reduce((sum, n) => sum + n.tasks.length, 0);
  // Tiles are 48px and overlap by 12px; past five they overlap more so the stack never widens the header.
  const step = shown.length > 1 ? Math.min(36, 144 / (shown.length - 1)) : 36;
  return (
    <div className="flex items-center justify-between gap-6 @max-[46rem]/configuration:flex-col @max-[46rem]/configuration:items-start">
      <div className="flex min-w-0 items-center gap-4 @max-[46rem]/configuration:flex-col @max-[46rem]/configuration:items-start">
        <div className="flex shrink-0">
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((n, i) => {
              const Brand = getModelIcon(n.model.id);
              const tint = routing.colorOf(n.id);
              return (
                <motion.span
                  key={n.id}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="flex size-12 items-center justify-center rounded-2xl bg-background ring-4 ring-background"
                  style={{ zIndex: shown.length - i, marginLeft: i > 0 ? step - 48 : 0 }}
                >
                  <span className="flex size-full items-center justify-center rounded-2xl" style={{ backgroundColor: `color-mix(in oklab, ${tint} 22%, var(--background))`, color: tint }}>
                    <Brand className="size-6" />
                  </span>
                </motion.span>
              );
            })}
          </AnimatePresence>
        </div>
        <div className="min-w-0 space-y-2">
          <h2 className="flex items-baseline gap-2 truncate">
            <span className="text-2xl font-semibold tracking-tight">{title}</span>
          </h2>
          <div className="flex w-72 max-w-full gap-1" onMouseLeave={() => onHover(null)}>
            {shown.map((n) => {
              const dim = live && live !== n.id;
              return (
                <motion.div
                  key={n.id}
                  layout
                  onMouseEnter={() => onHover(n.id)}
                  className="flex flex-col gap-1"
                  style={{ flexGrow: Math.max(n.tasks.length, 0.6), flexBasis: 0 }}
                  transition={{ duration: 0.45, ease: EASE }}
                >
                  <span className="h-1.5 rounded-full" style={{ backgroundColor: routing.colorOf(n.id), opacity: dim ? 0.25 : 1 }} />
                  <span className={cn("truncate text-[11px] tabular-nums", dim ? "text-muted-foreground/40" : "text-muted-foreground")}>
                    {`${n.tasks.length}/${total}`}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The presets as one full-width switch, each with its models' average intelligence and cost; Custom sits apart. */
export function PresetSwitch<T extends PresetKey | "custom">({
  value,
  onChange,
  modelsOf,
  withCustom = false,
}: {
  value: T;
  onChange: (choice: T) => void;
  /** The models a choice runs its tasks on. */
  modelsOf: (choice: T) => MapModel[];
  withCustom?: boolean;
}) {
  const tm = useTranslations("settingsAi");
  const mean = (values: number[]) => (values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : undefined);
  // Intelligence averages the scored models only; an unscored model says nothing about it.
  const summary = (models: MapModel[]) => (
    <span className="flex w-full items-center gap-4">
      <IntelligenceMeter index={mean(models.flatMap((m) => (m.intelligenceIndex == null ? [] : [m.intelligenceIndex])))} className="flex-1" />
      <PriceScale input={mean(models.map((m) => m.inputPricePerMillion)) ?? 0} output={mean(models.map((m) => m.outputPricePerMillion)) ?? 0} />
    </span>
  );
  const presets = (
    <Segmented
      fill
      size="lg"
      label={tm("preset")}
      value={value}
      onChange={onChange}
      options={PRESET_KEYS.map((id) => ({
        id: id as T,
        label: tm(`presets.${id}`),
        icon: PRESET_ICONS[id],
        below: summary(modelsOf(id as T)),
      }))}
    />
  );
  if (!withCustom) return presets;
  const on = value === "custom";
  return (
    <div className="flex items-stretch gap-3 @max-[34rem]/configuration:flex-col">
      <div className="min-w-0 flex-1">{presets}</div>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange("custom" as T)}
        className={cn(
          "flex min-h-[3.25rem] shrink-0 items-center justify-center gap-2 rounded-[1.375rem] border px-6 text-sm font-medium transition-colors",
          on
            ? "border-primary/40 bg-primary/15 text-primary"
            : "border-dashed border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        )}
      >
        <SlidersHorizontal className="size-4" /> {tm("presets.custom")}
      </button>
    </div>
  );
}

/** What each preset runs a task on, from the preset maps; undefined while loading. */
export function usePresetModels() {
  const presets = useQuery(api.aiModelConfig.queries.presets, {});
  if (!presets) return undefined;
  return (preset: PresetKey, task: AiTask): PickedModel | null => {
    const pick = presets.find((p) => p.preset === preset)?.tasks.find((r) => r.task === task);
    return pick?.model ? toMapModel(pick.model, pick.effort) : null;
  };
}
