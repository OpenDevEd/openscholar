"use client";

// Settings > Admin > Publishing (plans/identifier-services): how each identifier service is used for reports
// (always, the author's pick, off), what it adds to the price, what authors pick, and which identifier the byline
// prints. Communities never register DOCiDs; they show the ones their records come with.

import { useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/convex/_generated/api";
import { LIST, Segmented, Zone } from "@/components/settings/parts";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
import { ArrowDown, ArrowUp, FileText, Lock } from "@/components/icons";
import { EASE } from "@/components/ui/opening";
import { useFailed } from "@/components/reports/words";
import { SERVICES, SERVICE_IDS, clampChoose, optionalOf, printable, settingsProblem, type Identifiers, type ServiceId, type ServiceMode } from "@/lib/reports/identifiers";
import { PRICE_MAX } from "@/lib/reports/report";
import { cn } from "@/lib/utils";

/**
 * On a phone at large text a service's controls are wider than its row: there they shrink and wrap, the choices onto
 * a second line, rather than widening the page. Where they fit, nothing changes.
 */
const CONTROLS = "flex shrink-0 items-center gap-3 max-sm:min-w-0 max-sm:shrink max-sm:flex-wrap";
const WRAPS = "max-sm:max-w-full max-sm:flex-wrap max-sm:rounded-[1.375rem]";

/** What can't be changed here, drawn as the app draws a locked control: a lock, faded, with why on hover. */
function Locked({ why, children }: { why: string; children: React.ReactNode }) {
  return (
    <TooltipHint label={why}>
      <span tabIndex={0} className="flex cursor-default items-center gap-2 opacity-50 max-sm:min-w-0">
        <Lock className="size-3.5 shrink-0 text-muted-foreground" />
        <span inert className="flex items-center gap-3 max-sm:min-w-0 max-sm:flex-wrap">
          {children}
        </span>
      </span>
    </TooltipHint>
  );
}

/** A service's mark, at the height its row's text needs. */
export function ServiceMark({ id, className }: { id: ServiceId; className?: string }) {
  return <img src={SERVICES[id].logo} alt={SERVICES[id].name} className={cn("h-5 w-auto shrink-0", id === "crossref" && "rounded bg-white p-px", className)} />;
}

/** What a service adds to a report's price: saved when the box is left, whole dollars from 0. */
function AddOn({ id, price, onSave }: { id: ServiceId; price: number; onSave: (dollars: number) => Promise<boolean> }) {
  const t = useTranslations("publishReports.identifiers");
  const [draft, setDraft] = useState(String(price));
  const [was, setWas] = useState(price);
  if (price !== was) {
    setWas(price);
    setDraft(String(price));
  }
  const commit = async () => {
    const dollars = Number(draft.replace(/^\+?\$?/, "").trim() || 0);
    if (dollars === price) return;
    if (!Number.isInteger(dollars) || dollars < 0 || dollars > PRICE_MAX || !(await onSave(dollars))) setDraft(String(price));
  };
  return (
    <span className="flex items-center gap-1">
      <span className="text-sm text-muted-foreground">+$</span>
      <Input aria-label={t("addOn", { service: SERVICES[id].name })} inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => void commit()} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className="h-8 w-16 text-end tabular-nums" />
    </span>
  );
}

export function IdentifierSettings({ identifiers: ids, connected }: { identifiers: Identifiers; /** The services whose accounts are set under Registration. */ connected: Record<ServiceId, boolean> }) {
  const t = useTranslations("publishReports.identifiers");
  const failed = useFailed();
  // A choice moves at once and the server's answer follows; a refusal moves it back.
  const update = useMutation(api.reports.settings.update).withOptimisticUpdate((store, { identifiers }) => {
    const now = store.getQuery(api.reports.settings.admin, {});
    if (now && identifiers) store.setQuery(api.reports.settings.admin, {}, { ...now, identifiers });
  });
  // Settings an author couldn't sign under are refused here, with why, before anything is sent: the server refuses them too.
  const set = (next: Identifiers) => {
    const problem = settingsProblem(next);
    if (problem) return (toast.error(t(`problem_${problem}`)), Promise.resolve(false));
    return update({ identifiers: next }).then(
      () => true,
      (error) => (failed(error), false),
    );
  };
  // A mode moved keeps the pick rule possible: never more picks than there are services to pick from.
  const service = (id: ServiceId, patch: Partial<Identifiers["services"][ServiceId]>) => set(clampChoose({ ...ids, services: { ...ids.services, [id]: { ...ids.services[id], ...patch } } }, ids));
  const optional = optionalOf(ids);
  const modes: Array<{ id: ServiceMode; label: string }> = [
    { id: "required", label: t("always") },
    { id: "optional", label: t("authorPicks") },
    { id: "off", label: t("off") },
  ];
  const rules = [
    { id: "any", label: t("anyOf"), min: 0, max: optional.length },
    { id: "one", label: t("atLeastOne"), min: 1, max: optional.length },
    ...(optional.length > 1 ? [{ id: "exactly", label: t("exactlyOne"), min: 1, max: 1 }] : []),
  ];
  const rule = rules.find((r) => r.min === ids.choose.min && Math.min(ids.choose.max, optional.length) === r.max)?.id ?? "any";
  const order = ids.citeFirst;
  const move = (id: ServiceId, by: -1 | 1) => {
    const at = order.indexOf(id);
    const next = [...order];
    [next[at], next[at + by]] = [next[at + by]!, next[at]!];
    void set({ ...ids, citeFirst: next });
  };
  const on = SERVICE_IDS.filter((id) => connected[id] && ids.services[id].mode !== "off");
  const hint = (id: ServiceId) => t(`hint_${id}`);

  return (
    <Zone
      label={t("title")}
      aside={
        <span className="flex flex-wrap items-center justify-end gap-2">
          {on.map((id) => (
            <StatusChip key={id} tone={ids.services[id].mode === "required" ? "success" : "neutral"}>
              {SERVICES[id].name}
            </StatusChip>
          ))}
        </span>
      }
    >
      <ul className={LIST}>
        {SERVICE_IDS.map((id) => {
          const s = ids.services[id];
          const ready = connected[id];
          // Zenodo keeps the copy every Crossref DOI leads to, so it stays on while Crossref is used.
          const tied = id === "zenodo" && ready && connected.crossref && ids.services.crossref.mode !== "off";
          const why = !ready ? t("turnOnFirst", { service: SERVICES[id].name }) : tied ? t("zenodoTied") : null;
          return (
            <li key={id} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5">
              <span className="min-w-0 flex-1 basis-52">
                {/* On a phone at large text the identifier's name goes under the service's mark. */}
                <span className="flex h-6 items-center gap-x-2 max-sm:h-auto max-sm:min-h-6 max-sm:flex-wrap">
                  <ServiceMark id={id} />
                  <span className="rounded bg-inset px-1.5 text-2xs text-muted-foreground">{SERVICES[id].identifier}</span>
                </span>
                <span className="block text-xs text-muted-foreground">{ready ? hint(id) : t("notConnected")}</span>
              </span>
              {why ? (
                <span className={CONTROLS}>
                  <Locked why={why}>
                    <Segmented label={t("when", { service: SERVICES[id].name })} value={tied ? "required" : "off"} onChange={() => undefined} options={modes} className={WRAPS} />
                  </Locked>
                  {/* Only its mode is locked: Zenodo with Crossref still adds what its price says. */}
                  {tied ? <AddOn id={id} price={s.price} onSave={(price) => service(id, { price })} /> : null}
                </span>
              ) : (
                <span className={CONTROLS}>
                  <Segmented label={t("when", { service: SERVICES[id].name })} value={s.mode} onChange={(mode) => void service(id, { mode })} options={modes} className={WRAPS} />
                  <span className={cn("transition-opacity", s.mode === "off" && "pointer-events-none opacity-40")}>
                    <AddOn id={id} price={s.price} onSave={(price) => service(id, { price })} />
                  </span>
                </span>
              )}
            </li>
          );
        })}
        <AnimatePresence initial={false}>
          {optional.length ? (
            <motion.li key="pick" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t("pick")}</span>
                  <span className="block text-xs text-muted-foreground">{t("pickHint", { services: optional.map((id) => SERVICES[id].name).join(" + ") })}</span>
                </span>
                <Segmented
                  className={WRAPS}
                  label={t("pick")}
                  value={rule}
                  onChange={(picked) => {
                    const r = rules.find((x) => x.id === picked)!;
                    void set({ ...ids, choose: { min: r.min, max: r.max } });
                  }}
                  options={rules.map(({ id, label }) => ({ id, label }))}
                />
              </div>
            </motion.li>
          ) : null}
        </AnimatePresence>
        <li className="space-y-2.5 px-4 py-3.5">
          <span className="block min-w-0">
            <span className="block text-sm font-medium">{t("byline")}</span>
            <span className="block text-xs text-muted-foreground">{t("bylineHint")}</span>
          </span>
          <ol className="space-y-1.5">
            {order.map((id, at) => (
              <motion.li key={id} layout="position" transition={{ duration: 0.3, ease: EASE }} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-inset px-3 py-2">
                <span className="w-4 text-center text-xs tabular-nums text-muted-foreground">{at + 1}</span>
                <span className="flex min-w-0 flex-1 items-center">
                  <ServiceMark id={id} />
                </span>
                {id === "docid" ? (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {t("mintAtSigning")}
                    <Switch checked={ids.docidAtSigning} onCheckedChange={(docidAtSigning) => void set({ ...ids, docidAtSigning })} aria-label={t("mintAtSigning")} />
                  </label>
                ) : null}
                {printable(ids, id) ? null : (
                  <Locked why={t("notPrintableWhy")}>
                    <span className="text-xs text-muted-foreground">{t("notPrintable")}</span>
                  </Locked>
                )}
                <span className="flex">
                  <Button variant="ghost" size="icon-xs" aria-label={t("moveUp", { service: SERVICES[id].name })} disabled={at === 0} onClick={() => move(id, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label={t("moveDown", { service: SERVICES[id].name })} disabled={at === order.length - 1} onClick={() => move(id, 1)}>
                    <ArrowDown />
                  </Button>
                </span>
              </motion.li>
            ))}
          </ol>
          <AutoHeight>
            {ids.docidAtSigning && ids.services.docid.mode !== "off" ? (
              <p className="flex items-start gap-2 pt-0.5 text-xs text-pretty text-muted-foreground">
                <FileText className="mt-px size-3.5 shrink-0" />
                {t("mintAtSigningHint")}
              </p>
            ) : null}
          </AutoHeight>
        </li>
      </ul>
    </Zone>
  );
}
