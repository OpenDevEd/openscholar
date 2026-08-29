"use client";

import { ConvexError } from "convex/values";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  AlertCircle,
  ArrowUp,
  BarChart3,
  Building2,
  Database,
  FolderTree,
  Globe,
  History,
  Languages,
  Layers,
  Link2,
  type LucideIcon,
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
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  type ConfigurationDraft,
  cardForPointer,
  changedSectionRows,
  cloneDraft,
  hasProblems,
  isDirty,
  PAGE_SECTION_KEYS,
  type PageSectionKey,
  readDraft,
  resetSection,
  type SaveRefusal,
  saveRefusal,
  type SectionRow,
  sectionState,
  staleUploads,
  withAiKey,
} from "@/lib/evidence-libraries/configuration/rules";
import { AI_PROVIDER_CREDENTIAL_KEY } from "@/lib/evidence-libraries/configuration/ai";
import { shortCommit } from "@/lib/evidence-libraries/configuration/versions";
import { cn } from "@/lib/utils";
import { AiSection } from "./sections/ai-section";
import { AnalyticsSection } from "./sections/analytics-section";
import { CitationsSection } from "./sections/citations-section";
import { CollectionFactsProvider } from "./sections/collection-facts";
import { CollectionsSection } from "./sections/collections-section";
import { ContactSection } from "./sections/contact-section";
import { DangerSection } from "./sections/danger-section";
import { DomainSection } from "./sections/domain-section";
import { DeleteLibraryDialog } from "./delete-library-dialog";
import { FeaturesSection } from "./sections/features-section";
import { FooterSection } from "./sections/footer-section";
import { IdentitySection } from "./sections/identity-section";
import { InstitutionsSection } from "./sections/institutions-section";
import { LanguagesSection } from "./sections/languages-section";
import { NavigationSection } from "./sections/navigation-section";
import { SearchSection } from "./sections/search-section";
import { SourcesSection } from "./sections/sources-section";
import { TeamSection } from "./sections/team-section";
import { ThemeSection } from "./sections/theme-section";
import { VersionsSection } from "./sections/versions-section";
import { InlineNotice } from "./section-card";
import {
  SaveRefusalProvider,
  STATE_TONE,
  type SectionProps,
} from "./section-shell";
import { LibraryAddressLink } from "../library-address-link";
import { PanelHeader } from "./panel-header";
import { STATUS_DOT, StatusChip } from "./status-chip";
import { FileUploadsProvider } from "./use-file-uploads";
import { useScrollSpy } from "./use-scroll-spy";

type DraftResult = NonNullable<
  FunctionReturnType<typeof api.evidenceLibraries.queries.getDraft>
>;
type Operation = DraftResult["operation"];

/**
 * A new library's setup operation is created queued and only starts once the
 * owner activates; until it holds a revision it is waiting, not running.
 */
function isOperationRunning(operation: Operation): operation is NonNullable<Operation> {
  if (!operation) return false;
  if (operation.kind === "setup" && !operation.revisionId) return false;
  return operation.status === "queued" || operation.status === "running";
}

/** Rail entries: the page cards in their groups, then versions, the team and the danger zone. */
type RailKey = PageSectionKey | "domain" | "versions" | "team" | "danger";
const RAIL_GROUPS: {
  key: "brand" | "content" | "discovery" | "platform" | "team" | "danger";
  sections: readonly RailKey[];
}[] = [
  { key: "brand", sections: ["identity", "theme", "institutions"] },
  { key: "content", sections: ["navigation", "footer", "contact", "collections"] },
  { key: "discovery", sections: ["search", "citations", "features", "sources", "ai"] },
  { key: "platform", sections: ["languages", "analytics", "domain", "versions"] },
  { key: "team", sections: ["team"] },
  { key: "danger", sections: ["danger"] },
];

const SECTION_ICONS: Record<RailKey, LucideIcon> = {
  identity: Globe,
  theme: Palette,
  institutions: Building2,
  navigation: Menu,
  footer: PanelBottom,
  contact: Mail,
  collections: FolderTree,
  search: Search,
  sources: Database,
  citations: Quote,
  features: ToggleRight,
  ai: Sparkles,
  languages: Languages,
  analytics: BarChart3,
  domain: Link2,
  versions: History,
  team: Users,
  danger: Trash2,
};

const SECTION_COMPONENTS: Record<
  PageSectionKey,
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
  sources: SourcesSection,
  citations: CitationsSection,
  features: FeaturesSection,
  ai: AiSection,
  languages: LanguagesSection,
  analytics: AnalyticsSection,
};

const LIBRARIES_HREF = "/evidence-libraries";

/** What the platform refused and where it belongs, or null when it said nothing useful. */
function readRefusal(error: unknown): SaveRefusal | null {
  if (!(error instanceof ConvexError)) return null;
  const data = error.data as { message?: unknown; pointer?: unknown };
  return saveRefusal(data?.pointer, data?.message);
}

/** The plain sentence for a failure that has no card of its own. */
function errorMessage(error: unknown, fallback: string) {
  return readRefusal(error)?.message ?? fallback;
}

function isPageSection(value: string): value is PageSectionKey {
  return (PAGE_SECTION_KEYS as readonly string[]).includes(value);
}

const RAIL_KEYS: readonly RailKey[] = [
  ...PAGE_SECTION_KEYS,
  "domain",
  "versions",
  "team",
  "danger",
];

export function ConfigurationWorkspace({ libraryId }: { libraryId: string }) {
  const draftQuery = useProtectedQuery(api.evidenceLibraries.queries.getDraft, {
    libraryId: libraryId as Id<"evidenceLibraries">,
  });
  // A refused save outlives the form below: saving first and then failing to
  // activate raises the edit version, which restarts the form from scratch.
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  if (draftQuery.data === undefined) {
    return <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />;
  }
  const { draft, library, operation, sections } = draftQuery.data;
  // A new edit version means the platform has newer rows; the draft restarts from them.
  return (
    <Workspace
      key={`${draft._id}:${draft.editVersion}`}
      libraryId={draft.libraryId}
      libraryName={library.name}
      libraryState={library.state}
      editVersion={draft.editVersion}
      saved={sections}
      operation={operation}
      refusal={refusal}
      setRefusal={setRefusal}
    />
  );
}

function Workspace({
  libraryId,
  libraryName,
  libraryState,
  editVersion,
  saved,
  operation,
  refusal,
  setRefusal,
}: {
  libraryId: Id<"evidenceLibraries">;
  libraryName: string;
  libraryState: DraftResult["library"]["state"];
  editVersion: number;
  saved: readonly SectionRow[];
  operation: Operation;
  refusal: SaveRefusal | null;
  setRefusal: (refusal: SaveRefusal | null) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const tc = useTranslations("common");
  const router = useRouter();
  const saveDraftSections = useMutation(
    api.evidenceLibraries.mutations.saveDraftSections,
  );
  const activateConfiguration = useMutation(
    api.evidenceLibraries.mutations.activateConfiguration,
  );
  const removeUpload = useAction(api.evidenceLibraries.uploadActions.remove);

  const [edited, setEdited] = useState<ConfigurationDraft>(() =>
    readDraft(saved),
  );
  // Whether an OpenRouter key is stored is not a saved row; it comes from the
  // credential store and is folded into the draft while the page renders.
  const credentials = useProtectedQuery(
    api.evidenceLibraries.credentials.listCredentialMetadata,
    { libraryId },
  );
  const draft = withAiKey(
    edited,
    (credentials.data ?? []).some(
      (credential) => credential.credentialKey === AI_PROVIDER_CREDENTIAL_KEY,
    ),
  );
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [section, setSection] = useQueryState(
    "section",
    parseAsStringLiteral(RAIL_KEYS).withDefault("identity"),
  );
  // Matches the sections' scroll-mt-40 (160px) so a clicked section is the one highlighted.
  const { active: spied, jumpTo: scrollToSection } = useScrollSpy(RAIL_KEYS, 160);
  const current = spied ?? section;

  const dirty = isDirty(draft, saved);
  const problems = hasProblems(draft);
  const operationRunning = isOperationRunning(operation);
  const isDraftLibrary = libraryState === "provisioning";
  const canActivate = !activating && !saving && !problems && !operationRunning;

  // Editing, resetting or moving on answers the last refusal, so it goes away.
  const patch: SectionProps["patch"] = (update) => {
    setRefusal(null);
    setEdited((current) => update(cloneDraft(current)));
  };
  const reset: SectionProps["reset"] = (sectionKey) => {
    setRefusal(null);
    setEdited((current) => resetSection(current, saved, sectionKey));
  };

  function jumpTo(key: RailKey) {
    setRefusal(null);
    void setSection(key);
    scrollToSection(key);
  }

  async function save(): Promise<number> {
    const sections = changedSectionRows(draft, saved);
    if (sections.length === 0) return editVersion;
    const stale = staleUploads(draft, saved);
    const result = await saveDraftSections({
      libraryId,
      expectedEditVersion: editVersion,
      sections,
    });
    // Only now do the saved rows stop pointing at the replaced files. Best effort.
    for (const url of stale) {
      void removeUpload({ libraryId, url }).catch(() => undefined);
    }
    return result.editVersion;
  }

  // Shows a refused save both as a toast and inside the card that owns the value.
  function showRefusal(error: unknown, fallback: string) {
    const refused = readRefusal(error);
    setRefusal(refused);
    toast.error(refused?.message ?? fallback);
  }

  function handleSave() {
    if (problems) {
      toast.error(t("fixFirstToast"), {
        description: t("fixFirstToastDescription"),
      });
      return;
    }
    setSaving(true);
    setRefusal(null);
    void save()
      .then(() => toast.success(t("saved")))
      .catch((error: unknown) => showRefusal(error, t("saveError")))
      .finally(() => setSaving(false));
  }

  function confirmActivate() {
    setActivateOpen(false);
    setActivating(true);
    setRefusal(null);
    void save()
      .then((version) =>
        activateConfiguration({ libraryId, expectedEditVersion: version }),
      )
      .then((result) => {
        if (result.kind === "setup") {
          router.push(`/evidence-libraries/${libraryId}/setup`);
          return;
        }
        toast(t("activationStarted"), {
          description: t("activationStartedDescription", {
            rev: result.revisionKey,
          }),
        });
      })
      .catch((error: unknown) => showRefusal(error, t("activationError")))
      .finally(() => setActivating(false));
  }

  const activateButton = (
    <Button disabled={!canActivate} onClick={() => setActivateOpen(true)}>
      {activating ? <Spinner /> : <Rocket />}
      {isDraftLibrary ? t("setUpAndActivate") : t("activate")}
    </Button>
  );

  return (
    <FileUploadsProvider libraryId={libraryId}>
      <div className="w-full pb-16">
        {/* Sticky header: full width, same bar treatment as other sticky bars in the app */}
        <div className="sticky top-14 z-20 border-b border-border/40 bg-background lg:top-0">
          <div className="container mx-auto max-w-6xl px-4 sm:px-6">
            <PanelHeader
              icon={Layers}
              image={draft.identity.assets.favicon || null}
              className="border-b-0 px-0 md:px-0"
              title={draft.identity.name || t("untitled")}
              description={<LibraryAddressLink address={draft.identity.baseUrl} />}
              backHref={LIBRARIES_HREF}
              backLabel={t("backToLibraries")}
              titleAside={
                dirty ? (
                  <StatusChip tone="warning" data-unsaved>
                    {t("unsaved")}
                  </StatusChip>
                ) : null
              }
            >
              <Button
                variant="outline"
                disabled={!dirty || saving || activating}
                onClick={handleSave}
              >
                {saving ? <Spinner /> : <Save />}
                {saving ? t("saving") : t("save")}
              </Button>
              {problems ? (
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
            {operation ? (
              <OperationBanner
                operation={operation}
                running={operationRunning}
                libraryId={libraryId}
                onJump={jumpTo}
              />
            ) : null}
          </div>
        </div>

        <div className="container mx-auto max-w-6xl p-4 sm:p-6">
          <CommandCenterContainer
            allowOverflow
            className="flex flex-col md:flex-row"
          >
            {/* Anchor rail, same look as the settings sidebar */}
            <aside className="w-full border-b border-border/40 bg-muted/20 md:w-60 md:border-b-0 md:border-r md:bg-transparent">
              <nav
                aria-label={t("rail.aria")}
                className="space-y-5 p-4 md:sticky md:top-24 md:max-h-[calc(100vh-7rem)] md:overflow-y-auto md:p-5"
              >
                {RAIL_GROUPS.map((group) => (
                  <RailGroup key={group.key} label={t(`rail.${group.key}`)}>
                    {group.sections.map((key) => {
                      const state = isPageSection(key)
                        ? sectionState(draft, saved, key)
                        : null;
                      return (
                        <RailLink
                          key={key}
                          href={`#sec-${key}`}
                          icon={SECTION_ICONS[key]}
                          active={current === key}
                          danger={key === "danger"}
                          onClick={() => jumpTo(key)}
                        >
                          <span className="flex-1">{t(`sections.${key}`)}</span>
                          {state ? (
                            <span
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                STATUS_DOT[STATE_TONE[state]],
                              )}
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
              {refusal && refusal.card === null ? (
                <InlineNotice
                  tone="danger"
                  role="alert"
                  title={t("saveRefusedAll")}
                  data-save-refused
                >
                  {refusal.message}
                </InlineNotice>
              ) : null}
              <CollectionFactsProvider
                libraryId={libraryId}
                ids={draft.collections.map((collection) => collection.id)}
              >
                <SaveRefusalProvider refusal={refusal}>
                  {PAGE_SECTION_KEYS.map((key) => {
                    const Section = SECTION_COMPONENTS[key];
                    return (
                      <Section
                        key={key}
                        libraryId={libraryId}
                        draft={draft}
                        saved={saved}
                        patch={patch}
                        reset={reset}
                      />
                    );
                  })}
                </SaveRefusalProvider>
              </CollectionFactsProvider>
              <DomainSection libraryId={libraryId} />
              <VersionsSection
                libraryId={libraryId}
                live={libraryState === "active"}
                operationRunning={operationRunning}
              />
              <TeamSection libraryId={libraryId} />
              <DangerSection onDelete={() => setDeleteOpen(true)} />
            </div>
          </CommandCenterContainer>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="fixed bottom-6 right-6 z-20 shadow-lg"
          onClick={() => jumpTo("identity")}
        >
          <ArrowUp />
          {t("backToTop")}
        </Button>

        <AlertDialog open={activateOpen} onOpenChange={setActivateOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isDraftLibrary ? t("activateDraftTitle") : t("activateTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {isDraftLibrary
                  ? t("activateDraftBody", {
                      name: draft.identity.name,
                      address: draft.identity.baseUrl,
                    })
                  : `${t("activateBody")} ${dirty ? t("activateBodyUnsaved") : ""}`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={confirmActivate}>
                {isDraftLibrary
                  ? t("activateDraftConfirm")
                  : t("activateConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <DeleteLibraryDialog
          libraryId={libraryId}
          name={libraryName}
          address={draft.identity.baseUrl}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onDeleted={() => router.push(LIBRARIES_HREF)}
        />
      </div>
    </FileUploadsProvider>
  );
}

/**
 * The latest platform operation: progress while it runs (a publish, a restore
 * or a software update), the failure and any assembly issues when it stopped.
 * Each issue links to its section.
 */
function OperationBanner({
  operation,
  running,
  libraryId,
  onJump,
}: {
  operation: NonNullable<Operation>;
  running: boolean;
  libraryId: Id<"evidenceLibraries">;
  onJump: (key: PageSectionKey) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const retry = useMutation(
    api.evidenceLibraries.configurationDeployment.retryConfigurationDeployment,
  );
  const issues = operation.issues ?? [];
  if (running) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-operation-stage={operation.stage}
        className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 text-sm"
      >
        <Spinner className="h-4 w-4 text-primary" />
        <span className="font-medium">
          {operation.runtimeUpdate
            ? t("updatingSoftware", {
                rev: shortCommit(operation.runtimeUpdate.to),
              })
            : t("applying")}
        </span>
        <StatusChip tone="running">{t(`stages.${operation.stage}`)}</StatusChip>
      </div>
    );
  }
  if (operation.status !== "failed") return null;
  return (
    <InlineNotice
      tone="danger"
      title={t("operationFailed")}
      className="mb-4"
      data-operation-issues
    >
      {operation.error ? <p>{operation.error.message}</p> : null}
      {operation.retryable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            retry({ libraryId, operationId: operation._id })
              .then(() => toast.success(t("retryStarted")))
              .catch((error) =>
                toast.error(errorMessage(error, t("retryError"))),
              );
          }}
        >
          {t("retry")}
        </Button>
      ) : null}
      {issues.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {issues.map((issue) => {
            const target = cardForPointer(issue.pointer);
            return (
              <li
                key={`${issue.pointer}:${issue.message}`}
                className="flex flex-wrap items-center gap-2"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {target ? (
                  <a
                    href={`#sec-${target}`}
                    className="font-mono underline underline-offset-2"
                    onClick={(e) => {
                      e.preventDefault();
                      onJump(target);
                    }}
                  >
                    {issue.pointer}
                  </a>
                ) : (
                  <code className="font-mono">{issue.pointer}</code>
                )}
                <span>{issue.message}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </InlineNotice>
  );
}

function RailGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
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
  danger,
  onClick,
  children,
}: {
  href: string;
  icon: LucideIcon;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
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
          active
            ? "text-primary"
            : "text-muted-foreground group-hover:text-foreground",
          danger && "text-destructive group-hover:text-destructive",
        )}
      />
      {children}
    </a>
  );
}
