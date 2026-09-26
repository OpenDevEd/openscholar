"use client";

/**
 * "On our servers" card — the credits-path server model (Chat / Extraction /
 * Screen All). Presets (aiModelConfig) joined to the live catalog for pricing,
 * the user's sticky choice (userAiConfig); writes via setPreset / setCustomModel.
 * Hidden entirely when credits are disabled; shows a sign-in gate when logged out.
 */

import { useState, type ComponentType } from "react";
import { useQuery, useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getModelIcon } from "@/components/icons/provider-icons";
import {
  Coins, Zap, Scale, Brain, SlidersHorizontal, Check, Search,
  ChevronDown, Loader2, ArrowRight,
  Star,
} from "lucide-react";

type Ico = ComponentType<{ className?: string }>;
type PresetKey = "fast" | "balanced" | "intelligent";

const PRESET_META: Record<PresetKey, { icon: Ico; ico: string; dot: string; bg: string; recommended?: boolean }> = {
  fast: { icon: Zap, ico: "text-emerald-500", dot: "border-l-emerald-500", bg: "bg-emerald-500/5" },
  balanced: { icon: Scale, ico: "text-blue-500", dot: "border-l-blue-500", bg: "bg-blue-500/5", recommended: true },
  intelligent: { icon: Brain, ico: "text-purple-500", dot: "border-l-purple-500", bg: "bg-purple-500/5" },
};
const ORDER: PresetKey[] = ["fast", "balanced", "intelligent"];

const price = (i: number, o: number) => (i === 0 && o === 0 ? "free" : `$${i.toFixed(2)} / $${o.toFixed(2)} /1M`);
// Catalog names are "Vendor: Model" — the brand icon already conveys the vendor.
const stripProvider = (name: string) => name.replace(/^[^:]{1,24}:\s+/, "");

export function ServerModelSection({
  signedIn,
  creditsEnabled,
  onSignIn,
}: {
  signedIn: boolean;
  creditsEnabled: boolean;
  onSignIn: () => void;
}) {
  const t = useTranslations("aiSettings");
  const tc = useTranslations("common");
  const cfg = useQuery(api.userAiConfig.queries.get, signedIn ? {} : "skip");
  const config = useQuery(api.aiModelConfig.queries.list, creditsEnabled ? {} : "skip");
  const catalog = useQuery(api.models.queries.listCatalogOptions, creditsEnabled ? {} : "skip");
  const setPreset = useMutation(api.userAiConfig.mutations.setPreset);
  const setCustomModel = useMutation(api.userAiConfig.mutations.setCustomModel);

  const [customOpen, setCustomOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Credits disabled → no server features at all.
  if (!creditsEnabled) return null;

  const Header = (
    <div className="space-y-1.5 border-b border-border/50 bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <h3 className="flex-1 text-sm font-semibold">{t("primaryModelTitle")}</h3>
        <span className="flex h-6 items-center gap-1 rounded-md bg-amber-500/15 px-2 text-xs font-medium text-amber-700"><Coins className="h-3.5 w-3.5" /> {t("creditsOnly")}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t("primaryModelDesc")}</p>
    </div>
  );

  // Signed-out → sign-in gate.
  if (!signedIn) {
    return (
      <section className="overflow-hidden rounded-2xl border-2 border-border/60">
        {Header}
        <div className="flex flex-col items-center gap-3 p-4 py-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"><Coins className="h-6 w-6" /></div>
          <div>
            <p className="text-sm font-semibold">{t("getStartedSignInTitle")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("serverSignInBlurb")}</p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={onSignIn}><ArrowRight className="h-4 w-4" /> {tc("signIn")}</Button>
        </div>
      </section>
    );
  }

  const loading = cfg === undefined || config === undefined || catalog === undefined;
  const activeKey = cfg?.serverPreset ?? "balanced";
  const bySlug = new Map((catalog ?? []).map((m) => [m.modelId, m]));
  const byId = new Map((catalog ?? []).map((m) => [m._id, m]));
  const presets = (config ?? [])
    .filter((r) => r.key.startsWith("preset."))
    .map((r) => ({ key: r.key.slice("preset.".length) as PresetKey, label: r.label ?? r.key, slug: r.modelId }))
    .filter((r) => ORDER.includes(r.key))
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const customModel = cfg?.serverModelId ? byId.get(cfg.serverModelId) : undefined;
  const filtered = (catalog ?? []).filter((m) => m.name.toLowerCase().includes(search.toLowerCase())).slice(0, 80);

  return (
    <section className="overflow-hidden rounded-2xl border-2 border-border/60">
      {Header}
      <div className="space-y-2.5 p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loadingModels")}</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {presets.map((pst) => {
                const meta = PRESET_META[pst.key];
                const Icon = meta.icon;
                const m = bySlug.get(pst.slug);
                const Brand = getModelIcon(pst.slug);
                const on = activeKey === pst.key;
                return (
                  <button
                    key={pst.key}
                    type="button"
                    onClick={() => setPreset({ serverPreset: pst.key })}
                    className={cn("relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition-all", on ? cn("border-l-[4px] border-t-border/50 border-r-border/50 border-b-border/50", meta.dot, meta.bg) : "border-border/50 hover:border-border/80 hover:bg-muted/30")}
                  >
                    {meta.recommended && <Star aria-label={t("recommended")} className={cn("absolute right-2 top-2 size-3.5 fill-blue-500 text-blue-500", !on && "opacity-50")}><title>{t("recommended")}</title></Star>}
                    <Icon className={cn("h-6 w-6", on ? meta.ico : "text-muted-foreground")} />
                    <span className="flex items-center gap-1 text-sm font-semibold">{pst.label}{on && <Check className={cn("h-3.5 w-3.5", meta.ico)} />}</span>
                    <span className="block w-full text-center text-[11px] text-muted-foreground"><Brand className="mr-1 inline-block h-3 w-3 align-[-2px]" />{stripProvider(m?.name ?? pst.slug)}</span>
                    {m && <span className="text-[11px] font-medium text-foreground/70">{price(m.inputPricePerMillion, m.outputPricePerMillion)}</span>}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setCustomOpen((o) => !o)}
              className={cn("flex w-full items-center gap-2.5 rounded-xl border-2 p-2.5 text-left transition-all", activeKey === "custom" ? "border-l-[4px] border-l-primary border-t-border/50 border-r-border/50 border-b-border/50 bg-primary/5" : "border-border/50 hover:border-border/80")}
            >
              <SlidersHorizontal className={cn("h-4 w-4", activeKey === "custom" ? "text-primary" : "text-muted-foreground")} />
              <span className="flex-1 text-sm font-medium">{t("customModel")}{activeKey === "custom" && customModel && <span className="ml-1.5 text-xs text-muted-foreground">· {customModel.name}</span>}</span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", customOpen && "rotate-180")} />
            </button>

            {customOpen && (
              <div className="overflow-hidden rounded-xl border-2 border-border/50 bg-muted/20">
                <div className="border-b border-border/40 p-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input placeholder={t("searchModels")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-8 text-sm" />
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto p-1.5">
                  {filtered.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">{tc("noModelsFound")}</div>
                  ) : (
                    filtered.map((m) => {
                      const Brand = getModelIcon(m.modelId);
                      const sel = activeKey === "custom" && cfg?.serverModelId === m._id;
                      return (
                        <button
                          key={m._id}
                          type="button"
                          onClick={() => { setCustomModel({ serverModelId: m._id as Id<"models"> }); setCustomOpen(false); }}
                          className={cn("flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors", sel ? "border-primary/20 bg-primary/10" : "border-transparent hover:bg-accent")}
                        >
                          <Brand className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate text-sm font-medium">{stripProvider(m.name)}</span>
                          <span className="whitespace-nowrap text-[11px] text-muted-foreground">{price(m.inputPricePerMillion, m.outputPricePerMillion)}</span>
                          {sel && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
