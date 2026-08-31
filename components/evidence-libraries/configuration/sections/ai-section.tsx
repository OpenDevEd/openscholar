"use client";

import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDown, Plus, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { getModelIcon, OpenRouterIcon } from "@/components/icons/provider-icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AI_PROVIDER_KEY_PATH } from "@/lib/evidence-libraries/configuration/ai";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { Field, FieldError } from "../section-card";
import {
  EmptyList,
  FieldGroup,
  ListRow,
  move,
  ReadOnlyValue,
  SortableList,
  ToggleRow,
} from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";

const KEY_INSTANCE = "openrouter";

/**
 * AI answers, through OpenRouter only. The switch is `features.ai`; the key
 * is a write-only credential the platform stores encrypted and adds to the
 * configuration when the library is published.
 */
export function AiSection({ libraryId, draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.ai");
  const enabled = draft.features.ai;
  const { keySaved, models, defaultModel } = draft.ai;
  const {
    results: catalog,
    status: catalogStatus,
    loadMore,
  } = usePaginatedQuery(
    api.models.queries.paginateCatalogOptions,
    {},
    { initialNumItems: 500 },
  );
  const selectedOptions = useQuery(
    api.models.queries.getCatalogOptionsByModelIds,
    { modelIds: models },
  );
  const allOptions = [...catalog];
  const loadedIds = new Set(allOptions.map((model) => model.modelId));
  for (const option of selectedOptions ?? []) {
    if (!loadedIds.has(option.modelId)) allOptions.push(option);
  }
  const catalogIds = new Set(allOptions.map((model) => model.modelId));
  const catalogLoading = catalogStatus === "LoadingFirstPage";
  const runtimeReady = !catalogLoading && catalog.length > 0;
  const unavailableModels =
    catalogLoading || selectedOptions === undefined
      ? []
      : models.filter((model) => !catalogIds.has(model));

  function setModels(next: string[]) {
    patch((d) => {
      const selected = new Set(next);
      const current = new Set(d.ai.models);
      const kept = d.ai.models.filter((model) => selected.has(model));
      const added = next.filter((model) => !current.has(model));
      d.ai.models = [...kept, ...added];
      if (!d.ai.models.includes(d.ai.defaultModel)) {
        d.ai.defaultModel = d.ai.models[0] ?? "";
      }

      return d;
    });
  }

  return (
    <SectionShell
      sectionKey="ai"
      icon={Sparkles}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <ToggleRow
        label={t("answersLabel")}
        hint={t("answersHint")}
        checked={enabled}
        disabled={!enabled && !runtimeReady}
        disabledReason={catalogLoading ? t("loadingModels") : t("notReady")}
        onChange={(next) =>
          patch((d) => {
            d.features.ai = next;
            return d;
          })
        }
        data-ai-enabled={enabled}
      />
      {enabled ? (
        <div className="space-y-6 border-l-2 border-primary/20 pl-4 sm:pl-5">
          <ProviderKeyField libraryId={libraryId} keySaved={keySaved} />
          <FieldGroup
            title={t("modelsLabel")}
            hint={t("modelsHint")}
            action={
              <ModelPicker
                catalog={catalog}
                selected={models}
                onAdd={(model) => setModels([...models, model])}
                canLoadMore={catalogStatus === "CanLoadMore"}
                loadingMore={catalogStatus === "LoadingMore"}
                onLoadMore={() => loadMore(500)}
                labels={{
                  add: t("addModel"),
                  empty: t("noModels"),
                  loadMore: t("loadMoreModels"),
                  search: t("searchModels"),
                }}
              />
            }
          >
            {models.length === 0 ? (
              <EmptyList>{t("modelsEmpty")}</EmptyList>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
                <SortableList
                  ids={models}
                  className="space-y-0"
                  onMove={(from, to) =>
                    patch((d) => {
                      d.ai.models = move(d.ai.models, from, to);
                      return d;
                    })
                  }
                >
                  {models.map((model, index) => {
                    const option = allOptions.find((candidate) => candidate.modelId === model);
                    const Icon = getModelIcon(model);
                    return (
                      <ListRow
                        key={model}
                        id={model}
                        removeLabel={t("removeModel", { model })}
                        onRemove={() =>
                          patch((d) => {
                            d.ai.models = d.ai.models.filter((candidate) => candidate !== model);
                            if (d.ai.defaultModel === model) {
                              d.ai.defaultModel = d.ai.models[0] ?? "";
                            }
                            return d;
                          })
                        }
                        className="items-center rounded-none border-x-0 border-t-0 border-b border-border/50 bg-transparent px-2.5 py-2 last:border-b-0"
                        data-model={model}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="w-4 shrink-0 text-right font-mono text-xs text-muted-foreground">
                            {index + 1}
                          </span>
                          <Icon className="size-4 shrink-0 text-foreground/75" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {option ? stripProviderPrefix(option.name) : model}
                            </span>
                            <code className="block truncate font-mono text-[11px] text-muted-foreground">
                              {model}
                            </code>
                          </span>
                        </div>
                      </ListRow>
                    );
                  })}
                </SortableList>
              </div>
            )}
            {unavailableModels.length > 0 ? <FieldError>{t("modelError")}</FieldError> : null}
            <Field
              label={t("modelLabel")}
              hint={t("modelHint")}
              className="max-w-md border-t border-border/50 pt-4"
              error={
                defaultModel !== "" && !models.includes(defaultModel)
                  ? t("modelError")
                  : null
              }
            >
              {(id) => (
                <Select
                  value={models.includes(defaultModel) ? defaultModel : ""}
                  disabled={models.length === 0}
                  onValueChange={(value) =>
                    patch((d) => {
                      d.ai.defaultModel = value;
                      return d;
                    })
                  }
                >
                  <SelectTrigger id={id} className="w-full bg-background">
                    <SelectValue placeholder={t("modelPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => {
                      const Icon = getModelIcon(model);
                      const option = allOptions.find((candidate) => candidate.modelId === model);
                      return (
                        <SelectItem key={model} value={model}>
                          <span className="flex items-center gap-2">
                            <Icon className="size-3.5" />
                            {option ? stripProviderPrefix(option.name) : model}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </FieldGroup>
        </div>
      ) : null}
    </SectionShell>
  );
}

type ModelOption = FunctionReturnType<
  typeof api.models.queries.paginateCatalogOptions
>["page"][number];

function ModelPicker({
  catalog,
  selected,
  onAdd,
  canLoadMore,
  loadingMore,
  onLoadMore,
  labels,
}: {
  catalog: ModelOption[];
  selected: string[];
  onAdd: (modelId: string) => void;
  canLoadMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  labels: { add: string; empty: string; loadMore: string; search: string };
}) {
  const [open, setOpen] = useState(false);
  const available = catalog.filter((model) => !selected.includes(model.modelId));
  const groups = new Map<string, ModelOption[]>();
  for (const model of available) {
    groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={available.length === 0}
          aria-label={labels.add}
        >
          <Plus className="size-3.5" />
          {labels.add}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder={labels.search} />
          <CommandList className="max-h-80">
            <CommandEmpty>{labels.empty}</CommandEmpty>
            {Array.from(groups.entries()).map(([provider, options], index) => (
              <div key={provider}>
                {index > 0 ? <CommandSeparator /> : null}
                <CommandGroup heading={provider}>
                  {options.map((model) => {
                    const Icon = getModelIcon(model.modelId);
                    return (
                      <CommandItem
                        key={model.modelId}
                        value={`${provider} ${model.name} ${model.modelId}`}
                        className="gap-2.5 py-2"
                        onSelect={() => {
                          onAdd(model.modelId);
                          setOpen(false);
                        }}
                      >
                        <Icon className="size-4 shrink-0 text-foreground/75" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {stripProviderPrefix(model.name)}
                          </span>
                          <code className="block truncate text-[11px] text-muted-foreground">
                            {model.modelId}
                          </code>
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
          {canLoadMore || loadingMore ? (
            <div className="border-t border-border/60 p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={loadingMore}
                onClick={onLoadMore}
              >
                {loadingMore ? <Spinner /> : <Plus className="size-3.5" />}
                {labels.loadMore}
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The stored key is never read back, so a saved key shows as a fact with
 * Replace and Remove beside it, the same way a connected Zotero group does.
 */
function ProviderKeyField({
  libraryId,
  keySaved,
}: {
  libraryId: Id<"evidenceLibraries">;
  keySaved: boolean;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.ai");
  const writeCredential = useAction(
    api.evidenceLibraries.credentialActions.writeCredential,
  );
  const removeKey = useMutation(
    api.evidenceLibraries.aiProviderKey.removeAiProviderKey,
  );
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = !keySaved || replacing;

  function saveKey() {
    setBusy(true);
    void writeCredential({
      libraryId,
      concretePath: AI_PROVIDER_KEY_PATH,
      instanceKey: KEY_INSTANCE,
      value: value.trim(),
    })
      .then(() => {
        setValue("");
        setReplacing(false);
        toast.success(t("keySavedToast"));
      })
      .catch(() => toast.error(t("keyError")))
      .finally(() => setBusy(false));
  }

  function remove() {
    setBusy(true);
    void removeKey({ libraryId })
      .then(() => {
        setValue("");
        setReplacing(false);
      })
      .catch(() => toast.error(t("keyRemoveError")))
      .finally(() => setBusy(false));
  }

  return (
    <Field
      label={
        <span className="inline-flex items-center gap-2">
          <OpenRouterIcon className="size-4" />
          {t("keyLabel")}
        </span>
      }
      hint={t("keyHint")}
      className="max-w-md"
    >
      {(id) =>
        editing ? (
          <div className="flex items-center gap-2">
            <Input
              id={id}
              type="password"
              autoComplete="off"
              className="bg-background font-mono text-sm"
              placeholder="sk-or-"
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || value.trim() === ""}
              aria-busy={busy || undefined}
              onClick={saveKey}
            >
              {busy ? <Spinner aria-hidden /> : null}
              {t("keySave")}
            </Button>
            {keySaved ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setValue("");
                  setReplacing(false);
                }}
              >
                {t("keyCancel")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <ReadOnlyValue id={id} value={t("keyStored")} locked mono={false} />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setReplacing(true)}
            >
              {t("keyReplace")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={remove}
            >
              {busy ? <Spinner aria-hidden /> : null}
              {t("keyRemove")}
            </Button>
          </div>
        )
      }
    </Field>
  );
}
