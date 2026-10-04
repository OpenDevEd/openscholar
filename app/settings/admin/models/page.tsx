"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { Boxes, Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getModelIcon } from "@/components/icons/provider-icons";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useAppToast } from "@/lib/toast";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { Enter, LIST, Paged, Segmented, Tile } from "@/components/settings/parts";
import { IntelligenceMeter, priceLabel } from "@/components/models/meters";
import { tintOf } from "@/components/settings/model-map";

type Show = "all" | "on" | "off";
const PER_PAGE = 12;
const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic", google: "Google", openai: "OpenAI", "meta-llama": "Meta", mistralai: "Mistral",
  deepseek: "DeepSeek", qwen: "Qwen", "z-ai": "Z.ai", "x-ai": "xAI",
};
const providerName = (p: string) => PROVIDER_NAMES[p] ?? p.charAt(0).toUpperCase() + p.slice(1);

const context = (n?: number) => (n ? (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`) : "");

export default function ModelListPage() {
  const t = useTranslations("settingsAdmin.models");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const [provider, setProvider] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<Show>("all");
  // The list is filtered and read a page at a time on the server; the summary totals the view and names the chips.
  const view = { ...(provider ? { provider } : {}), search: useDebouncedValue(search.trim(), 300), show };
  const models = useCursorPage(api.models.admin.listModels, view, PER_PAGE);
  const { data: counted } = useProtectedQuery(api.models.admin.summary, view);
  // The last summary stays up while another view is counted.
  const [summary, setSummary] = useState(counted);
  if (counted !== undefined && counted !== summary) setSummary(counted);
  const setOffered = useMutation(api.models.admin.setOffered).withOptimisticUpdate((store, { modelId, on }) => {
    // Every page of the list that's subscribed, whichever view and cursor it was read with.
    for (const { args, value } of store.getAllQueries(api.models.admin.listModels)) {
      if (value) store.setQuery(api.models.admin.listModels, args, { ...value, page: value.page.map((r) => (r._id === modelId ? { ...r, on } : r)) });
    }
  });

  const chips = [
    { key: null, label: tc("all"), sample: null as string | null },
    ...(summary?.providers ?? []).map((p) => ({ key: p.provider, label: providerName(p.provider), sample: p.sampleModelId })),
    { key: "other", label: tc("other"), sample: null as string | null },
  ];

  return (
    <Enter ready={!models.isLoading && summary !== undefined}>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("filterByProvider")}>
          {chips.map((chip) => {
            const active = provider === chip.key;
            const Brand = chip.sample ? getModelIcon(chip.sample) : Boxes;
            const tint = chip.sample ? tintOf(chip.sample) : "var(--primary)";
            return (
              <button
                key={chip.key ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => setProvider(chip.key)}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-full border pl-2.5 pr-3.5 text-sm font-medium transition-colors",
                  active ? "border-transparent" : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                style={active ? { backgroundColor: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint } : undefined}
              >
                <Brand className="size-4" />
                {chip.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("search")}
                aria-label={t("search")}
                className="h-11 rounded-2xl border border-border/60 bg-muted/40 pl-11"
              />
            </div>
            <Segmented
              label={t("show")}
              value={show}
              onChange={setShow}
              options={[
                { id: "all", label: tc("all") },
                { id: "on", label: t("on") },
                { id: "off", label: t("off") },
              ]}
            />
          </div>
          <Paged pager={{ list: models, size: PER_PAGE, total: summary?.total }} rowHeight={61} label={t("models")}>
            <ul className={LIST}>
              {models.items.map((m) => (
                <li key={m._id} className={cn("flex items-center gap-3 p-3 transition-opacity", !m.on && "opacity-50")}>
                  <Tile icon={getModelIcon(m.modelId)} tint={m.on ? tintOf(m.modelId) : "#94a3b8"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{stripProviderPrefix(m.name)}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{m.modelId}</span>
                  </span>
                  {m.contextLength ? <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{context(m.contextLength)}</span> : null}
                  <IntelligenceMeter index={m.intelligenceIndex} className="w-24" />
                  <span className="w-[5.5rem] text-right text-xs tabular-nums text-muted-foreground">
                    {m.inputPricePerMillion + m.outputPricePerMillion === 0 ? t("free") : priceLabel(m.inputPricePerMillion, m.outputPricePerMillion)}
                  </span>
                  <Switch
                    checked={m.on}
                    aria-label={t("offer", { model: stripProviderPrefix(m.name) })}
                    onCheckedChange={(on) =>
                      setOffered({ modelId: m._id, on }).catch((error: unknown) => {
                        console.error("[settings] model change failed", { modelId: m.modelId, error });
                        toast.error(tc("somethingWentWrong"), getErrorMessage(error, tc("somethingWentWrong")));
                      })
                    }
                  />
                </li>
              ))}
              {!models.isLoading && models.items.length === 0 ? <li className="py-10 text-center text-sm text-muted-foreground">{t("noMatches")}</li> : null}
            </ul>
          </Paged>
        </div>
      </div>
    </Enter>
  );
}
