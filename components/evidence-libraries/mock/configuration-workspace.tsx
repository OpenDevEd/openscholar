"use client";

import {
  ArrowUp,
  BarChart3,
  Building2,
  Check,
  Database,
  FolderOpen,
  Globe,
  History,
  Languages,
  Layers,
  Link2,
  Mail,
  Menu,
  Palette,
  PanelBottom,
  Quote,
  Rocket,
  Save,
  Search,
  Sparkles,
  ToggleRight,
  Trash2,
  Users,
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
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { RAIL_GROUPS } from "@/lib/evidence-libraries/mock/config";
import {
  ACTIVATION_STAGES,
  hasErrors,
  isDirty,
  type LibraryConfig,
  type MockLibrary,
  type SectionKey,
  sectionState,
} from "@/lib/evidence-libraries/mock/data";
import {
  selectLibrary,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { AiSection } from "./config/ai-section";
import { AnalyticsSection } from "./config/analytics-section";
import { CitationsSection } from "./config/citations-section";
import { CollectionsSection } from "./config/collections-section";
import { ContactSection } from "./config/contact-section";
import { DangerSection } from "./config/danger-section";
import { DomainSection } from "./config/domain-section";
import { FeaturesSection } from "./config/features-section";
import { FooterSection } from "./config/footer-section";
import { IdentitySection } from "./config/identity-section";
import { InstitutionsSection } from "./config/institutions-section";
import { LanguagesSection } from "./config/languages-section";
import { NavigationSection } from "./config/navigation-section";
import { STATE_TONE, type SectionProps } from "./config/section-shell";
import { SearchSection } from "./config/search-section";
import { SourcesSection } from "./config/sources-section";
import { TeamSection } from "./config/team-section";
import { ThemeSection } from "./config/theme-section";
import { VersionsSection } from "./config/versions-section";
import { useScrollSpy } from "./config/use-scroll-spy";
import { DeleteLibraryDialog } from "./delete-library-dialog";
import { LibraryNotFound } from "./library-not-found";
import { STATUS_DOT, StatusChip } from "./library-status-badge";
import { PanelHeader } from "./panel-header";

const SECTION_KEYS = RAIL_GROUPS.flatMap((g) => g.sections);
const SECTION_ICONS: Record<SectionKey, LucideIcon> = {
  identity: Globe,
  theme: Palette,
  institutions: Building2,
  navigation: Menu,
  footer: PanelBottom,
  contact: Mail,
  collections: FolderOpen,
  search: Search,
  citations: Quote,
  features: ToggleRight,
  ai: Sparkles,
  sources: Database,
  languages: Languages,
  analytics: BarChart3,
  team: Users,
  domain: Link2,
  versions: History,
  danger: Trash2,
};

const SECTION_COMPONENTS: Record<
  Exclude<SectionKey, "danger">,
  (props: SectionProps) => ReactNode
> = {
  identity: IdentitySection,
  theme: ThemeSection,
  institutions: InstitutionsSection,
  navigation: NavigationSection,
  footer: FooterSection,
  contact: ContactSection,
  collections: CollectionsSection,
  search: SearchSection,
  citations: CitationsSection,
  features: FeaturesSection,
  ai: AiSection,
  sources: SourcesSection,
  languages: LanguagesSection,
  analytics: AnalyticsSection,
  team: TeamSection,
  domain: DomainSection,
  versions: VersionsSection,
};

export function ConfigurationWorkspace({ libraryId }: { libraryId: string }) {
  const library = useEvidenceLibraryMockStore(selectLibrary(libraryId));
  if (!library) return <LibraryNotFound />;
  return <Workspace library={library} />;
}

function Workspace({ library }: { library: MockLibrary }) {
  const t = useTranslations("evidenceLibraryMock.config");
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
    parseAsStringLiteral(SECTION_KEYS).withDefault("identity"),
  );
  // Matches the sections' scroll-mt-40 (160px) so a clicked section is the one highlighted.
  const { active: spied, jumpTo: scrollToSection } = useScrollSpy(SECTION_KEYS, 160);
  const current = spied ?? section;
  const [activateOpen, setActivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const draft = library.draft;
  const dirty = isDirty(library);
  const errors = hasErrors(library);
  const activating = activation !== undefined;
  const canActivate =
    !activating && !errors && (library.status === "active" || library.status === "draft");
  const isDraftLibrary = library.status === "draft";

  const patch = (update: (d: LibraryConfig) => LibraryConfig) => updateDraft(library.id, update);

  function jumpTo(key: SectionKey) {
    void setSection(key);
    scrollToSection(key);
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
            title={draft.identity.name || t("untitled")}
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
              aria-label={t("rail.aria")}
              className="space-y-5 p-4 md:sticky md:top-24 md:max-h-[calc(100vh-7rem)] md:overflow-y-auto md:p-5"
            >
              {RAIL_GROUPS.map((group) => (
                <RailGroup key={group.key} label={t(`rail.${group.key as "brand"}`)}>
                  {group.sections.map((key) => {
                    const tracked = key !== "versions" && key !== "danger";
                    const state = tracked ? sectionState(library, key) : null;
                    return (
                      <RailLink
                        key={key}
                        href={`#sec-${key}`}
                        icon={SECTION_ICONS[key]}
                        active={current === key}
                        onClick={() => jumpTo(key)}
                        danger={key === "danger"}
                      >
                        <span className="flex-1">{t(`sections.${key}`)}</span>
                        {state ? (
                          <span
                            className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[STATE_TONE[state]])}
                            data-state={state}
                            title={t(`sectionState.${state}`)}
                            aria-label={t(`sectionState.${state}`)}
                            role="img"
                          />
                        ) : null}
                      </RailLink>
                    );
                  })}
                </RailGroup>
              ))}
            </nav>
          </aside>

          {/* Sections */}
          <div className="min-w-0 flex-1 space-y-4 p-4 md:p-6">
            {SECTION_KEYS.map((key) => {
              if (key === "danger") {
                return (
                  <DangerSection
                    key={key}
                    library={library}
                    patch={patch}
                    onDelete={() => setDeleteOpen(true)}
                  />
                );
              }
              const Section = SECTION_COMPONENTS[key];
              return <Section key={key} library={library} patch={patch} />;
            })}
          </div>
        </CommandCenterContainer>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="fixed bottom-6 right-6 z-20 shadow-lg"
        onClick={() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
          void setSection("identity");
        }}
      >
        <ArrowUp />
        {t("backToTop")}
      </Button>

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
    </div>
  );
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
                className="font-medium"
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
      <p className="mb-1.5 px-3 text-xs font-medium text-muted-foreground">
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

