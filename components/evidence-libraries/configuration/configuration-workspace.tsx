"use client";

import { ConvexError } from "convex/values";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  AlertCircle,
  ArrowUp,
  ExternalLink,
  Eye,
  Save,
  PencilLine,
  CircleAlert,
  HomeIcon,
  HistoryIcon,
  SourcesIcon,
  TeamIcon,
  EvidenceLibrariesIcon,
  SwitchesIcon,
  GlobeIcon,
  PaletteIcon,
  BuildingsIcon,
  MenuIcon,
  FooterIcon,
  MailIcon,
  CollectionsIcon,
  SearchIcon,
  QuoteIcon,
  LanguagesIcon,
  AnalyticsIcon,
  LinkIcon,
  PublishIcon,
  TrashIcon,
  type AppIcon,
  AiIcon,
} from "@/components/icons";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
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
import { ConfigurationLayout, ConfigurationNavigation } from "./configuration-layout";
import { RailGroup, RailLink } from "./navigation-rail";
import { ReadOnlyContext } from "./read-only";
import { Button } from "@/components/ui/button";
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
  carryUnsaved,
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
  sectionChanged,
  type SectionRow,
  sectionState,
  staleUploads,
  withAiKey,
} from "@/lib/evidence-libraries/configuration/rules";
import { AI_PROVIDER_CREDENTIAL_KEY } from "@/lib/evidence-libraries/configuration/ai";
import { shortCommit } from "@/lib/evidence-libraries/configuration/versions";
import {
  namesHostingProvider,
  publicOperationErrorMessage,
} from "@/lib/evidence-libraries/public-operation-error";
import { cn } from "@/lib/utils";
import { AiSection } from "./sections/ai-section";
import { AnalyticsSection } from "./sections/analytics-section";
import { CitationsSection } from "./sections/citations-section";
import { CollectionFactsProvider } from "./sections/collection-facts";
import { CollectionsSection } from "./sections/collections-section";
import { ContactSection } from "./sections/contact-section";
import { DangerSection } from "./sections/danger-section";
import { PublicationSection } from "./sections/publication-section";
import { DomainSection } from "./sections/domain-section";
import { DeleteLibraryDialog } from "./delete-library-dialog";
import { FeaturesSection } from "./sections/features-section";
import { FooterSection } from "./sections/footer-section";
import { HomeSection } from "./sections/home-section";
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
  SaveNoticesProvider,
  STATE_TONE,
  type SectionProps,
} from "./section-shell";
import { LibraryAddressLink } from "../library-address-link";
import { AdminAreaLink } from "../admin-area-link";
import { LibraryStatusChip, libraryStatusOf } from "../library-status-chip";
import { BAR_ACTION, BAR_LABEL, PanelHeader } from "./panel-header";
import { StatusChip, StatusIcon } from "./status-chip";

// A section's state in the menu: done, changed or needs attention.
const STATE_ICON = { complete: undefined, edited: PencilLine, attention: CircleAlert } as const;
import { FileUploadsProvider } from "./use-file-uploads";
import { useScrollSpy } from "./use-scroll-spy";
import { ActivationControl } from "./activation-control";
import { OPERATION_STAGE_ICONS } from "./operation-stage-icons";

type DraftResult = NonNullable<
  FunctionReturnType<typeof api.evidenceLibraries.queries.getDraft>
>;
type Operation = DraftResult["operation"];
/**
 * A new library's setup operation is created queued and only starts once the
 * owner activates; until it holds a revision it is waiting, not running.
 */
function isOperationRunning(operation: Operation): boolean {
  if (!operation) return false;
  if (operation.kind === "setup" && !operation.revisionId) return false;
  return operation.status === "queued" || operation.status === "running";
}

/** Rail entries: the page cards in their groups, then versions, the team and the danger zone. */
type RailKey = PageSectionKey | "publication" | "domain" | "versions" | "team" | "danger";
const RAIL_GROUPS: {
  key: "brand" | "content" | "discovery" | "platform" | "team" | "danger";
  sections: readonly RailKey[];
}[] = [
  { key: "brand", sections: ["identity", "theme", "institutions"] },
  { key: "content", sections: ["home", "navigation", "footer", "contact", "collections"] },
  { key: "discovery", sections: ["search", "citations", "features", "sources", "ai"] },
  { key: "platform", sections: ["languages", "analytics", "publication", "domain", "versions"] },
  { key: "team", sections: ["team"] },
  { key: "danger", sections: ["danger"] },
];

const SECTION_ICONS: Record<RailKey, AppIcon> = {
  identity: GlobeIcon,
  theme: PaletteIcon,
  institutions: BuildingsIcon,
  home: HomeIcon,
  navigation: MenuIcon,
  footer: FooterIcon,
  contact: MailIcon,
  collections: CollectionsIcon,
  search: SearchIcon,
  sources: SourcesIcon,
  citations: QuoteIcon,
  features: SwitchesIcon,
  ai: AiIcon,
  languages: LanguagesIcon,
  analytics: AnalyticsIcon,
  domain: LinkIcon,
  publication: PublishIcon,
  versions: HistoryIcon,
  team: TeamIcon,
  danger: TrashIcon,
};

const SECTION_COMPONENTS: Record<
  PageSectionKey,
  (props: SectionProps) => ReactNode
> = {
  identity: IdentitySection,
  theme: ThemeSection,
  institutions: InstitutionsSection,
  home: HomeSection,
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
  "publication",
  "domain",
  "versions",
  "team",
  "danger",
];

export function ConfigurationWorkspace({ libraryId }: { libraryId: string }) {
  const draftQuery = useProtectedQuery(api.evidenceLibraries.queries.getDraft, {
    libraryId: libraryId as Id<"evidenceLibraries">,
  });
  if (draftQuery.data === undefined) {
    return <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />;
  }
  if (draftQuery.data === null) return <AuthStatePanel variant="no_access" layout="fullscreen" />;
  const {
    draft,
    editable,
    hasUnpublishedChanges,
    library,
    liveAddress,
    operation,
    role,
    sections,
  } = draftQuery.data;
  return (
    <Workspace
      key={draft._id}
      editable={editable}
      role={role}
      libraryId={draft.libraryId}
      libraryName={library.name}
      libraryState={library.state}
      liveAddress={liveAddress}
      latest={{ editVersion: draft.editVersion, rows: sections }}
      hasUnpublishedChanges={hasUnpublishedChanges}
      operation={operation}
    />
  );
}

function Workspace({
  editable,
  role,
  libraryId,
  libraryName,
  libraryState,
  liveAddress,
  latest,
  hasUnpublishedChanges,
  operation,
}: {
  /** Whether the reader changes the settings; everyone else who views the library reads them (#653). */
  editable: boolean;
  role: DraftResult["role"];
  libraryId: Id<"evidenceLibraries">;
  libraryName: string;
  libraryState: DraftResult["library"]["state"];
  liveAddress: string | null;
  /** The rows the platform holds now, and the edit version they belong to. */
  latest: { editVersion: number; rows: readonly SectionRow[] };
  hasUnpublishedChanges: boolean;
  operation: Operation;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const tList = useTranslations("evidenceLibraries.list");
  const tc = useTranslations("common");
  const router = useWorkspaceRouter();
  const saveDraftSections = useMutation(
    api.evidenceLibraries.mutations.saveDraftSections,
  );
  const activateConfiguration = useMutation(
    api.evidenceLibraries.mutations.activateConfiguration,
  );
  const removeUpload = useAction(api.evidenceLibraries.uploadActions.remove);
  const checkSoftware = useAction(api.evidenceLibraries.updates.check);

  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  // The saved rows the page took last and the draft read from them, the draft edited on top of that, the cards
  // whose unsaved values were also saved somewhere else in the meantime, and for each card the edit version whose
  // rows last replaced its values.
  const [work, setWork] = useState(() => {
    const base = readDraft(latest.rows);
    return {
      ...latest,
      base,
      edited: base,
      elsewhere: [] as readonly PageSectionKey[],
      drawn: {} as Partial<Record<PageSectionKey, number>>,
    };
  });
  // The draft this page's own save sent, once the platform has taken it. The rows that follow hold all of it.
  const [sent, setSent] = useState<ConfigurationDraft | null>(null);
  // Newer rows can come from a save made in another tab or by someone else. A card with unsaved values keeps them.
  // The rows wait while this page's own save or activation is on its way: what it sent was edited from the rows it holds.
  if (work.editVersion !== latest.editVersion && !saving && !activating) {
    // After the page's own save, only what was typed since it was sent is unsaved.
    const carried = carryUnsaved(work.edited, sent ?? work.base, work.rows, latest.rows, sent ? [] : work.elsewhere);
    setWork({
      ...latest,
      base: carried.base,
      edited: carried.draft,
      elsewhere: carried.elsewhere,
      drawn: { ...work.drawn, ...Object.fromEntries(carried.replaced.map((key) => [key, latest.editVersion])) },
    });
    setSent(null);
  }
  const { editVersion, rows: saved, edited } = work;
  // Whether an OpenRouter key is stored is not a saved row; it comes from the
  // credential store and is folded into the draft while the page renders.
  const credentials = useProtectedQuery(
    api.evidenceLibraries.credentials.listCredentials,
    { libraryId },
  );
  const draft = withAiKey(
    edited,
    (credentials.data?.page ?? []).some(
      (credential) => credential.credentialKey === AI_PROVIDER_CREDENTIAL_KEY,
    ),
  );
  // A file still uploading puts its address in the draft when it lands: saving waits for it.
  const [uploading, setUploading] = useState(0);
  const [activateOpen, setActivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [section, setSection] = useQueryState(
    "section",
    parseAsStringLiteral(RAIL_KEYS).withDefault("identity"),
  );
  const { active: spied, jumpTo: scrollToSection } = useScrollSpy(RAIL_KEYS, section);
  const current = spied ?? section;

  const dirty = isDirty(draft, saved);
  // Read-only, the rail lists the settings cards only.
  const railGroups = editable ? RAIL_GROUPS : RAIL_GROUPS.flatMap((group) => {
    const sections = group.sections.filter(isPageSection);
    return sections.length ? [{ ...group, sections }] : [];
  });
  const problems = hasProblems(draft);
  const operationRunning = isOperationRunning(operation);
  const runtimeRefreshKey =
    operation?.runtimeUpdate && !operationRunning
      ? `${operation._id}:${operation.status}:${operation.updatedAt}`
      : "base";
  const isDraftLibrary = libraryState === "provisioning";
  // Software older than the settings page's contract is updated by the publish.
  const publishRuntime = useQuery(
    api.evidenceLibraries.updates.publishRuntime,
    isDraftLibrary || !editable ? "skip" : { libraryId },
  );
  const canActivate =
    (isDraftLibrary || dirty || hasUnpublishedChanges) &&
    !activating &&
    !saving &&
    uploading === 0 &&
    !problems &&
    !operationRunning;

  // Editing, resetting or moving on answers the last refusal, so it goes away.
  const patch: SectionProps["patch"] = (update) => {
    setRefusal(null);
    setWork((current) => {
      const next = update(cloneDraft(current.edited));
      // A card edited back to the saved values has nothing left to settle.
      return { ...current, edited: next, elsewhere: current.elsewhere.filter((key) => sectionChanged(next, current.rows, key)) };
    });
  };
  const reset: SectionProps["reset"] = (sectionKey) => {
    setRefusal(null);
    setWork((current) => ({
      ...current,
      edited: resetSection(current.edited, current.rows, sectionKey),
      elsewhere: current.elsewhere.filter((key) => key !== sectionKey),
    }));
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
    setSent(edited);
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
      .catch((error: unknown) => showRefusal(error, t("saveError")))
      .finally(() => setSaving(false));
  }

  function confirmActivate() {
    setActivateOpen(false);
    setActivating(true);
    setRefusal(null);
    // The publish reads what the last update check found about the software.
    // Usually the page's own check has answered; this covers an owner who
    // activates before it does, and a failed check never blocks.
    void (isDraftLibrary
      ? Promise.resolve()
      : checkSoftware({ libraryId }).catch(() => null))
      .then(() => save())
      .then((version) =>
        activateConfiguration({ libraryId, expectedEditVersion: version }),
      )
      .then((result) => {
        if (result.kind === "setup") router.push(`/evidence-libraries/${libraryId}/setup`);
      })
      .catch((error: unknown) => showRefusal(error, t("activationError")))
      .finally(() => setActivating(false));
  }

  const operationLabel =
    operationRunning && operation
      ? `${operation.runtimeUpdate
          ? t("updatingSoftware", {
              rev: shortCommit(operation.runtimeUpdate.to),
            })
          : t("applying")}, ${t(`stages.${operation.stage}`)}`
      : null;
  const operationFlowLabel =
    operationRunning && operation
      ? t(`operationFlow.${operation.stage}`)
      : activating
        ? t("operationFlow.saving")
        : null;
  const activateButton = (
    <ActivationControl
      size="sm"
      disabled={!canActivate}
      onActivate={() => setActivateOpen(true)}
      idleLabel={isDraftLibrary ? t("setUpAndActivate") : t("activate")}
      busy={
        operationFlowLabel
          ? {
              accessibleLabel:
                operationLabel ?? t("operationFlow.saving"),
              icon:
                operationRunning && operation
                  ? OPERATION_STAGE_ICONS[operation.stage]
                  : Save,
              label: operationFlowLabel,
            }
          : null
      }
    />
  );

  return (
    <FileUploadsProvider libraryId={libraryId} onInFlight={(change) => setUploading((count) => count + change)}>
      <ConfigurationLayout
        header={<>
            <PanelHeader
              icon={EvidenceLibrariesIcon}
              image={draft.identity.assets.favicon || null}
              title={draft.identity.name || t("untitled")}
              backHref={LIBRARIES_HREF}
              backLabel={t("backToLibraries")}
              titleAside={<>
                <LibraryStatusChip
                  status={libraryStatusOf(libraryState, operation)}
                  operation={operationRunning && operation && operation.kind !== "setup" ? operation : null}
                  labelClassName={BAR_LABEL}
                />
                {!editable ? (
                  <StatusChip tone="neutral" data-view-only>
                    <Eye aria-hidden />
                    <span className={BAR_LABEL}>{t("viewOnly")}</span>
                  </StatusChip>
                ) : dirty ? (
                  <StatusChip tone="warning" data-unsaved>
                    <PencilLine aria-hidden />
                    <span className={BAR_LABEL}>{t("unsaved")}</span>
                  </StatusChip>
                ) : null}
                <LibraryAddressLink address={draft.identity.baseUrl} className="hidden text-sm text-muted-foreground @5xl:inline-flex" />
              </>}
            >
              {editable ? (
                <Button
                  variant="outline"
                  size="sm"
                  className={BAR_ACTION}
                  disabled={!dirty || saving || activating || uploading > 0}
                  onClick={handleSave}
                >
                  {saving ? <Spinner /> : <Save />}
                  <span className={BAR_LABEL}>{saving ? t("saving") : t("save")}</span>
                </Button>
              ) : null}
              {/* The library's own admin is for the people with a role in it; a viewer has none. */}
              {libraryState === "active" && liveAddress && role !== "viewer" && !operationRunning && !activating ? (
                <Button asChild variant="outline" size="sm" className={BAR_ACTION}>
                  <AdminAreaLink address={liveAddress}>
                    <ExternalLink />
                    <span className={BAR_LABEL}>{tList("openAdmin")}</span>
                  </AdminAreaLink>
                </Button>
              ) : null}
              {operationLabel ? (
                <span
                  role="status"
                  aria-live="polite"
                  aria-label={operationLabel}
                  data-operation-stage={operation?.stage}
                  className="sr-only"
                >
                  {operationLabel}
                </span>
              ) : null}
              {!editable ? null : problems ? (
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
            {operation && editable ? (
              <OperationFailureNotice
                operation={operation}
                libraryId={libraryId}
                onJump={jumpTo}
              />
            ) : null}
        </>}
        navigation={
              <ConfigurationNavigation label={t("rail.aria")}>
                {railGroups.map((group) => (
                  <RailGroup key={group.key} label={t(`rail.${group.key}`)}>
                    {group.sections.map((key) => {
                      const state = editable && isPageSection(key)
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
                            <StatusIcon
                              tone={STATE_TONE[state]}
                              icon={STATE_ICON[state]}
                              label={t(`sectionState.${state}`)}
                              data-state={state}
                              className="[&>svg]:size-3.5"
                            />
                          ) : null}
                        </RailLink>
                      );
                    })}
                  </RailGroup>
                ))}
              </ConfigurationNavigation>        }
        footer={<>
        <Button
          variant="outline"
          size="sm"
          className="fixed bottom-6 end-6 z-20 shadow-lg [body:has([data-assistant-launcher])_&]:end-24"
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
                  : [
                      t("activateBody"),
                      publishRuntime === "update" ? t("activateBodySoftware") : "",
                      dirty ? t("activateBodyUnsaved") : "",
                    ].filter(Boolean).join(" ")}
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
        </>}
      >
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
              {/* A save ends by taking the saved rows for everything it sent. A change made while one is on its way
                  would be lost without a word, so no section can be changed until the save or activation is back. */}
              {/* The column spaces its children; the sections are this box's children now, so it spaces them the same. */}
              {/* Read-only, every control is off, the custom ones through ReadOnlyContext, and the values stay readable to everyone, a screen reader included (#653). */}
              {/* Cards size themselves against this box, outside the fieldset: Chromium stops drawing a size container
                  inside a fieldset after some updates, which emptied the Sources card on phones. */}
              <div className="@container/settings">
              <fieldset disabled={!editable} className="min-w-0 space-y-4" inert={saving || activating} aria-busy={saving || activating || undefined}>
                <ReadOnlyContext value={!editable}>
                <CollectionFactsProvider
                  libraryId={libraryId}
                  ids={draft.collections.map((collection) => collection.id)}
                >
                  <SaveNoticesProvider refusal={refusal} elsewhere={work.elsewhere}>
                    {PAGE_SECTION_KEYS.map((key) => {
                      const Section = SECTION_COMPONENTS[key];
                      return (
                        <Section
                          // A card whose values were replaced by saved rows starts again, as it would on a fresh page.
                          key={`${key}:${work.drawn[key] ?? 0}`}
                          libraryId={libraryId}
                          draft={draft}
                          saved={saved}
                          patch={patch}
                          reset={reset}
                        />
                      );
                    })}
                  </SaveNoticesProvider>
                </CollectionFactsProvider>
                {/* Publishing, addresses, versions, the team and deletion are its owners' to run. */}
                {editable ? (
                  <>
                    <PublicationSection libraryId={libraryId} operationRunning={operationRunning} />
                    <DomainSection libraryId={libraryId} />
                    <VersionsSection
                      libraryId={libraryId}
                      live={libraryState === "active"}
                      operationRunning={operationRunning}
                      refreshKey={runtimeRefreshKey}
                    />
                    <TeamSection libraryId={libraryId} />
                    <DangerSection onDelete={() => setDeleteOpen(true)} />
                  </>
                ) : null}
                </ReadOnlyContext>
              </fieldset>
              </div>
      </ConfigurationLayout>
    </FileUploadsProvider>
  );
}

/**
 * The latest failed platform operation and any assembly issues. Running state
 * is shown in the Activate button, where the owner started the work.
 */
function OperationFailureNotice({
  operation,
  libraryId,
  onJump,
}: {
  operation: NonNullable<Operation>;
  libraryId: Id<"evidenceLibraries">;
  onJump: (key: PageSectionKey) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const retry = useMutation(
    api.evidenceLibraries.configurationDeployment.retryConfigurationDeployment,
  );
  const issues = operation.issues ?? [];
  if (operation.status !== "failed") return null;
  const hostingFallback = operation.runtimeUpdate
    ? t("versions.updateError")
    : operation.kind === "rollback"
      ? t("versions.restoreError")
      : t("activationError");
  const publicError = publicOperationErrorMessage(
    operation.error,
    hostingFallback,
  );
  const publicIssues = issues.reduce<
    {
      issue: (typeof issues)[number];
      message: string;
      providerDetailRemoved: boolean;
    }[]
  >((visible, issue) => {
    const providerDetailRemoved = namesHostingProvider(issue);
    const message = publicOperationErrorMessage(issue, hostingFallback);
    if (
      !message ||
      (providerDetailRemoved &&
        (message === publicError ||
          visible.some(
            (entry) =>
              entry.providerDetailRemoved && entry.message === message,
          )))
    ) {
      return visible;
    }
    visible.push({ issue, message, providerDetailRemoved });
    return visible;
  }, []);
  return (
    <InlineNotice
      tone="danger"
      title={t("operationFailed")}
      className="mb-4"
      data-operation-issues
    >
      {publicError ? <p>{publicError}</p> : null}
      {operation.retryable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            retry({ libraryId, operationId: operation._id })
              .catch((error) =>
                toast.error(errorMessage(error, t("retryError"))),
              );
          }}
        >
          {t("retry")}
        </Button>
      ) : null}
      {publicIssues.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {publicIssues.map(({ issue, message }) => {
            const target = cardForPointer(issue.pointer);
            return (
              <li
                key={`${issue.pointer}:${message}`}
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
                <span>{message}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </InlineNotice>
  );
}
