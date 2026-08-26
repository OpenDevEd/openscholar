"use client";

import { Plus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { StatusChip } from "../library-status-badge";
import { formatContext, formatPrice, ProviderMark, providerName, type CatalogModel } from "./ai-shared";

const FILTERS = ["all", "openai", "google", "anthropic", "deepseek", "x-ai", "other"] as const;
const NAMED = new Set<string>(["openai", "google", "anthropic", "deepseek", "x-ai"]);

/** Picks models from OpenScholar's live catalog. Search, filter by provider, tick many. */
export function AiModelPicker({
  catalog,
  addedIds,
  usable,
  disabledReason,
  onAdd,
}: {
  catalog: CatalogModel[] | undefined;
  addedIds: string[];
  /** Whether a model can be enabled under the current payment path. */
  usable: (modelId: string) => boolean;
  disabledReason: (modelId: string) => string;
  onAdd: (ids: string[]) => void;
}) {
  const t = useTranslations("evidenceLibraryMock.config.ai.picker");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const q = query.trim().toLowerCase();
  const rows = (catalog ?? [])
    // "~provider/model-latest" rows are OpenRouter aliases of models already in the list.
    .filter((m) => !m.modelId.startsWith("~"))
    .filter((m) =>
      filter === "all" ? true : filter === "other" ? !NAMED.has(m.provider) : m.provider === filter,
    )
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setPicked(new Set());
      setQuery("");
      setFilter("all");
    }
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus />
          {t("title")}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/50 px-5 py-4">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 border-b border-border/50 bg-muted/30 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              placeholder={t("search")}
              className="bg-background pl-8"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button
                type="button"
                aria-label={t("cancel")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setQuery("")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  filter === f
                    ? "border-primary/40 bg-primary/10 font-medium text-primary"
                    : "border-border/50 bg-background text-muted-foreground hover:border-border/80 hover:text-foreground",
                )}
              >
                {NAMED.has(f) ? <ProviderMark provider={f} className="h-3.5 w-3.5" /> : null}
                {f === "all" ? t("all") : f === "other" ? t("other") : providerName(f)}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {catalog === undefined ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Spinner />
              {t("loading")}
            </p>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>{t("colModel")}</TableHead>
                  <TableHead className="text-right">{t("colPrice")}</TableHead>
                  <TableHead className="text-right">{t("colContext")}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      {t("noMatch")}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((m) => {
                    const added = addedIds.includes(m.modelId);
                    const ok = usable(m.modelId);
                    const checked = picked.has(m.modelId);
                    const off = added || !ok;
                    return (
                      <TableRow
                        key={m.modelId}
                        data-model-id={m.modelId}
                        title={!ok ? disabledReason(m.modelId) : undefined}
                        className={cn("cursor-pointer", off && "cursor-default opacity-60", checked && "bg-primary/5")}
                        onClick={() => !off && toggle(m.modelId)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={m.name}
                            checked={checked}
                            disabled={off}
                            onCheckedChange={() => toggle(m.modelId)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <ProviderMark provider={m.provider} className="h-4 w-4 shrink-0" />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{stripProviderPrefix(m.name)}</p>
                              <p className="truncate font-mono text-xs text-muted-foreground">{m.modelId}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                          {formatPrice(m.inputPricePerMillion, m.outputPricePerMillion, t("free"))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {formatContext(m.contextLength)}
                        </TableCell>
                        <TableCell>{added ? <StatusChip tone="neutral">{t("added")}</StatusChip> : null}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter className="items-center border-t border-border/50 px-5 py-3 sm:justify-between">
          <span className="text-sm text-muted-foreground">{t("pickedCount", { count: picked.size })}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => reset(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              disabled={picked.size === 0}
              onClick={() => {
                onAdd([...picked]);
                reset(false);
              }}
            >
              <Plus />
              {t("addPicked", { count: picked.size })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
