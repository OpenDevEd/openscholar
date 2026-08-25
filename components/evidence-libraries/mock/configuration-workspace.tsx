"use client";

import {
  Check,
  Copy,
  Eye,
  GitBranch,
  Globe,
  Languages,
  Layers,
  Palette,
  Rocket,
  Save,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { type ReactNode, useState } from "react";
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
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { STATUS_DOT, StatusChip, type StatusTone } from "./library-status-badge";
import { PanelHeader } from "./panel-header";
import { Field, FieldError, SectionCard } from "./section-card";
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

const STATE_TONE: Record<SectionState, StatusTone> = {
  complete: "success",
  edited: "warning",
  attention: "danger",
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
    <div className="w-full pb-16">
      {/* Sticky header: full width, same bar treatment as other sticky bars in the app */}
      <div className="sticky top-14 z-20 border-b border-border/40 bg-background lg:top-0">
        <div className="container mx-auto max-w-6xl px-4 sm:px-6">
          <PanelHeader
            icon={Layers}
            className="border-b-0 px-0 md:px-0"
            title={draft.name || t("untitled")}
            eyebrow={`https://${library.address}`}
          >
            {dirty ? (
              <span className="text-xs text-muted-foreground" data-unsaved>
                {t("unsaved")}
              </span>
            ) : null}
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
          </PanelHeader>
          {activation ? (
            <ActivationBanner stageIndex={activation.stageIndex} rev={activation.rev} />
          ) : null}
        </div>
      </div>

      <div className="container mx-auto max-w-6xl p-4 sm:p-6">
        <CommandCenterContainer allowOverflow className="flex flex-col md:flex-row">
          {/* Anchor rail, same look as the settings sidebar */}
          <aside className="w-full border-b border-border/40 bg-muted/20 md:w-60 md:border-b-0 md:border-r md:bg-transparent">
            <nav
              aria-label={t("railThisVersion")}
              className="space-y-5 p-4 md:sticky md:top-36 md:p-5"
            >
              <RailGroup label={t("railThisVersion")}>
                {EDITABLE_SECTIONS.map((key) => {
                  const state = sectionState(library, key);
                  const Icon = SECTION_ICONS[key];
                  return (
                    <RailLink
                      key={key}
                      href={`#sec-${key}`}
                      icon={Icon}
                      active={section === key}
                      onClick={() => jumpTo(key)}
                    >
                      <span className="flex-1">{t(`sections.${key}`)}</span>
                      <span
                        className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[STATE_TONE[state]])}
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
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "sm" }),
                          "w-full cursor-not-allowed justify-between font-normal text-muted-foreground/60 hover:bg-transparent hover:text-muted-foreground/60",
                        )}
                      >
                        <span>{t(`later.${key}`)}</span>
                        <span className="rounded-full border border-border/50 px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                          {t("laterTag")}
                        </span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right">{t("laterTip")}</TooltipContent>
                  </Tooltip>
                ))}
              </RailGroup>
              <RailGroup label={t("railDanger")}>
                <RailLink
                  href="#sec-danger"
                  icon={Trash2}
                  active={section === "danger"}
                  onClick={() => jumpTo("danger")}
                  danger
                >
                  <span className="flex-1">{t("sections.danger")}</span>
                </RailLink>
              </RailGroup>
            </nav>
          </aside>

          {/* Sections */}
          <div className="min-w-0 flex-1 space-y-4 p-4 md:p-6">
            <SectionCard
              id="sec-identity"
              className="scroll-mt-40"
              icon={SECTION_ICONS.identity}
              title={t("sections.identity")}
              description={t("identityDescription")}
              aside={<SectionStateChip state={sectionState(library, "identity")} />}
              data-section-state={sectionState(library, "identity")}
            >
              <Field
                label={t("nameLabel")}
                counter={`${draft.name.length} / ${NAME_MAX}`}
                error={!draft.name.trim() ? t("nameError") : null}
              >
                {(id, invalid) => (
                  <Input
                    id={id}
                    maxLength={NAME_MAX}
                    className="bg-background"
                    value={draft.name}
                    aria-invalid={invalid || undefined}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("shortNameLabel")} hint={t("shortNameHint")}>
                  {(id) => (
                    <Input id={id} className="bg-background font-mono text-sm" value={draft.shortName} readOnly />
                  )}
                </Field>
                <Field label={t("addressLabel")} hint={t("addressHint")}>
                  {(id) => (
                    <div className="flex gap-1.5">
                      <Input
                        id={id}
                        className="bg-background font-mono text-sm"
                        value={`https://${library.address}`}
                        readOnly
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t("copyAddress")}
                        onClick={copyAddress}
                      >
                        <Copy />
                      </Button>
                    </div>
                  )}
                </Field>
              </div>
            </SectionCard>

            <SectionCard
              id="sec-branding"
              className="scroll-mt-40"
              icon={SECTION_ICONS.branding}
              title={t("sections.branding")}
              description={t("brandingDescription")}
              aside={<SectionStateChip state={sectionState(library, "branding")} />}
              data-section-state={sectionState(library, "branding")}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("logoDarkLabel")} error={!draft.logoDark.trim() ? t("logoDarkError") : null}>
                  {(id, invalid) => (
                    <Input
                      id={id}
                      className="bg-background font-mono text-sm"
                      value={draft.logoDark}
                      aria-invalid={invalid || undefined}
                      placeholder="https://…/logo-dark.svg"
                      onChange={(e) => patch({ logoDark: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t("logoLightLabel")} suffix={t("optional")}>
                  {(id) => (
                    <Input
                      id={id}
                      className="bg-background font-mono text-sm"
                      value={draft.logoLight}
                      placeholder="https://…/logo-light.svg"
                      onChange={(e) => patch({ logoLight: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <Field label={t("faviconLabel")} error={!draft.favicon.trim() ? t("faviconError") : null}>
                {(id, invalid) => (
                  <Input
                    id={id}
                    className="bg-background font-mono text-sm"
                    value={draft.favicon}
                    aria-invalid={invalid || undefined}
                    placeholder="https://…/favicon.ico"
                    onChange={(e) => patch({ favicon: e.target.value })}
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <ColourField
                  label={t("accentLabel")}
                  hint={t("accentHint")}
                  pickerLabel={t("pickAccent")}
                  value={draft.accent}
                  onChange={(accent) => patch({ accent })}
                />
                <ColourField
                  label={t("secondaryLabel")}
                  hint={t("secondaryHint")}
                  pickerLabel={t("pickSecondary")}
                  value={draft.secondary}
                  onChange={(secondary) => patch({ secondary })}
                />
              </div>
              <div className="space-y-2.5 rounded-xl border border-border/50 bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <Eye className="h-3 w-3" />
                  {t("livePreview")}
                </div>
                <MiniNavbarPreview config={draft} />
              </div>
            </SectionCard>

            <SectionCard
              id="sec-languages"
              className="scroll-mt-40"
              icon={SECTION_ICONS.languages}
              title={t("sections.languages")}
              description={t("languagesDescription")}
              aside={<SectionStateChip state={sectionState(library, "languages")} />}
              data-section-state={sectionState(library, "languages")}
            >
              <div className="space-y-1.5">
                <Label>{t("availableLanguages")}</Label>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("availableLanguages")}>
                  {MOCK_LANGUAGES.map((lang) => {
                    const checked = draft.languages.includes(lang.code);
                    return (
                      <Label
                        key={lang.code}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-sm font-normal transition-all",
                          checked
                            ? "border-primary/40 bg-primary/5"
                            : "border-border/50 hover:border-border/80 hover:bg-muted/30",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) =>
                            patch({
                              languages:
                                next === true
                                  ? MOCK_LANGUAGES.filter(
                                      (l) => l.code === lang.code || draft.languages.includes(l.code),
                                    ).map((l) => l.code)
                                  : draft.languages.filter((c) => c !== lang.code),
                            })
                          }
                        />
                        <code className="text-xs font-mono text-muted-foreground">{lang.code}</code>
                        <span>{lang.name}</span>
                      </Label>
                    );
                  })}
                </div>
                {draft.languages.length === 0 ? <FieldError>{t("languagesError")}</FieldError> : null}
              </div>
              <Field label={t("defaultLanguage")} hint={t("defaultLanguageHint")} className="max-w-xs">
                {(id) => (
                  <Select
                    value={draft.defaultLanguage || undefined}
                    disabled={draft.languages.length === 0}
                    onValueChange={(defaultLanguage) => patch({ defaultLanguage })}
                  >
                    <SelectTrigger id={id} className="w-full bg-background">
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
            </SectionCard>

            <SectionCard
              id="sec-danger"
              className="scroll-mt-40"
              tone="danger"
              icon={Trash2}
              title={t("dangerTitle")}
              description={t("dangerDescription")}
            >
              <Button
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
                {t("dangerTitle")}
              </Button>
            </SectionCard>
          </div>
        </CommandCenterContainer>
      </div>

      {/* Preview slide-over */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="flex flex-wrap items-center gap-2">
              {t("previewTitle", { name: draft.name || t("untitled") })}
              <StatusChip tone="neutral" className="font-mono normal-case tracking-normal">
                <GitBranch />
                {library.draftRev}
              </StatusChip>
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
            <AlertDialogTitle>
              {isDraftLibrary ? t("activateDraftTitle") : t("activateTitle")}
            </AlertDialogTitle>
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

function SectionStateChip({ state }: { state: SectionState }) {
  const t = useTranslations("evidenceLibraryMock.config");
  return <StatusChip tone={STATE_TONE[state]}>{t(`sectionState.${state}`)}</StatusChip>;
}

function ActivationBanner({ stageIndex, rev }: { stageIndex: number; rev: string }) {
  const t = useTranslations("evidenceLibraryMock.config");
  const live = stageIndex >= ACTIVATION_STAGES.length - 1;
  const percent = Math.round((Math.min(stageIndex, ACTIVATION_STAGES.length) / ACTIVATION_STAGES.length) * 100);
  return (
    <div
      role="status"
      aria-live="polite"
      data-activation-stage={ACTIVATION_STAGES[stageIndex]}
      className="mb-4 rounded-xl border border-border/50 bg-muted/30 p-4"
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium">
          {live ? (
            <Check className="h-4 w-4 text-emerald-500" />
          ) : (
            <Spinner className="h-4 w-4 text-primary" />
          )}
          <span className="font-mono">{live ? t("isLive", { rev }) : t("applying", { rev })}</span>
        </span>
        <span className="font-medium tabular-nums">{percent}%</span>
      </div>
      <Progress
        value={percent}
        className={cn(live && "bg-emerald-500/20 [&>[data-slot=progress-indicator]]:bg-emerald-500")}
      />
      <ol className="mt-3 flex flex-wrap items-center gap-2">
        {ACTIVATION_STAGES.map((stage, i) => {
          const done = i < stageIndex || live;
          const now = i === stageIndex && !live;
          return (
            <li key={stage}>
              <StatusChip
                tone={done ? "success" : now ? "running" : "neutral"}
                className="normal-case tracking-normal font-medium"
                data-stage-state={done ? "done" : now ? "now" : "waiting"}
              >
                {done ? <Check /> : now ? <Spinner /> : null}
                {t(`stages.${stage}`)}
              </StatusChip>
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
      <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function RailLink({
  href,
  icon: Icon,
  active,
  onClick,
  danger,
  children,
}: {
  href: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "location" : undefined}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "group relative w-full justify-start gap-3 overflow-hidden transition-all duration-200",
        active
          ? "bg-sidebar-accent/80 font-medium text-sidebar-primary shadow-sm hover:bg-sidebar-accent/90"
          : "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground",
        danger && "text-destructive hover:text-destructive",
      )}
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-primary/80 to-primary/50" />
      ) : null}
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
          danger && "text-destructive group-hover:text-destructive",
        )}
      />
      {children}
    </a>
  );
}

function ColourField({
  label,
  hint,
  pickerLabel,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  pickerLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label={pickerLabel}
            value={HEX.test(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="size-9 shrink-0 cursor-pointer rounded-md border border-border/50 bg-background p-0.5"
          />
          <Input
            id={id}
            className="bg-background font-mono text-sm"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
    </Field>
  );
}
