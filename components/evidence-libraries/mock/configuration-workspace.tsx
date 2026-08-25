"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  GitBranch,
  Globe,
  Languages,
  Library,
  Palette,
  Rocket,
  Save,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ACTIVATION_STAGES,
  EDITABLE_SECTIONS,
  hasErrors,
  isDirty,
  type LibraryConfig,
  MOCK_LANGUAGES,
  type MockLibrary,
  type SectionKey,
  type SectionState,
  sectionState,
} from "@/lib/evidence-libraries/mock/data";
import {
  selectLibrary,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { DeleteLibraryDialog } from "./delete-library-dialog";
import { LibraryNotFound } from "./library-not-found";
import { PrototypeBadge } from "./prototype-badge";
import { MiniNavbarPreview, PublicSitePreview } from "./site-preview";

const NAME_MAX = 100;
const RAIL_SECTIONS = ["identity", "branding", "languages", "danger"] as const;
type RailSection = (typeof RAIL_SECTIONS)[number];
const LATER_SECTIONS = [
  "navigation",
  "discovery",
  "content",
  "integrations",
  "platform",
  "sources",
  "domains",
  "rollback",
] as const;

const SECTION_ICONS: Record<SectionKey, LucideIcon> = {
  identity: Globe,
  branding: Palette,
  languages: Languages,
};

const STATE_DOT: Record<SectionState, string> = {
  complete: "bg-emerald-500",
  edited: "bg-amber-500",
  attention: "bg-destructive",
};

const STATE_BADGE: Record<SectionState, string> = {
  complete: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  edited: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  attention: "bg-destructive/15 text-destructive",
};

const HEX = /^#[0-9a-f]{6}$/i;

export function ConfigurationWorkspace({ libraryId }: { libraryId: string }) {
  const library = useEvidenceLibraryMockStore(selectLibrary(libraryId));
  if (!library) return <LibraryNotFound />;
  return <Workspace library={library} />;
}

function Workspace({ library }: { library: MockLibrary }) {
  const t = useTranslations("evidenceLibraryMock.config");
  const tm = useTranslations("evidenceLibraryMock");
  const tc = useTranslations("common");
  const router = useRouter();
  const saving = useEvidenceLibraryMockStore((s) => s.saving[library.id] ?? false);
  const activation = useEvidenceLibraryMockStore((s) => s.activation[library.id]);
  const updateDraft = useEvidenceLibraryMockStore((s) => s.updateDraft);
  const saveDraft = useEvidenceLibraryMockStore((s) => s.saveDraft);
  const startSetup = useEvidenceLibraryMockStore((s) => s.startSetup);
  const startActivation = useEvidenceLibraryMockStore((s) => s.startActivation);

  const [section, setSection] = useQueryState(
    "section",
    parseAsStringLiteral(RAIL_SECTIONS).withDefault("identity"),
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const draft = library.draft;
  const dirty = isDirty(library);
  const errors = hasErrors(library);
  const activating = activation !== undefined;
  const canActivate =
    !activating && !errors && (library.status === "active" || library.status === "draft");
  const isDraftLibrary = library.status === "draft";

  const patch = (value: Partial<LibraryConfig>) => updateDraft(library.id, value);

  function jumpTo(key: RailSection) {
    void setSection(key);
    document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleSave() {
    if (errors) {
      toast.error(t("fixFirstToast"), { description: t("fixFirstToastDescription") });
      return;
    }
    saveDraft(library.id);
  }

  function confirmActivate() {
    setActivateOpen(false);
    if (isDraftLibrary) {
      startSetup(library.id);
      router.push(`/evidence-libraries/${library.id}/setup`);
      return;
    }
    toast(t("activationStarted"), {
      description: t("activationStartedDescription", { rev: library.draftRev }),
    });
    startActivation(library.id);
  }

  function copyAddress() {
    const url = `https://${library.address}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    toast.success(t("copied"), { description: url });
  }

  const activateButton = (
    <Button disabled={!canActivate} onClick={() => setActivateOpen(true)}>
      <Rocket />
      {isDraftLibrary ? t("setUpAndActivate") : t("activate")}
    </Button>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      {/* Sticky header */}
      <div className="sticky top-14 z-20 -mx-4 border-b bg-background/95 px-4 pt-4 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/10">
              <Library className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight">
                  {draft.name || t("untitled")}
                </h1>
                <Badge variant="outline" className="gap-1 font-normal">
                  <GitBranch />
                  {t("draftRev")} <span className="font-mono">{library.draftRev}</span>
                </Badge>
                {library.activeRev ? (
                  <Badge variant="secondary" className="gap-1 bg-emerald-600/15 font-normal text-emerald-700 dark:text-emerald-400">
                    <Check />
                    {t("activeRev")} <span className="font-mono">{library.activeRev}</span>
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <GitBranch />
                    {t("notActive")}
                  </Badge>
                )}
                {dirty ? (
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-amber-500/15 font-normal text-amber-700 dark:text-amber-400"
                    data-unsaved
                  >
                    <AlertTriangle />
                    {t("unsaved")}
                  </Badge>
                ) : null}
                <PrototypeBadge />
              </div>
              <p className="font-mono text-xs text-muted-foreground">https://{library.address}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? <Spinner /> : <Save />}
              {saving ? t("saving") : t("save")}
            </Button>
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye />
              {t("preview")}
            </Button>
            {errors ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>{activateButton}</span>
                </TooltipTrigger>
                <TooltipContent>{t("fixFirst")}</TooltipContent>
              </Tooltip>
            ) : (
              activateButton
            )}
          </div>
        </div>
        {activation ? <ActivationBanner stageIndex={activation.stageIndex} rev={activation.rev} /> : null}
      </div>

      <div className="grid gap-8 pt-6 lg:grid-cols-[220px_1fr]">
        {/* Anchor rail */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav aria-label={t("railThisVersion")} className="space-y-5">
            <RailGroup label={t("railThisVersion")}>
              {EDITABLE_SECTIONS.map((key) => {
                const state = sectionState(library, key);
                return (
                  <RailLink key={key} href={`#sec-${key}`} active={section === key} onClick={() => jumpTo(key)}>
                    <span>{t(`sections.${key}`)}</span>
                    <span
                      className={cn("size-2 rounded-full", STATE_DOT[state])}
                      data-state={state}
                      title={t(`sectionState.${state}`)}
                      aria-label={t(`sectionState.${state}`)}
                      role="img"
                    />
                  </RailLink>
                );
              })}
            </RailGroup>
            <RailGroup label={t("railLater")}>
              {LATER_SECTIONS.map((key) => (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      aria-disabled="true"
                      className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-1.5 text-sm text-muted-foreground/60"
                    >
                      <span>{t(`later.${key}`)}</span>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground/70">
                        {t("laterTag")}
                      </Badge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t("laterTip")}</TooltipContent>
                </Tooltip>
              ))}
            </RailGroup>
            <RailGroup label={t("railDanger")}>
              <RailLink href="#sec-danger" active={section === "danger"} onClick={() => jumpTo("danger")} danger>
                <span>{t("sections.danger")}</span>
              </RailLink>
            </RailGroup>
          </nav>
        </aside>

        {/* Sections */}
        <div className="min-w-0 space-y-8">
          <Section id="sec-identity" icon={SECTION_ICONS.identity} title={t("sections.identity")} description={t("identityDescription")} state={sectionState(library, "identity")}>
            <Field label={t("nameLabel")} counter={`${draft.name.length} / ${NAME_MAX}`} error={!draft.name.trim() ? t("nameError") : null}>
              {(id, invalid) => (
                <Input id={id} maxLength={NAME_MAX} value={draft.name} aria-invalid={invalid || undefined} onChange={(e) => patch({ name: e.target.value })} />
              )}
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t("shortNameLabel")} hint={t("shortNameHint")}>
                {(id) => <Input id={id} className="font-mono" value={draft.shortName} readOnly />}
              </Field>
              <Field label={t("addressLabel")} hint={t("addressHint")}>
                {(id) => (
                  <div className="flex gap-2">
                    <Input id={id} className="font-mono" value={`https://${library.address}`} readOnly />
                    <Button type="button" variant="outline" size="icon" aria-label={t("copyAddress")} onClick={copyAddress}>
                      <Copy />
                    </Button>
                  </div>
                )}
              </Field>
            </div>
          </Section>

          <Section id="sec-branding" icon={SECTION_ICONS.branding} title={t("sections.branding")} description={t("brandingDescription")} state={sectionState(library, "branding")}>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t("logoDarkLabel")} error={!draft.logoDark.trim() ? t("logoDarkError") : null}>
                {(id, invalid) => (
                  <Input id={id} className="font-mono" value={draft.logoDark} aria-invalid={invalid || undefined} placeholder="https://…/logo-dark.svg" onChange={(e) => patch({ logoDark: e.target.value })} />
                )}
              </Field>
              <Field label={t("logoLightLabel")} suffix={t("optional")}>
                {(id) => (
                  <Input id={id} className="font-mono" value={draft.logoLight} placeholder="https://…/logo-light.svg" onChange={(e) => patch({ logoLight: e.target.value })} />
                )}
              </Field>
            </div>
            <Field label={t("faviconLabel")} error={!draft.favicon.trim() ? t("faviconError") : null}>
              {(id, invalid) => (
                <Input id={id} className="font-mono" value={draft.favicon} aria-invalid={invalid || undefined} placeholder="https://…/favicon.ico" onChange={(e) => patch({ favicon: e.target.value })} />
              )}
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <ColourField label={t("accentLabel")} hint={t("accentHint")} pickerLabel={t("pickAccent")} value={draft.accent} onChange={(accent) => patch({ accent })} />
              <ColourField label={t("secondaryLabel")} hint={t("secondaryHint")} pickerLabel={t("pickSecondary")} value={draft.secondary} onChange={(secondary) => patch({ secondary })} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>{t("livePreview")}</Label>
                <PrototypeBadge variant="mock" />
              </div>
              <MiniNavbarPreview config={draft} />
            </div>
          </Section>

          <Section id="sec-languages" icon={SECTION_ICONS.languages} title={t("sections.languages")} description={t("languagesDescription")} state={sectionState(library, "languages")}>
            <div className="space-y-2">
              <Label>{t("availableLanguages")}</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("availableLanguages")}>
                {MOCK_LANGUAGES.map((lang) => {
                  const checked = draft.languages.includes(lang.code);
                  return (
                    <Label
                      key={lang.code}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-normal transition-colors",
                        checked ? "border-primary/60 bg-primary/10" : "hover:bg-muted",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          patch({
                            languages:
                              next === true
                                ? MOCK_LANGUAGES.filter((l) => l.code === lang.code || draft.languages.includes(l.code)).map((l) => l.code)
                                : draft.languages.filter((c) => c !== lang.code),
                          })
                        }
                      />
                      <span className="font-mono text-xs text-muted-foreground">{lang.code}</span>
                      <span>{lang.name}</span>
                    </Label>
                  );
                })}
              </div>
              {draft.languages.length === 0 ? (
                <p className="text-xs text-destructive" role="alert">{t("languagesError")}</p>
              ) : null}
            </div>
            <Field label={t("defaultLanguage")} hint={t("defaultLanguageHint")} className="max-w-xs">
              {(id) => (
                <Select value={draft.defaultLanguage || undefined} disabled={draft.languages.length === 0} onValueChange={(defaultLanguage) => patch({ defaultLanguage })}>
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue placeholder={t("selectLanguageFirst")} />
                  </SelectTrigger>
                  <SelectContent>
                    {draft.languages.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code} — {MOCK_LANGUAGES.find((l) => l.code === code)?.name ?? code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </Section>

          <section id="sec-danger" className="scroll-mt-40 rounded-xl border border-destructive/40 bg-card p-6 shadow-xs">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-destructive">
              <Trash2 className="size-4" />
              {t("dangerTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("dangerDescription")}</p>
            <Button variant="outline" className="mt-4 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 />
              {t("dangerTitle")}
            </Button>
          </section>
        </div>
      </div>

      {/* Preview slide-over */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="flex flex-wrap items-center gap-2">
              {t("previewTitle", { name: draft.name || t("untitled") })}
              <PrototypeBadge variant="mock" />
              <Badge variant="outline" className="gap-1 font-mono font-normal">
                <GitBranch />
                {library.draftRev}
              </Badge>
            </SheetTitle>
            <SheetDescription>{t("previewHint")}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <PublicSitePreview config={draft} address={library.address} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Activate confirm */}
      <AlertDialog open={activateOpen} onOpenChange={setActivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isDraftLibrary ? t("activateDraftTitle") : t("activateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {isDraftLibrary
                ? t("activateDraftBody", { name: library.name, address: library.address })
                : `${t("activateBody")} ${dirty ? t("activateBodyUnsaved") : ""}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmActivate}>
              {isDraftLibrary ? t("activateDraftConfirm") : t("activateConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeleteLibraryDialog
        library={library}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => router.push("/evidence-libraries")}
      />
      <span className="sr-only">{tm("prototypeBadge")}</span>
    </div>
  );
}

function ActivationBanner({ stageIndex, rev }: { stageIndex: number; rev: string }) {
  const t = useTranslations("evidenceLibraryMock.config");
  const live = stageIndex >= ACTIVATION_STAGES.length - 1;
  return (
    <div role="status" aria-live="polite" data-activation-stage={ACTIVATION_STAGES[stageIndex]} className="mb-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {live ? <Check className="size-4 text-emerald-600" /> : <Spinner />}
        <span className="font-mono">{live ? t("isLive", { rev }) : t("applying", { rev })}</span>
      </div>
      <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {ACTIVATION_STAGES.map((stage, i) => {
          const done = i < stageIndex || live;
          const now = i === stageIndex && !live;
          return (
            <li key={stage} className="flex items-center gap-2">
              <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5", done && "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400", now && "bg-primary/15 text-primary", !done && !now && "text-muted-foreground")}>
                {done ? <Check className="size-3" /> : now ? <Spinner className="size-3" /> : null}
                {t(`stages.${stage}`)}
              </span>
              {i < ACTIVATION_STAGES.length - 1 ? <span className="text-muted-foreground">→</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RailGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function RailLink({ href, active, onClick, danger, children }: { href: string; active: boolean; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? "location" : undefined}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        "relative flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors",
        active ? "bg-sidebar-accent/80 font-medium text-sidebar-primary" : "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground",
        danger && "text-destructive hover:text-destructive",
      )}
    >
      {active ? <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" /> : null}
      {children}
    </a>
  );
}

function Section({ id, icon: Icon, title, description, state, children }: { id: string; icon: LucideIcon; title: string; description: string; state: SectionState; children: ReactNode }) {
  const t = useTranslations("evidenceLibraryMock.config");
  return (
    <section id={id} data-section-state={state} className="scroll-mt-40 rounded-xl border bg-card p-6 shadow-xs">
      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon className="size-4 text-primary" />
            {title}
          </h2>
          <Badge variant="secondary" className={STATE_BADGE[state]}>{t(`sectionState.${state}`)}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, error, counter, suffix, className, children }: { label: string; hint?: string; error?: string | null; counter?: string; suffix?: string; className?: string; children: (id: string, invalid: boolean) => ReactNode }) {
  const id = useId();
  const invalid = Boolean(error);
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {suffix ? <span className="ml-1 text-xs font-normal text-muted-foreground">{suffix}</span> : null}
        </Label>
        {counter ? <span className="font-mono text-xs text-muted-foreground">{counter}</span> : null}
      </div>
      {children(id, invalid)}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ColourField({ label, hint, pickerLabel, value, onChange }: { label: string; hint: string; pickerLabel: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={pickerLabel}
            value={HEX.test(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
          />
          <Input id={id} className="font-mono" value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
      )}
    </Field>
  );
}
