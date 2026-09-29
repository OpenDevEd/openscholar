"use client";

// The tasks-to-models map shared by the AI settings page and the admin AI models
// page, and the model picker and cost meter both use.

import { useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  ArrowUpDown, Brain, Check, ChevronsUpDown, Cloud, Coins, Filter, KeyRound, Languages, ListChecks, MessageSquare, PiggyBank, SlidersHorizontal,
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
};

/** Whether a model takes a reasoning effort. */
export const reasons = (model: MapModel) => Boolean(model.reasoningEfforts?.length);
/** The effort a model runs at: its pick's, else its own default. Null when it doesn't reason or OpenRouter names no default. */
export const effortOf = (model: MapModel): Effort | null => (reasons(model) ? (model.effort ?? model.defaultEffort ?? null) : null);

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

const money = (n: number) => (n >= 10 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(1).replace(/\.0$/, "")}` : `$${n.toFixed(2)}`);

/** Five-step cost meter on a log scale from $0.05 to $50 per 1M tokens (input and output blended 1:3). */
export function CostMeter({ model, className, bars = false }: { model: MapModel; className?: string; bars?: boolean }) {
  const tm = useTranslations("settingsAi");
  const blended = (model.inputPricePerMillion + model.outputPricePerMillion * 3) / 4;
  const level = blended <= 0 || model.unpriced ? 0 : Math.max(1, Math.min(5, Math.ceil(((Math.log10(blended) + 1.3) / 3) * 5)));
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="flex h-3 items-end gap-[2px]" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cn("w-[3px] rounded-full", i <= level ? "bg-foreground/70" : "bg-foreground/15")} style={{ height: `${4 + i * 2}px` }} />
        ))}
      </span>
      {bars ? null : (
        <span className="w-[5.5rem] text-right text-xs tabular-nums text-muted-foreground">
          {model.unpriced ? null : blended === 0 ? tm("free") : `${money(model.inputPricePerMillion)} / ${money(model.outputPricePerMillion)}`}
        </span>
      )}
    </span>
  );
}

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
    ...(effort && { effort }),
  };
}

export type PresetPick = { id: PresetKey; models: MapModel[]; onSelect: () => void };

/** A preset in the picker: its name, then the model (or models) it runs for these tasks. */
function PresetPickItem({ preset, current, onSelect }: { preset: PresetPick; current: MapModel | undefined; onSelect: () => void }) {
  const tm = useTranslations("settingsAi");
  const Icon = PRESET_ICONS[preset.id];
  const models = [...new Map(preset.models.map((m) => [`${m.id}:${effortOf(m)}`, m])).values()];
  const [only] = models;
  const onlyEffort = only && models.length === 1 ? effortOf(only) : null;
  return (
    <CommandItem value={`${tm(`presets.${preset.id}`)} ${models.map((m) => m.name).join(" ")}`} onSelect={onSelect}>
      <Icon />
      <span className="w-20 shrink-0 font-medium">{tm(`presets.${preset.id}`)}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
        {models.map((m) => {
          const Brand = getModelIcon(m.id);
          return <Brand key={m.id} className="size-3.5 shrink-0" />;
        })}
        <span className="truncate">{models.map((m) => stripProviderPrefix(m.name)).join(", ")}</span>
        {onlyEffort ? <span className="shrink-0 text-xs">{tm(`efforts.${onlyEffort}`)}</span> : null}
      </span>
      {models.length === 1 && only ? <CostMeter model={only} /> : null}
      <Check
        className={cn(
          "text-primary",
          only && models.length === 1 && current && only.id === current.id && onlyEffort === effortOf(current) ? "opacity-100" : "opacity-0",
        )}
      />
    </CommandItem>
  );
}

/** Searchable picker over the models users can pick; `provider` narrows it to one vendor. */
export function ModelPicker({
  current,
  onChange,
  onEffort,
  trigger,
  provider,
  align = "end",
  presets,
  tasks = [],
}: {
  /** The model and effort picked now. */
  current: MapModel | undefined;
  onChange: (model: PickedModel) => void;
  /** Shown when set, for a model that reasons: change the effort it runs at. */
  onEffort?: (effort: Effort) => void;
  trigger: ReactNode;
  provider?: string;
  align?: "start" | "end";
  /** Quick picks listed first: what each preset runs for the same tasks. */
  presets?: PresetPick[];
  /** The tasks this pick is for; only models that can do all of them are offered. */
  tasks?: AiTask[];
}) {
  const tm = useTranslations("settingsAi");
  const [open, setOpen] = useState(false);
  const pick = (run: () => void) => () => {
    run();
    setOpen(false);
  };
  const catalog = useQuery(api.models.queries.listCatalogOptions, open ? { ...(provider && { provider }), ...(tasks.length > 0 && { tasks }) } : "skip");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-[28rem] p-0">
        <Command>
          <CommandInput placeholder={tm("searchModels")} />
          <CommandList className="h-80 max-h-80">
            <CommandEmpty>{catalog === undefined ? tm("loadingModels") : tm("noModels")}</CommandEmpty>
            {presets?.length ? (
              <CommandGroup heading={tm("presetsGroup")}>
                {presets.map((p) => (
                  <PresetPickItem key={p.id} preset={p} current={current} onSelect={pick(p.onSelect)} />
                ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading={presets?.length ? tm("allModels") : undefined}>
              {(catalog ?? []).filter((row) => !provider || !isVariant(row.modelId)).map((row) => {
                const model = toMapModel(row);
                const Brand = getModelIcon(model.id);
                return (
                  <CommandItem
                    key={model.id}
                    value={`${model.name} ${model.id}`}
                    onSelect={pick(() => onChange(model))}
                  >
                    <Brand />
                    <span className="min-w-0 flex-1 truncate">{stripProviderPrefix(model.name)}</span>
                    <CostMeter model={model} />
                    <Check className={cn("text-primary", current?.id === model.id ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {onEffort && current && reasons(current) ? (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">{tm("effort")}</span>
            <Segmented
              label={tm("effort")}
              // No highlight until a level is picked when OpenRouter names no default.
              value={effortOf(current) ?? ("" as Effort)}
              onChange={onEffort}
              options={current.reasoningEfforts!.map((level) => ({ id: level, label: tm(`efforts.${level}`) }))}
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// Diagram geometry, in px.
const ROW = 46;
const LABEL = 34;
const GAP = 14;
export const NODE_H = 84;
const NODE_GAP = 12;
export const ZONE_LABEL = 28;
const BROWSER_TOP = LABEL + CLOUD_TASKS.length * ROW + GAP;
const HEIGHT = BROWSER_TOP + LABEL + BROWSER_TASKS.length * ROW;
const TASK_Y = Object.fromEntries([
  ...CLOUD_TASKS.map((t, i) => [t, LABEL + i * ROW + ROW / 2]),
  ...BROWSER_TASKS.map((t, i) => [t, BROWSER_TOP + LABEL + i * ROW + ROW / 2]),
]) as Record<AiTask, number>;
const EASE = [0.32, 0.72, 0, 1] as const;

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
  for (const task of [...CLOUD_TASKS, ...BROWSER_TASKS]) {
    const model = modelFor(task);
    if (!model) continue;
    const paidBy = runsOnKey(task) ? "key" : "credits";
    const id = `${paidBy}:${model.id}:${effortOf(model) ?? ""}`;
    edges.push({ task, node: id, y0: TASK_Y[task] });
    let n = nodes.find((x) => x.id === id);
    if (!n) nodes.push((n = { id, model, paidBy, tasks: [], target: 0 }));
    n.tasks.push(task);
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
  hover,
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
        className="grid min-w-[36rem] grid-cols-[200px_1fr_272px]"
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

/** A model card on the map: tinted brand tile, who pays, name, cost. */
export function NodeCard({
  model, paidBy, count, interactive, caption, ...props
}: { model: MapModel; paidBy: "credits" | "key"; count: number; interactive?: boolean; caption?: ReactNode } & React.ComponentProps<"button">) {
  const tm = useTranslations("settingsAi");
  const key = paidBy === "key";
  const Brand = getModelIcon(model.id);
  const tint = key ? KEY_TINT : tintOf(model.id);
  const effort = effortOf(model);
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-3.5 text-left transition-[background-color,border-color]",
        key ? "rounded-tl-none bg-primary/10 hover:bg-primary/15" : "border border-border/60 bg-muted/40",
        interactive ? "cursor-pointer" : "cursor-default",
        interactive && !key && "hover:border-border hover:bg-muted/70",
      )}
      style={{ height: NODE_H }}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}>
        <Brand className="size-5" />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          {caption ?? (
            <>
              {key ? <KeyRound className="size-3" /> : <Coins className="size-3" />}
              {key ? tm("yourKey") : tm("credits")}
              <span className="text-muted-foreground/60">{tm("taskCount", { count })}</span>
            </>
          )}
        </span>
        <span className="flex min-w-0 items-baseline gap-2">
          <TooltipHint label={stripProviderPrefix(model.name)} onlyWhenClipped>
            <span className="block truncate text-sm font-semibold">{stripProviderPrefix(model.name)}</span>
          </TooltipHint>
          {effort ? <span className="shrink-0 text-xs text-muted-foreground">{tm(`efforts.${effort}`)}</span> : null}
        </span>
        <CostMeter model={model} className="justify-between" />
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
              const dim = hovered && hovered !== n.id;
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

/** The presets as one full-width switch, each with what its models cost on average; Custom sits apart. */
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
  const average = (models: MapModel[]): MapModel => ({
    id: "average",
    name: "",
    inputPricePerMillion: models.reduce((sum, m) => sum + m.inputPricePerMillion, 0) / Math.max(models.length, 1),
    outputPricePerMillion: models.reduce((sum, m) => sum + m.outputPricePerMillion, 0) / Math.max(models.length, 1),
  });
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
        detail: <CostMeter model={average(modelsOf(id as T))} bars />,
      }))}
    />
  );
  if (!withCustom) return presets;
  const on = value === "custom";
  return (
    <div className="flex items-center gap-3 @max-[34rem]/configuration:flex-col @max-[34rem]/configuration:items-stretch">
      <div className="min-w-0 flex-1">{presets}</div>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange("custom" as T)}
        className={cn(
          "flex h-[3.25rem] shrink-0 items-center justify-center gap-2 rounded-full border px-6 text-sm font-medium transition-colors",
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
