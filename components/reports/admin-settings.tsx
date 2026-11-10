"use client";

// Settings > Admin > Publishing (plans/publish-reports): the Publish button, human review, each workspace's daily
// limit, the series and its DOIs, the model that reads PDFs, the checks, and the agreement.

import { useState, useTransition, type ComponentProps } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { parseAsBoolean, parseAsString, useQueryStates } from "nuqs";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/convex/_generated/api";
import { Enter, LIST, Paged, Segmented, Tile, Working, Zone } from "@/components/settings/parts";
import { NodeCard, toMapModel, tintOf, type MapModel, type PickedModel } from "@/components/settings/model-map";
import { getModelIcon } from "@/components/icons/provider-icons";
import { ModelPicker } from "@/components/models/model-picker";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { Field } from "@/components/evidence-libraries/configuration/section-card";
import { PublicationForm } from "@/components/evidence-libraries/configuration/sections/publication-section";
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IdentityRow } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Input } from "@/components/ui/input";
import { EASE } from "@/components/ui/opening";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { FileText, Hash, PenLine, Pencil, Plus, Trash2, UserPlus } from "@/components/icons";
import type { Effort } from "@/lib/ai/core/call-options";
import { isDecisionModel, JEV_MODEL } from "@/lib/ai/decisions";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { AGREEMENT_MAX, CHECK_NAME_MAX, CHECK_TEXT_MAX, MAX_CHECKS, MAX_DAILY_LIMIT, bylineOf, canRegister, crossrefDoiOf, dailyLimit, isIssn } from "@/lib/reports/settings";
import { useFailed } from "@/components/reports/words";
import { stepBack, withoutKeys } from "@/lib/url-state/step-back";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { cn } from "@/lib/utils";

type Settings = FunctionReturnType<typeof api.reports.settings.admin>;
type CheckRow = Settings["checks"][number];
type LimitRow = FunctionReturnType<typeof api.reports.limits.list>["page"][number];
type Account = NonNullable<LimitRow["account"]>;

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
  // Its page is in the address, and the next one opens where the list is: it sits far down a long page.
  const limits = useCursorPageAt("limits", api.reports.limits.list, {}, LIMITS_PER_PAGE, { scroll: false });
  if (!settings || limits.isLoading) return <Enter ready={false}>{null}</Enter>;
  return (
    <Enter ready>
      <SettingsView settings={settings} limits={limits} />
    </Enter>
  );
}

function SettingsView({ settings, limits }: { settings: Settings; limits: ReturnType<typeof useCursorPageAt<typeof api.reports.limits.list>> }) {
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

      <Limits settings={settings} limits={limits} save={save} />

      <Zone label={t("series")}>
        <ul className={LIST}>
          <Row label={t("series")}>
            <SavedInput value={settings.series.name} onSave={(name) => series({ name }, t("seriesSaved"))} className="w-64" ariaLabel={t("seriesName")} />
          </Row>
          <Row label={t("issn")} hint={t("issnHint", { pending: "{pending}" })}>
            <SavedInput value={settings.series.issn} placeholder={t("issnPending")} onSave={(issn) => series({ issn }, t("issnSaved"))} className="w-40 font-mono" ariaLabel={t("issn")} />
          </Row>
          <Row label={t("byline")} hint={t("bylineHint", { series: "{series}", issn: "{issn}", doi: "{doi}" })} wide>
            <SavedInput value={settings.series.byline} onSave={(byline) => series({ byline }, t("bylineSaved"))} className="w-full" ariaLabel={t("byline")} />
            <p className="flex items-start gap-2 rounded-xl bg-inset px-3 py-2.5 text-xs text-muted-foreground">
              <FileText className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{bylineOf(settings.series, sampleDoi ?? "10.5281/zenodo.1234567")}</span>
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
            saved={{ settings: settings.publication, updatedAt: settings.publicationSavedAt, verifiedAt: settings.publicationSavedAt }}
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
            <span className="min-w-0 truncate">{sampleDoi ?? t(registers ? "zenodoDoi" : "noDoi")}</span>
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
      <AgreementDialog open={nav.agreement} agreement={settings.agreement} onClose={() => up("agreement")} />
    </div>
  );
}

const LIMITS_PER_PAGE = 8;
const LIMIT_ROW = 57;
/** What a workspace newly given a limit of its own starts with; the admin changes it in its row. */
const OWN_LIMIT = 5;

/**
 * How many reports a workspace may start in a day, and the people and organisations with a limit of their own,
 * shown as people and organisations are everywhere else in the app.
 */
function Limits({ settings, limits, save }: { settings: Settings; limits: ReturnType<typeof useCursorPageAt<typeof api.reports.limits.list>>; save: (patch: { perDay: number } | { orgPerDay: number }, saved: string) => Promise<boolean> }) {
  const set = useMutation(api.reports.limits.set);
  const remove = useMutation(api.reports.limits.remove);
  const t = useTranslations("publishReports.settings");
  const failed = useFailed();
  return (
    <Zone label={t("limits")}>
      <Paged pager={{ list: limits, size: LIMITS_PER_PAGE }} rowHeight={LIMIT_ROW} label={t("limitsPager")}>
        <ul className={LIST}>
          {/* Each workspace has its own number of new reports a day, and every report started in it counts against it. */}
          <Row label={t("personal")} hint={t("personalHint")}>
            <SavedInput value={String(settings.perDay)} numeric onSave={(value) => save({ perDay: Number(value) }, t("limitSaved"))} className="w-20 text-end tabular-nums" ariaLabel={t("personalLabel")} />
          </Row>
          <Row label={t("organization")} hint={t("organizationHint")}>
            <SavedInput value={String(settings.orgPerDay)} numeric onSave={(value) => save({ orgPerDay: Number(value) }, t("limitSaved"))} className="w-20 text-end tabular-nums" ariaLabel={t("organizationLabel")} />
          </Row>
          {/* A row opens and closes its own height, so the ones under it glide and don't jump. */}
          <AnimatePresence initial={false}>
            {limits.items.map((row) => (
              <motion.li key={row._id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden">
                <IdentityRow className="px-4 py-2.5" avatar={<IdentityAvatar name={row.name} imageUrl={row.imageUrl ?? null} kind={row.kind === "personal" ? "person" : "organization"} className="size-9" />} name={row.name || t(row.kind === "personal" ? "goneAccount" : "goneOrganization")} detail={row.detail ?? t(row.kind === "personal" ? "person" : "organisation")}>
                  <SavedInput
                    value={String(row.perDay)}
                    numeric
                    disabled={!row.account}
                    onSave={(value) =>
                      set({ account: row.account!, perDay: Number(value) }).then(
                        () => (toast.success(t("limitSaved")), true),
                        (error) => (failed(error), false),
                      )
                    }
                    className="w-20 text-end tabular-nums"
                    ariaLabel={t("perDayLabel", { name: row.name })}
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">{t("aDay")}</span>
                  <TooltipHint label={t(row.kind === "personal" ? "backToPeople" : "backToOrganizations")}>
                    <Button variant="ghost" size="icon-sm" aria-label={t("removeLimit", { name: row.name })} className="text-muted-foreground hover:text-destructive" onClick={() => void remove({ limitId: row._id }).catch(failed)}>
                      <Trash2 />
                    </Button>
                  </TooltipHint>
                </IdentityRow>
              </motion.li>
            ))}
          </AnimatePresence>
          <li className="px-4 py-3">
            <AccountPicker
              onPick={(account, name) =>
                void set({ account, perDay: OWN_LIMIT, keep: true }).then((now) => {
                  if (now !== OWN_LIMIT) toast.info(t("alreadyLimited", { name, count: now }));
                }, failed)
              }
            />
          </li>
        </ul>
      </Paged>
    </Zone>
  );
}

const PICKS = 6;

/** Picks a person or an organisation from Openscholar's accounts: the first ones are there on opening, and typing searches them all. */
function AccountPicker({ onPick }: { onPick: (account: Account, name: string) => void }) {
  const workspaceId = useWorkspace();
  const t = useTranslations("publishReports.settings");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 250);
  // Read from the page's first frame, so the list is there whenever the button is pressed. People are found by email.
  const args = inWorkspace(workspaceId, { paginationOpts: { cursor: null, numItems: PICKS }, ...(search ? { search } : {}) });
  const people = useProtectedQuery(api.organizations.libraryAccess.listPeople, args).data;
  const organizations = useProtectedQuery(api.organizations.libraryAccess.list, args).data;
  // What was shown stays, dimmed, until a search's answer is in.
  const [shown, setShown] = useState<{ people: NonNullable<typeof people>["page"]; organizations: NonNullable<typeof organizations>["page"] } | null>(null);
  if (people && organizations && (shown?.people !== people.page || shown.organizations !== organizations.page)) setShown({ people: people.page, organizations: organizations.page });
  // What is listed answers an earlier search until this one's answer is in, and while the typing settles: nothing
  // of it can be picked then, or Enter would give a limit to the account the last search found.
  const stale = !people || !organizations || query.trim() !== search;
  const groups = [
    { heading: t("people"), rows: (shown?.people ?? []).map((row) => ({ account: { userId: row._id } as Account, id: row._id as string, name: row.name ?? row.email, detail: row.name ? row.email : undefined, imageUrl: row.imageUrl ?? null, kind: "person" as const })) },
    { heading: t("organisations"), rows: (shown?.organizations ?? []).map((row) => ({ account: { organizationId: row._id } as Account, id: row._id as string, name: row.name, detail: undefined, imageUrl: row.imageUrl ?? null, kind: "organization" as const })) },
  ].filter((group) => group.rows.length);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        {/* On a phone its words take two lines, and it never runs out of the card. */}
        <Button variant="outline" className="h-auto min-h-9 max-w-full py-2 text-start whitespace-normal">
          <UserPlus /> {t("giveLimit")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("pickerPlaceholder")} value={query} onValueChange={setQuery} busy={stale} />
          <CommandList className={cn("transition-opacity", stale && "opacity-60")}>
            {shown ? <CommandEmpty>{t("pickerEmpty")}</CommandEmpty> : null}
            {groups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.rows.map((row) => (
                  <CommandItem
                    key={row.id}
                    value={row.id}
                    disabled={stale}
                    onSelect={() => {
                      onPick(row.account, row.name);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <IdentityRow className="min-w-0 flex-1" avatar={<IdentityAvatar name={row.name} imageUrl={row.imageUrl} kind={row.kind} className="size-8" />} name={row.name} detail={row.detail} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** An input that saves when it loses focus or Enter is pressed. A `numeric` one takes a whole number from 0 and puts anything else back. */
function SavedInput({ value, onSave, className, placeholder, ariaLabel, numeric = false, disabled = false }: { value: string; /** Resolves false when the value was refused: the box then shows what is saved. */ onSave: (v: string) => Promise<boolean>; className?: string; placeholder?: string; ariaLabel?: string; numeric?: boolean; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [was, setWas] = useState(value);
  const t = useTranslations("publishReports.settings");
  const format = useFormatter();
  if (value !== was) {
    setWas(value);
    // Only a box still showing what was saved follows a new saved value: typing done since is never replaced.
    if (draft === was) setDraft(value);
  }
  const commit = () => {
    const typed = draft.trim();
    const whole = /^\d+$/.test(typed);
    const next = numeric ? (whole ? String(dailyLimit(Number(typed))) : value) : typed;
    // What was typed isn't what is kept: the box says why it changed back, or to what.
    if (numeric && typed !== next) toast.info(t(whole ? "limitMax" : "limitWhole", { max: format.number(MAX_DAILY_LIMIT) }));
    setDraft(next);
    if (next !== value) void onSave(next).then((kept) => kept || setDraft(value));
  };
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      inputMode={numeric ? "numeric" : undefined}
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
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3", !check.enabled && "opacity-60")}>
      <Tile icon={Brand} tint={tintOf(check.modelId)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{check.name}</span>
          {check.builtIn ? <Tag>{t("builtIn")}</Tag> : null}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{check.model?.name ?? t("modelGone")}</span>
          {check.builtIn ? null : <Tag>{t("passesAt", { percent: pct(check.threshold) })}</Tag>}
          <Tag>{t(check.blocking ? "blocks" : "flags")}</Tag>
        </span>
      </span>
      <Button variant="ghost" size="sm" aria-label={t("editCheck", { name: check.name })} className="text-muted-foreground" onClick={onEdit}>
        <Pencil /> {t("edit")}
      </Button>
      <Switch checked={check.enabled} onCheckedChange={onToggle} aria-label={t("checkOn", { name: check.name })} />
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

function AgreementDialog({ open, agreement, onClose }: { open: boolean; agreement: Settings["agreement"]; onClose: () => void }) {
  const setAgreement = useMutation(api.reports.settings.setAgreement);
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
              <MarkdownContent content={text} />
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
