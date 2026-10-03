"use client";

// The one model picker: AI settings, admin presets, the chat composer and an
// Evidence Library's models all open it. Models are grouped by vendor, filtered
// to what the task can use, and show intelligence, context and cost side by side.

import { useDeferredValue, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Command as CommandPrimitive } from "cmdk";
import { ArrowLeft, ArrowUpRight, Check, Search } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { getModelIcon } from "@/components/icons/provider-icons";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { isVariant } from "@/lib/ai/native-model-id";
import { usableFor, type AiTask } from "@/lib/ai/tasks";
import type { Effort } from "@/lib/ai/core/call-options";
import { Segmented } from "@/components/settings/parts";
import { EffortMeter, IntelligenceMeter, priceLabel } from "@/components/models/meters";
import { EASE, PRESET_ICONS, effortOf, toMapModel, type MapModel, type PickedModel, type PresetPick } from "@/components/settings/model-map";

export type CatalogModel = FunctionReturnType<typeof api.models.queries.listCatalogOptions>[number];

/** What's picked now: a catalog slug, with the effort it runs at. */
type Current = Pick<MapModel, "id" | "effort" | "reasoningEfforts" | "defaultEffort">;

/** Vendors offered as filters, in the order they show; the rest sit under Other. */
const FEATURED = ["anthropic", "openai", "google", "deepseek", "qwen", "mistralai", "x-ai", "meta"] as const;
const VENDOR_NAMES: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", google: "Google", deepseek: "DeepSeek", qwen: "Qwen", mistralai: "Mistral",
  "x-ai": "xAI", meta: "Meta", "z-ai": "Z.ai", moonshotai: "Moonshot", typesafe: "TypeSafe", openrouter: "OpenRouter",
};

/** The vendor a model belongs to: `~openai/…` aliases are OpenAI's, `meta-llama/…` is Meta's. */
const vendorOf = (modelId: string) => {
  const vendor = modelId.replace(/^~/, "").split("/", 1)[0]!;
  return vendor === "meta-llama" ? "meta" : vendor;
};
const vendorName = (vendor: string) => VENDOR_NAMES[vendor] ?? vendor.charAt(0).toUpperCase() + vendor.slice(1);
const featured = (vendor: string) => (FEATURED as readonly string[]).includes(vendor);

function contextLabel(tokens: number | undefined) {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${Math.round((tokens / 1_000_000) * 10) / 10}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

// Name, intelligence, context, cost, check. Context drops out when the picker is narrow.
const GRID =
  "grid grid-cols-[minmax(0,1fr)_6.5rem_6rem_1rem] items-center gap-3 @[32rem]/picker:grid-cols-[minmax(0,1fr)_6.5rem_3rem_6rem_1rem]";
const CONTEXT_CELL = "hidden text-right @[32rem]/picker:block";

/** The intelligence meter, context and cost of a model, as row cells. */
function Stats({ model }: { model: CatalogModel | undefined }) {
  const t = useTranslations("modelPicker");
  const free = model && model.inputPricePerMillion === 0 && model.outputPricePerMillion === 0;
  return (
    <>
      <IntelligenceMeter index={model?.intelligenceIndex} />
      <span className={cn(CONTEXT_CELL, "text-xs tabular-nums text-muted-foreground")}>{contextLabel(model?.contextLength)}</span>
      <span className="text-right text-xs tabular-nums text-muted-foreground">
        {!model ? null : free ? (
          <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-medium ink-success">{t("free")}</span>
        ) : (
          priceLabel(model.inputPricePerMillion, model.outputPricePerMillion)
        )}
      </span>
    </>
  );
}

const ROW = cn(GRID, "rounded-xl px-2.5 py-2 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground");
const GROUP =
  "px-1.5 pb-1 [&_[cmdk-group-heading]]:sticky [&_[cmdk-group-heading]]:top-0 [&_[cmdk-group-heading]]:z-10 [&_[cmdk-group-heading]]:bg-popover [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

/**
 * The picker's second step for a model that reasons: the picked row rises into the
 * header and its effort levels come in below it. Picking a level saves both at once.
 */
function EffortStep({
  row,
  fromY,
  chosen,
  onBack,
  onPick,
}: {
  row: CatalogModel;
  /** Where the picked row sat in the panel, so the header rises from there. */
  fromY: number;
  /** The level the model runs at now, if it's the current pick. */
  chosen: Effort | null;
  onBack: () => void;
  onPick: (effort: Effort) => void;
}) {
  const t = useTranslations("modelPicker");
  const tm = useTranslations("settingsAi");
  const reduce = useReducedMotion();
  const levels = row.reasoningEfforts ?? [];
  const start = chosen ?? row.defaultEffort ?? levels[0];
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [focus, setFocus] = useState(Math.max(0, levels.indexOf(start!)));
  const move = (to: number) => {
    const next = (to + levels.length) % levels.length;
    setFocus(next);
    buttons.current[next]?.focus();
  };
  const Brand = getModelIcon(row.modelId);
  return (
    <motion.div
      className="absolute inset-0 flex flex-col bg-popover"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.18 }}
    >
      <div className="p-2">
        <motion.div
          className={cn(ROW, "bg-accent text-accent-foreground")}
          initial={reduce ? false : { y: fromY - 8 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.42, ease: EASE }}
        >
          <span className="flex min-w-0 items-center gap-2">
            <TooltipHint label={t("back")}>
              <button
                type="button"
                aria-label={t("back")}
                onClick={onBack}
                className="-my-1 -ml-1 flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-background/70"
              >
                <ArrowLeft className="size-4" />
              </button>
            </TooltipHint>
            <Brand className="size-4 shrink-0" />
            <span className="truncate font-medium">{stripProviderPrefix(row.name)}</span>
          </span>
          <Stats model={row} />
          <span />
        </motion.div>
      </div>
      <motion.div
        className="px-4 pb-1.5 text-2xs font-medium text-muted-foreground"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: reduce ? 0 : 0.12, duration: 0.25 }}
      >
        {tm("effort")}
      </motion.div>
      <div
        role="radiogroup"
        aria-label={tm("effort")}
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-2"
        onKeyDown={(e) => {
          const to = { ArrowDown: focus + 1, ArrowUp: focus - 1, Home: 0, End: levels.length - 1 }[e.key];
          if (to === undefined) return;
          e.preventDefault();
          move(to);
        }}
      >
        {levels.map((level, i) => (
          <motion.button
            key={level}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={level === chosen}
            tabIndex={i === focus ? 0 : -1}
            autoFocus={i === focus}
            onFocus={() => setFocus(i)}
            onClick={() => onPick(level)}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 0.14 + i * 0.035, duration: 0.3, ease: EASE }}
            className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm outline-hidden hover:bg-accent focus-visible:bg-accent"
          >
            <EffortMeter levels={levels} level={level} />
            <span className="font-medium">{tm(`efforts.${level}`)}</span>
            {level === row.defaultEffort ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">{t("default")}</span>
            ) : null}
            <Check className={cn("ml-auto size-4 text-primary", level === chosen ? "opacity-100" : "opacity-0")} />
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

/** Searchable picker over the models users can pick for `tasks`; `provider` narrows it to one vendor's own API. */
export function ModelPicker({
  current,
  onChange,
  efforts = false,
  trigger,
  provider,
  align = "end",
  side,
  presets,
  tasks = [],
  exclude,
}: {
  current: Current | undefined;
  /** The picked model, and its effort when the picker asked for one. */
  onChange: (model: PickedModel, effort?: Effort) => void;
  /** Ask for a reasoning effort after picking a model that takes one. */
  efforts?: boolean;
  trigger: ReactNode;
  provider?: string;
  align?: "start" | "end";
  side?: "top" | "bottom";
  /** Quick picks listed first: what each preset runs for the same tasks. */
  presets?: PresetPick[];
  /** The tasks this pick is for; only models that can do all of them are offered. Chat when empty. */
  tasks?: AiTask[];
  /** Slugs to leave out, such as models already added. */
  exclude?: string[];
}) {
  const t = useTranslations("modelPicker");
  const tm = useTranslations("settingsAi");
  const [open, setOpen] = useState(false);
  // The panel paints the moment it opens and its rows fill in right after, at low
  // priority, so building a few hundred rows never holds back the open animation.
  // While it closes, everything stays as it was, so the fade-out shows what you picked.
  const rowsReady = useDeferredValue(open) || !open;
  const [vendor, setVendor] = useState<string>("all");
  // The effort step, once a model that reasons is picked; `fromY` is where its row sat.
  const [step, setStep] = useState<{ row: CatalogModel; fromY: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();
  // Whether this opening has scrolled to the current model yet. cmdk hands rows a new
  // ref on every render, so without it each hover would scroll back to the current model.
  const revealed = useRef(false);
  const revealCurrent = (row: HTMLElement | null) => {
    const list = row?.closest<HTMLElement>("[cmdk-list]");
    if (!row || !list || revealed.current) return;
    revealed.current = true;
    // Near the top, with one row above it: the list may still shrink to fit a short screen.
    list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - row.clientHeight;
  };
  // Subscribed from mount, not on open, so the list is there the moment the picker opens.
  // Every picker shares this one subscription and filters for its own tasks.
  const catalog = useQuery(api.models.queries.listCatalogOptions, {});
  const needed = tasks.length > 0 ? tasks : (["chat"] as const);

  // ponytail: filtered and grouped on every render; a few hundred rows is cheap.
  const rows = (catalog ?? []).filter(
    (row) =>
      (!provider || (row.provider === provider && !isVariant(row.modelId))) &&
      !exclude?.includes(row.modelId) &&
      needed.every((task) => usableFor(row, task)),
  );
  const byId = new Map(rows.map((row) => [row.modelId, row]));
  const present = new Set(rows.map((row) => vendorOf(row.modelId)));
  // Featured vendors first in their order, then the rest by name; smartest first inside each.
  const groups = (() => {
    const shown = rows.filter((row) => {
      const v = vendorOf(row.modelId);
      return vendor === "all" || (vendor === "other" ? !featured(v) : v === vendor);
    });
    const map = new Map<string, CatalogModel[]>();
    for (const row of shown) map.set(vendorOf(row.modelId), [...(map.get(vendorOf(row.modelId)) ?? []), row]);
    const rank = (v: string) => (featured(v) ? FEATURED.indexOf(v as (typeof FEATURED)[number]) : FEATURED.length);
    return [...map.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || vendorName(a).localeCompare(vendorName(b)))
      .map(([v, list]) => [
        v,
        list.sort((a, b) => (b.intelligenceIndex ?? -1) - (a.intelligenceIndex ?? -1) || (b.createdOnOpenRouter ?? 0) - (a.createdOnOpenRouter ?? 0)),
      ] as const);
  })();

  // Every opening starts on the full list. It resets here rather than on close, so
  // nothing inside the popover changes while it fades out.
  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setVendor("all");
    setStep(null);
    // Scroll to the current model only when the list is already there, never after it arrives.
    revealed.current = catalog === undefined;
  };
  const pick = (run: () => void) => () => {
    run();
    openChange(false);
  };
  const currentEffort = current ? effortOf(current) : null;
  // cmdk takes Enter and Space for the highlighted row; controls in the panel keep them.
  const keepKeys = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  };
  const currentRow = current ? byId.get(current.id) : undefined;
  const choose = (row: CatalogModel) => {
    if (!efforts || !row.reasoningEfforts?.length) return pick(() => onChange(toMapModel(row)))();
    const el = panel.current?.querySelector(`[data-model-option="${CSS.escape(row.modelId)}"]`);
    const fromY = el && panel.current ? el.getBoundingClientRect().top - panel.current.getBoundingClientRect().top : 8;
    setStep({ row, fromY });
  };
  const back = () => {
    setStep(null);
    // The list is inert until the step is gone; focus the search once it's back.
    requestAnimationFrame(() => search.current?.focus());
  };
  // Every filter shows from the first frame; one with nothing for these tasks is disabled once the list is in.
  const filters = provider ? [] : ["all", ...FEATURED, "other"];
  const empty = (v: string) =>
    catalog !== undefined && v !== "all" && (v === "other" ? ![...present].some((p) => !featured(p)) : !present.has(v));

  return (
    <Popover
      open={open}
      onOpenChange={openChange}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        className="@container/picker relative flex w-[38rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl p-0"
        data-model-picker
        ref={panel}
        // Escape in the effort step goes back to the list instead of closing.
        onEscapeKeyDown={(e) => {
          if (!step) return;
          e.preventDefault();
          back();
        }}
      >
        <motion.div
          className="flex min-h-0 flex-1 flex-col"
          animate={{ opacity: step ? 0 : 1, x: step ? -16 : 0 }}
          transition={{ duration: reduce ? 0 : step ? 0.16 : 0.28, ease: EASE }}
          inert={step ? true : undefined}
        >
        {/* Uncontrolled on purpose: a controlled value makes cmdk scroll to every row the pointer passes. */}
        <CommandPrimitive className="flex min-h-0 flex-1 flex-col" defaultValue={current?.id}>
          <div className="space-y-2 p-2">
            <label className="flex h-10 items-center gap-2.5 rounded-xl border border-border/60 bg-muted/40 px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <CommandPrimitive.Input ref={search} placeholder={tm("searchModels")} className="h-full w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground" />
            </label>
            {filters.length > 0 ? (
              <div
                role="radiogroup"
                aria-label={t("vendors")}
                // Scrolls sideways on a narrow screen rather than cutting off the last filters.
                className="-mx-2 flex items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none]"
                onKeyDown={keepKeys}
              >
                {filters.map((v) => {
                  const active = v === vendor;
                  const Icon = v === "all" || v === "other" ? null : getModelIcon(`${v}/x`);
                  const name = v === "all" ? t("all") : v === "other" ? t("other") : vendorName(v);
                  const chip = (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={name}
                      disabled={empty(v)}
                      onClick={() => setVendor(v)}
                      className={cn(
                        "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-30",
                        active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {Icon ? <Icon className="size-3.5" /> : null}
                      {!Icon || active ? <span>{name}</span> : null}
                    </button>
                  );
                  return Icon && !active ? (
                    <TooltipHint key={v} label={name}>
                      {chip}
                    </TooltipHint>
                  ) : (
                    chip
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className={cn(GRID, "border-y border-border/50 bg-muted/30 px-4 py-1.5 text-2xs font-medium text-muted-foreground")}>
            <span>{t("model")}</span>
            <a
              href="https://artificialanalysis.ai/methodology/intelligence-benchmarking"
              target="_blank"
              rel="noreferrer"
              aria-label={t("source")}
              className="flex items-center gap-1 hover:text-foreground"
              onKeyDown={keepKeys}
            >
              {t("intelligence")}
              <ArrowUpRight className="size-3" />
            </a>
            <span className={CONTEXT_CELL}>{t("context")}</span>
            <span className="text-right">{t("cost")}</span>
            <span />
          </div>
          {/* 22rem when there's room; shorter when the screen is, since the popover caps at the space it has. */}
          <CommandPrimitive.List className="h-[22rem] min-h-0 overflow-y-auto overscroll-contain">
            {/* The whole list arrives at once, already scrolled to the current model, and fades in. */}
            {rowsReady ? (
            <div className="animate-in fade-in-0 duration-200 motion-reduce:animate-none">
            <CommandPrimitive.Empty className="py-10 text-center text-sm text-muted-foreground">
              {catalog === undefined ? tm("loadingModels") : tm("noModels")}
            </CommandPrimitive.Empty>
            {presets?.length && vendor === "all" ? (
              <CommandPrimitive.Group heading={tm("presetsGroup")} className={GROUP}>
                {presets.map((preset) => {
                  const Icon = PRESET_ICONS[preset.id];
                  const models = [...new Map(preset.models.map((m) => [`${m.id}:${effortOf(m)}`, m])).values()];
                  const only = models.length === 1 ? models[0] : undefined;
                  const onlyEffort = only ? effortOf(only) : null;
                  const selected = Boolean(only && current && only.id === current.id && onlyEffort === currentEffort);
                  return (
                    <CommandPrimitive.Item
                      key={preset.id}
                      value={`preset ${tm(`presets.${preset.id}`)} ${models.map((m) => m.name).join(" ")}`}
                      onSelect={pick(preset.onSelect)}
                      className={ROW}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block font-medium">{tm(`presets.${preset.id}`)}</span>
                          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            {models.map((m) => {
                              const Brand = getModelIcon(m.id);
                              return <Brand key={m.id} className="size-3 shrink-0" />;
                            })}
                            <span className="truncate">{models.map((m) => stripProviderPrefix(m.name)).join(", ")}</span>
                            {onlyEffort ? <span className="shrink-0 rounded-full bg-muted px-1.5 text-2xs">{tm(`efforts.${onlyEffort}`)}</span> : null}
                          </span>
                        </span>
                      </span>
                      <Stats model={only ? byId.get(only.id) : undefined} />
                      <Check className={cn("size-4 text-primary", selected ? "opacity-100" : "opacity-0")} />
                    </CommandPrimitive.Item>
                  );
                })}
              </CommandPrimitive.Group>
            ) : null}
            {groups.map(([v, list]) => {
              const Brand = getModelIcon(list[0]!.modelId);
              return (
                <CommandPrimitive.Group
                  key={v}
                  className={GROUP}
                  heading={
                    <span className="flex items-center gap-1.5">
                      <Brand className="size-3.5" />
                      {vendorName(v)}
                      <span className="tabular-nums text-muted-foreground/60">{list.length}</span>
                    </span>
                  }
                >
                  {list.map((row) => {
                    const selected = current?.id === row.modelId;
                    return (
                      <CommandPrimitive.Item
                        key={row.modelId}
                        value={row.modelId}
                        keywords={[vendorName(v), row.name]}
                        onSelect={() => choose(row)}
                        className={ROW}
                        data-model-option={row.modelId}
                        ref={selected ? revealCurrent : undefined}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Brand className={cn("size-4 shrink-0", selected ? "text-foreground" : "text-muted-foreground")} />
                          <span className={cn("truncate", selected && "font-medium")}>{stripProviderPrefix(row.name)}</span>
                        </span>
                        <Stats model={row} />
                        <Check className={cn("size-4 text-primary", selected ? "opacity-100" : "opacity-0")} />
                      </CommandPrimitive.Item>
                    );
                  })}
                </CommandPrimitive.Group>
              );
            })}
            </div>
            ) : null}
          </CommandPrimitive.List>
        </CommandPrimitive>
          {/* Built from the current pick, which the caller already has, so it's there on the first frame. */}
          {efforts && current?.reasoningEfforts?.length ? (
            // The current model's effort, changed in place without closing.
            <div className="flex items-center justify-between gap-3 border-t border-border/50 py-2 pl-4 pr-2">
              <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{tm("effort")}</span>
              <Segmented
                label={tm("effort")}
                // No highlight until a level is picked when OpenRouter names no default.
                value={currentEffort ?? ("" as Effort)}
                onChange={(effort) => currentRow && onChange(toMapModel(currentRow, effort), effort)}
                options={current.reasoningEfforts.map((level) => ({
                  id: level,
                  label: tm(`efforts.${level}`),
                  // Only the chosen level shows its bars, so seven levels still fit on one row.
                  ...(level === currentEffort && { detail: <EffortMeter levels={current.reasoningEfforts!} level={level} filled="bg-current" /> }),
                }))}
              />
            </div>
          ) : null}
        </motion.div>
        <AnimatePresence>
          {step ? (
            <EffortStep
              key={step.row.modelId}
              row={step.row}
              fromY={step.fromY}
              chosen={current?.id === step.row.modelId ? currentEffort : null}
              onBack={back}
              onPick={(effort) => pick(() => onChange(toMapModel(step.row, effort), effort))()}
            />
          ) : null}
        </AnimatePresence>
      </PopoverContent>
    </Popover>
  );
}
