"use client";

// Settings > Admin > Publishing (plans/publish-reports): the Publish button, human review, each workspace's daily
// limit, the series and its DOIs, the model that reads PDFs, the checks, and the agreement.

import { useState, useTransition, type ComponentProps } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import type { FunctionReturnType } from "convex/server";
import { parseAsBoolean, parseAsString, useQueryStates } from "nuqs";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Enter, LIST, Segmented, Tile, Working, Zone } from "@/components/settings/parts";
import { NodeCard, toMapModel, tintOf, type MapModel, type PickedModel } from "@/components/settings/model-map";
import { getModelIcon } from "@/components/icons/provider-icons";
import { ModelPicker } from "@/components/models/model-picker";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { Field } from "@/components/evidence-libraries/configuration/section-card";
import { PublicationForm } from "@/components/evidence-libraries/configuration/sections/publication-section";
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUpRight, FileText, Hash, PenLine, Pencil, Plus, Trash2 } from "@/components/icons";
import { ACTIVATION_PLAN, THREE_ACTIVATIONS_PLAN } from "@/lib/billing/plans";
import { DEFAULT_LICENCE } from "@/lib/reports/report";
import { mockSeries } from "@/components/reports/licence-mock";
import type { Effort } from "@/lib/ai/core/call-options";
import { isDecisionModel, JEV_MODEL } from "@/lib/ai/decisions";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { AGREEMENT_MAX, CHECK_NAME_MAX, CHECK_TEXT_MAX, MAX_CHECKS, bylineOf, canRegister, crossrefDoiOf, isIssn } from "@/lib/reports/settings";
import { fillAgreement } from "@/lib/reports/agreement";
import { useCheckWords, useFailed } from "@/components/reports/words";
import { stepBack, withoutKeys } from "@/lib/url-state/step-back";
import { cn } from "@/lib/utils";

type Settings = FunctionReturnType<typeof api.reports.settings.admin>;
type CheckRow = Settings["checks"][number];

/** How sure, as a percentage in the reader's language. */
const usePct = () => {
  const format = useFormatter();
  return (n: number) => format.number(n, { style: "percent", maximumFractionDigits: 0 });
};
/** A check's or the reader's model as its card shows it, or none when the model has left the catalog. */
const cardOf = (model: Settings["metadataModel"], effort: Effort | undefined) => (model ? toMapModel(model, effort ?? null) : undefined);
/** The picker's trigger: it takes the popover's handlers and ref through `asChild`, so it passes them to its button. */
function PickButton(props: ComponentProps<typeof Button>) {
  const t = useTranslations("publishReports.settings");
  return (
    <Button type="button" variant="outline" size="sm" {...props}>
      {t("pickModel")}
    </Button>
  );
}

/**
 * What is open on the page, in its address: the check being edited (its ID, or "new") and the agreement's editor.
 * Opening one is a step in the browser's history, so Back closes it and a link or a reload lands on the same thing.
 */
export const SETTINGS_PLACE = { check: parseAsString, agreement: parseAsBoolean.withDefault(false) };
const NAV = SETTINGS_PLACE;

const Tag = ({ children }: { children: React.ReactNode }) => <span className="shrink-0 rounded bg-background px-1.5 text-2xs tabular-nums text-muted-foreground">{children}</span>;

/** A row of a settings list: a name and a short hint, with its control on the right. */
function Row({ label, hint, children, wide = false }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <li className={cn("flex gap-x-6 gap-y-2 px-4 py-3.5", wide ? "flex-col" : "flex-wrap items-center justify-between")}>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      {children}
    </li>
  );
}

export function AdminPublishingSettings() {
  const { data: settings } = useProtectedQuery(api.reports.settings.admin, {});
  // What an activation costs is the activation plan's price in Autumn, as the synced catalog has it.
  const catalog = useQuery(api.billing.catalog.get, {});
  const links = useQuery(api.admins.queries.links, {});
  if (!settings || catalog === undefined || links === undefined) return <Enter ready={false}>{null}</Enter>;
  const priceOf = (id: string) => catalog?.plans.find((plan) => plan.id === id)?.price?.amount ?? null;
  return (
    <Enter ready>
      {/* mock: dev's Autumn has no three-activation plan, and dev's saved byline has no {licence} yet (licence-mock.ts). */}
      <SettingsView settings={{ ...settings, series: mockSeries(settings.series) }} prices={{ one: priceOf(ACTIVATION_PLAN), three: priceOf(THREE_ACTIVATIONS_PLAN) ?? (priceOf(ACTIVATION_PLAN) === null ? null : priceOf(ACTIVATION_PLAN)! * 3) }} autumn={links.autumn ?? null} />
    </Enter>
  );
}

function SettingsView({ settings, prices, autumn }: { settings: Settings; /** What one activation, and three, cost in US dollars; null while Autumn sells none. */ prices: Prices; /** Autumn's dashboard. */ autumn: string | null }) {
  const [nav, setNav] = useQueryStates(NAV);
  const t = useTranslations("publishReports.settings");
  const format = useFormatter();
  const failed = useFailed();
  // A dialog opens over the page where it is, and closing it with its own button takes the step back when that step
  // is there (lib/url-state/step-back.ts), so Back never reopens what was just closed.
  const go = (next: Parameters<typeof setNav>[0]) => void setNav(next, { history: "push", scroll: false });
  const up = (...closed: Array<keyof typeof NAV>) => {
    if (!stepBack(withoutKeys(closed))) void setNav(Object.fromEntries(closed.map((key) => [key, null])));
  };
  // A switch moves at once and the server's answer follows; a refusal moves it back.
  const update = useMutation(api.reports.settings.update).withOptimisticUpdate((store, { enabled, humanReview }) => {
    const now = store.getQuery(api.reports.settings.admin, {});
    if (now) store.setQuery(api.reports.settings.admin, {}, { ...now, ...(enabled !== undefined && { enabled }), ...(humanReview !== undefined && { humanReview }) });
  });
  const switchCheck = useMutation(api.reports.settings.switchCheck).withOptimisticUpdate((store, { id, enabled }) => {
    const now = store.getQuery(api.reports.settings.admin, {});
    if (now) store.setQuery(api.reports.settings.admin, {}, { ...now, checks: now.checks.map((check) => (check.id === id ? { ...check, enabled } : check)) });
  });
  const setMetadataModel = useMutation(api.reports.settings.setMetadataModel);
  const savePublication = useAction(api.reports.publicationActions.save);
  // A typed value says it was saved, since leaving the box is all that saves it.
  const said = (work: Promise<unknown>, saved: string) =>
    work.then(
      () => (toast.success(saved), true),
      (error) => (failed(error), false),
    );
  const save = (patch: Parameters<typeof update>[0], saved: string) => said(update(patch), saved);
  // What the server refuses in the series, said here in the page's language before anything is sent.
  const seriesRefusal = ({ name, byline, issn }: Partial<Settings["series"]>) =>
    name !== undefined && !name.trim() ? t("enterSeriesName")
    : byline !== undefined && !byline.trim() ? t("enterByline")
    : byline !== undefined && !byline.includes("{doi}") ? t("bylineNeedsDoi", { doi: "{doi}" })
    : byline !== undefined && !byline.includes("{licence}") ? t("bylineNeedsLicence", { licence: "{licence}" })
    : issn?.trim() && !isIssn(issn.trim().toUpperCase()) ? t("notIssn")
    : null;
  const series = (part: Partial<Settings["series"]>, saved: string) => {
    const refused = seriesRefusal(part);
    return refused ? (toast.error(refused), Promise.resolve(false)) : save({ series: part }, saved);
  };

  const { zenodo, crossref } = settings.publication;
  const registers = canRegister(settings.publication);
  const sampleDoi = crossrefDoiOf(settings.publication, "R100015");
  const reader = cardOf(settings.metadataModel, settings.metadataEffort);
  const editing: CheckRow | "new" | null = nav.check === "new" ? "new" : (settings.checks.find((check) => check.id === nav.check) ?? null);

  return (
    <div className="space-y-8">
      <Zone label={t("publishing")}>
        <ul className={LIST}>
          <li>
            <label className={cn("flex items-center justify-between gap-6 px-4 py-3.5 transition-colors", registers && "cursor-pointer hover:bg-muted")}>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t("publishButton")}</span>
                <span className="block text-xs text-muted-foreground">{t(registers ? "publishOn" : "publishOff")}</span>
              </span>
              <Switch checked={settings.enabled && registers} disabled={!registers} onCheckedChange={(enabled) => void update({ enabled }).catch(failed)} />
            </label>
          </li>
          <li>
            <label className="flex cursor-pointer items-center justify-between gap-6 px-4 py-3.5 transition-colors hover:bg-muted">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t("humanReview")}</span>
                <span className="block text-xs text-muted-foreground">{t("humanReviewHint")}</span>
              </span>
              <Switch checked={settings.humanReview} onCheckedChange={(humanReview) => void update({ humanReview }).catch(failed)} />
            </label>
          </li>
        </ul>
      </Zone>

      <Activations prices={prices} autumn={autumn} />

      <Zone label={t("series")}>
        <ul className={LIST}>
          <Row label={t("series")}>
            <SavedInput value={settings.series.name} onSave={(name) => series({ name }, t("seriesSaved"))} className="w-64" ariaLabel={t("seriesName")} />
          </Row>
          <Row label={t("issn")} hint={t("issnHint", { pending: "{pending}" })}>
            <SavedInput value={settings.series.issn} placeholder={t("issnPending")} onSave={(issn) => series({ issn }, t("issnSaved"))} className="w-40 font-mono" ariaLabel={t("issn")} />
          </Row>
          <Row label={t("byline")} hint={t("bylineHint", { series: "{series}", issn: "{issn}", doi: "{doi}", licence: "{licence}" })} wide>
            <SavedInput value={settings.series.byline} onSave={(byline) => series({ byline }, t("bylineSaved"))} className="w-full" ariaLabel={t("byline")} />
            <p className="flex items-start gap-2 rounded-xl bg-inset px-3 py-2.5 text-xs text-muted-foreground">
              <FileText className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{bylineOf(settings.series, sampleDoi ?? "…", DEFAULT_LICENCE)}</span>
            </p>
          </Row>
        </ul>
      </Zone>

      {/* The form a community's settings use. Here Crossref can be on alone: Openscholar chooses whether Zenodo archives its reports. */}
      <Zone
        label={t("registration")}
        aside={
          <span className="flex flex-wrap items-center justify-end gap-2">
            {zenodo.mode !== "off" ? <StatusChip tone={zenodo.mode === "sandbox" ? "warning" : "success"}>{zenodo.mode === "sandbox" ? t("zenodoSandbox") : "Zenodo"}</StatusChip> : null}
            {crossref.mode !== "off" ? <StatusChip tone={crossref.mode === "sandbox" ? "warning" : "success"}>{crossref.mode === "sandbox" ? t("crossrefSandbox") : "Crossref"}</StatusChip> : null}
            {registers ? null : <StatusChip tone="neutral">{t("off")}</StatusChip>}
          </span>
        }
      >
        <div className="space-y-5 rounded-2xl border border-border-subtle p-4">
          <PublicationForm
            key={settings.publicationSavedAt}
            saved={{ settings: settings.publication, updatedAt: settings.publicationSavedAt, verifiedAt: settings.publicationSavedAt, custom: settings.publicationCustom }}
            crossrefAlone
            words={{
              zenodoHint: t("zenodoHint"),
              crossrefHint: t("crossrefHint"),
              namespaceHint: t("namespaceHint"),
              namespacePlaceholder: "openscholar-reports",
              savedHint: t("savedHint"),
            }}
            onSave={savePublication}
          />
          <p className="flex items-center gap-2 rounded-xl bg-inset px-3 py-2.5 font-mono text-xs text-muted-foreground">
            <Hash className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{sampleDoi ?? t("noDoi")}</span>
          </p>
        </div>
      </Zone>

      <Zone label={t("metadata")}>
        <div className="space-y-2">
          <ModelPicker
            current={reader}
            efforts
            tasks={["extraction"]}
            onChange={(picked, effort) => void setMetadataModel({ modelId: picked._id!, ...(effort && { effort }) }).catch(failed)}
            trigger={reader ? <NodeCard model={reader} paidBy="credits" interactive /> : <PickButton />}
          />
          <p className="ps-1 text-xs text-muted-foreground">{t(reader ? "readerHint" : "readerGone")}</p>
        </div>
      </Zone>

      <Zone
        label={t("checks")}
        aside={
          <span className="flex items-center gap-2">
            <StatusChip tone="neutral">{t("version", { version: settings.checksVersion })}</StatusChip>
            <Button size="sm" variant="outline" disabled={settings.checks.length >= MAX_CHECKS} onClick={() => go({ check: "new" })}>
              <Plus /> {t("addCheck")}
            </Button>
          </span>
        }
      >
        <ul className={LIST}>
          {settings.checks.map((check) => (
            <CheckSettingRow key={check.id} check={check} onEdit={() => go({ check: check.id })} onToggle={(enabled) => void switchCheck({ id: check.id, enabled }).catch(failed)} />
          ))}
        </ul>
        <p className="ps-1 text-xs text-muted-foreground">{t("checksHint")}</p>
      </Zone>

      <Zone label={t("agreement")}>
        <ul className={LIST}>
          <li className="flex items-center gap-3 px-4 py-3.5">
            <Tile icon={PenLine} tint="var(--primary)" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {t("agreementName")} <Tag>v{settings.agreement.version}</Tag>
              </span>
              <span className="block truncate text-xs text-muted-foreground">{settings.agreement.updatedAt ? t("changed", { date: format.dateTime(settings.agreement.updatedAt, { day: "numeric", month: "short", year: "numeric" }) }) : t("asWritten")}</span>
            </span>
            <Button variant="outline" size="sm" onClick={() => go({ agreement: true })}>
              <Pencil /> {t("edit")}
            </Button>
          </li>
        </ul>
      </Zone>

      <CheckDialog check={editing} onClose={() => up("check")} />
      <AgreementDialog open={nav.agreement} agreement={settings.agreement} series={settings.series} onClose={() => up("agreement")} />
    </div>
  );
}

/** What buying an activation costs, and where activations are given: the price and each workspace's balance are Autumn's. */
type Prices = { one: number | null; three: number | null };

function Activations({ prices, autumn }: { prices: Prices; autumn: string | null }) {
  const t = useTranslations("publishReports.settings");
  const format = useFormatter();
  // The plan that buys one activation, for CC BY and CC BY-SA, and the one that buys three, for the other licences.
  return (
    <Zone label={t("activations")}>
      <ul className={LIST}>
        {(["one", "three"] as const).map((plan) => {
          const price = prices[plan];
          const cost = price === null ? t("notOnSale") : format.number(price, { style: "currency", currency: "USD", minimumFractionDigits: price % 1 ? 2 : 0 });
          return (
            <Row key={plan} label={t(plan === "one" ? "price" : "priceThree")} hint={t(`${plan === "one" ? "priceHint" : "priceThreeHint"}${price === null ? "None" : ""}`)}>
              {autumn ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={autumn} target="_blank" rel="noopener noreferrer">
                    {cost} <ArrowUpRight />
                  </a>
                </Button>
              ) : (
                <span className="text-sm font-medium tabular-nums">{cost}</span>
              )}
            </Row>
          );
        })}
        <Row label={t("balances")} hint={t("balancesHint")}>
          {autumn ? (
            <Button variant="outline" size="sm" asChild>
              <a href={autumn} target="_blank" rel="noopener noreferrer">
                {t("openAutumn")} <ArrowUpRight />
              </a>
            </Button>
          ) : null}
        </Row>
      </ul>
    </Zone>
  );
}

/** An input that saves when it loses focus or Enter is pressed. */
function SavedInput({ value, onSave, className, placeholder, ariaLabel }: { value: string; /** Resolves false when the value was refused: the box then shows what is saved. */ onSave: (v: string) => Promise<boolean>; className?: string; placeholder?: string; ariaLabel?: string }) {
  const [draft, setDraft] = useState(value);
  const [was, setWas] = useState(value);
  if (value !== was) {
    setWas(value);
    // Only a box still showing what was saved follows a new saved value: typing done since is never replaced.
    if (draft === was) setDraft(value);
  }
  const commit = () => {
    const next = draft.trim();
    setDraft(next);
    if (next !== value) void onSave(next).then((kept) => kept || setDraft(value));
  };
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      className={cn("h-8", className)}
    />
  );
}

function CheckSettingRow({ check, onEdit, onToggle }: { check: CheckRow; onEdit: () => void; onToggle: (on: boolean) => void }) {
  const Brand = getModelIcon(check.modelId);
  const t = useTranslations("publishReports.settings");
  const pct = usePct();
  // In the admin's language while it is a check as Openscholar ships it; the form still edits the stored words.
  const name = useCheckWords().name(check.name);
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3", !check.enabled && "opacity-60")}>
      <Tile icon={Brand} tint={tintOf(check.modelId)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          {check.builtIn ? <Tag>{t("builtIn")}</Tag> : null}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{check.model?.name ?? t("modelGone")}</span>
          {check.builtIn ? null : <Tag>{t("passesAt", { percent: pct(check.threshold) })}</Tag>}
          <Tag>{t(check.blocking ? "blocks" : "flags")}</Tag>
        </span>
      </span>
      <Button variant="ghost" size="sm" aria-label={t("editCheck", { name })} className="text-muted-foreground" onClick={onEdit}>
        <Pencil /> {t("edit")}
      </Button>
      <Switch checked={check.enabled} onCheckedChange={onToggle} aria-label={t("checkOn", { name })} />
    </li>
  );
}

type CheckForm = { id?: string; name: string; question: string; fix: string; model: (MapModel & Partial<Pick<PickedModel, "_id">>) | undefined; threshold: number; blocking: boolean; enabled: boolean; builtIn: boolean };
const BLANK: CheckForm = { name: "", question: "", fix: "", model: undefined, threshold: 0.7, blocking: true, enabled: true, builtIn: false };
const formOf = (check: CheckRow): CheckForm => ({ id: check.id, name: check.name, question: check.question, fix: check.fix ?? "", model: cardOf(check.model, check.effort), threshold: check.threshold, blocking: check.blocking, enabled: check.enabled, builtIn: !!check.builtIn });

/** A check: a yes-or-no question, the model that answers it, how sure of yes it must be, and what a fail does. */
function CheckDialog({ check, onClose }: { check: CheckRow | "new" | null; onClose: () => void }) {
  const saveCheck = useMutation(api.reports.settings.saveCheck);
  const removeCheck = useMutation(api.reports.settings.removeCheck);
  const [form, setForm] = useState<CheckForm>(BLANK);
  const [was, setWas] = useState<CheckRow | "new" | null>(null);
  // Filled when it opens, and left as it is while it closes, so the fade-out shows what was there.
  if (check !== was) {
    setWas(check);
    if (check && (check === "new" || was === null || was === "new" || was.id !== check.id)) setForm(check === "new" ? BLANK : formOf(check));
  }
  const [busy, start] = useTransition();
  const t = useTranslations("publishReports.settings");
  const failed = useFailed();
  const pct = usePct();
  const set = <K extends keyof CheckForm>(key: K, value: CheckForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const isNew = form.id === undefined;
  const decides = isDecisionModel(form.model?.id ?? JEV_MODEL);
  const sample = form.builtIn ? { found: null } : { answer: "yes", confidence: 0.94, ...(decides ? {} : { reasoning: t("sampleReasoning") }) };
  const ready = form.name.trim() && form.question.trim() && form.model?._id;
  const run = (work: () => Promise<unknown>, done: string) =>
    start(async () => {
      try {
        await work();
        toast.success(done);
        onClose();
      } catch (error) {
        failed(error);
      }
    });
  return (
    <Dialog open={check !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(isNew ? "addTitle" : "editTitle")}</DialogTitle>
          <DialogDescription>
            {t(form.builtIn ? "builtInIntro" : "checkIntro")}
          </DialogDescription>
        </DialogHeader>
        {/* min-w-0: the sample answer's long lines scroll in their own box and never widen the dialog past a phone's screen. */}
        <div className="min-w-0 space-y-5">
          <Field label={t("name")} counter={`${form.name.length} / ${CHECK_NAME_MAX}`}>
            {(id) => <Input id={id} value={form.name} maxLength={CHECK_NAME_MAX} onChange={(e) => set("name", e.target.value)} placeholder={t("namePlaceholder")} />}
          </Field>
          {form.builtIn ? null : (
            <Field label={t("question")} hint={t("questionHint", { byline: "{byline}", doi: "{doi}" })} counter={`${form.question.length} / ${CHECK_TEXT_MAX}`}>
              {(id) => <Textarea id={id} value={form.question} maxLength={CHECK_TEXT_MAX} onChange={(e) => set("question", e.target.value)} rows={4} placeholder={t("questionPlaceholder")} />}
            </Field>
          )}
          <Field label={t("fix")} hint={t("fixHint", { byline: "{byline}", doi: "{doi}" })} counter={`${form.fix.length} / ${CHECK_TEXT_MAX}`}>
            {(id) => <Textarea id={id} value={form.fix} onChange={(e) => set("fix", e.target.value)} rows={2} maxLength={CHECK_TEXT_MAX} placeholder={t("fixPlaceholder")} />}
          </Field>
          <Field label={t(form.builtIn ? "compareModel" : "model")} hint={form.builtIn || !form.model ? undefined : t(decides ? "decisionHint" : "llmHint")}>
            {() => <ModelPicker align="start" current={form.model} efforts tasks={["screening"]} onChange={(picked, effort) => set("model", { ...picked, effort })} trigger={form.model ? <NodeCard model={form.model} paidBy="credits" interactive /> : <PickButton />} />}
          </Field>
          {form.builtIn ? null : (
            <Field label={t("threshold")}>
              {() => (
                <div className="flex items-center gap-4 px-1">
                  <Slider value={[Math.round(form.threshold * 100)]} min={50} max={99} step={1} onValueChange={([v]) => set("threshold", (v ?? 50) / 100)} aria-label={t("thresholdLabel")} />
                  <span className="w-12 text-end text-sm font-medium tabular-nums">{pct(form.threshold)}</span>
                </div>
              )}
            </Field>
          )}
          <label className="flex cursor-pointer items-center justify-between gap-6 rounded-2xl border border-border-subtle px-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t("blocksPublishing")}</span>
              <span className="block text-xs text-muted-foreground">{t(form.blocking ? "blocksOn" : "blocksOff")}</span>
            </span>
            <Switch checked={form.blocking} onCheckedChange={(blocking) => set("blocking", blocking)} />
          </label>
          <Field label={t("answer")}>{(id) => <pre id={id} className="overflow-x-auto rounded-xl bg-inset px-3.5 py-3 font-mono text-xs/5">{JSON.stringify(sample, null, 2)}</pre>}</Field>
        </div>
        <DialogFooter className="sm:justify-between">
          {!isNew && !form.builtIn ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => run(() => removeCheck({ id: form.id! }), t("checkRemoved"))}>
              <Trash2 /> {t("remove")}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              className="relative"
              disabled={busy || !ready}
              onClick={() =>
                run(
                  () => saveCheck({ ...(form.id && { id: form.id }), name: form.name, question: form.question, fix: form.fix, modelId: form.model!._id!, ...(form.model!.effort && { effort: form.model!.effort }), threshold: form.threshold, blocking: form.blocking, enabled: form.enabled }),
                  t(isNew ? "checkAdded" : "checkSaved"),
                )
              }
            >
              <Working busy={busy}>{t(isNew ? "addCheckButton" : "save")}</Working>
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgreementDialog({ open, agreement, series, onClose }: { open: boolean; agreement: Settings["agreement"]; series: Settings["series"]; onClose: () => void }) {
  const setAgreement = useMutation(api.reports.settings.setAgreement);
  const { user } = useUser();
  const [today] = useState(() => new Date());
  const [text, setText] = useState(agreement.text);
  const [preview, setPreview] = useState(false);
  const [busy, start] = useTransition();
  const t = useTranslations("publishReports.settings");
  const format = useFormatter();
  const failed = useFailed();
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText(agreement.text);
      setPreview(false);
    }
  }
  const changed = text.trim() !== agreement.text.trim() && text.trim() !== "";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("agreementTitle")}</DialogTitle>
          <DialogDescription>
            {t("agreementIntro", { version: agreement.version + 1 })}
          </DialogDescription>
        </DialogHeader>
        <Segmented
          label={t("agreementView")}
          value={preview ? "preview" : "edit"}
          onChange={(v) => setPreview(v === "preview")}
          options={[
            { id: "edit", label: t("markdown"), icon: Pencil },
            { id: "preview", label: t("asAuthors"), icon: FileText },
          ]}
        />
        <div className="h-[55vh]">
          {preview ? (
            <div className="h-full overflow-y-auto rounded-xl border border-border-subtle px-5 py-4">
              {/* Filled the way the sign step fills it, with the admin as the signer. */}
              <MarkdownContent content={fillAgreement(text, { name: user?.fullName ?? "", date: today, byline: bylineOf(series, "…", DEFAULT_LICENCE), licence: DEFAULT_LICENCE })} />
            </div>
          ) : (
            <Textarea value={text} maxLength={AGREEMENT_MAX} aria-label={t("agreementLabel")} onChange={(e) => setText(e.target.value)} className="h-full resize-none font-mono text-xs/5" />
          )}
        </div>
        <DialogFooter className="sm:items-center">
          <span className="me-auto text-xs tabular-nums text-muted-foreground">
            {format.number(text.length)} / {format.number(AGREEMENT_MAX)}
          </span>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            className="relative"
            disabled={!changed || busy}
            onClick={() =>
              start(async () => {
                try {
                  await setAgreement({ text });
                  toast.success(t("agreementSaved", { version: agreement.version + 1 }));
                  onClose();
                } catch (error) {
                  failed(error);
                }
              })
            }
          >
            <Working busy={busy}>{t("saveVersion", { version: agreement.version + 1 })}</Working>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
