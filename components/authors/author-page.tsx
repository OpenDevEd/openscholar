"use client";
import { useRatedPapers } from "@/lib/research/reads";
import {
  LinkedInIcon,
  OrcidIcon,
} from "@/components/icons/author-service-icons";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { LogoMark } from "@/components/logo";
import { isOwnId, SEARCH_SOURCE_NAMES } from "@/lib/search/source";
import { useSearchSource } from "@/lib/search/use-search-source";
import Link from "@/components/workspace-link";
import { AuthorSettingsNavigation } from "./author-settings-navigation";
import { BAR_ACTION, BAR_LABEL, PanelHeader } from "@/components/evidence-libraries/configuration/panel-header";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { ListEmpty, ListLoading, ListSearch, ListViewTabs } from "@/components/evidence-libraries/list-controls";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { ConfigurationLayout } from "@/components/evidence-libraries/configuration/configuration-layout";
import { AuthorAvatar } from "./author-avatar";
import { useRef, useState, type ReactNode } from "react";
import {
  Upload,
  Save,
  PencilLine,
  UserRound,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Globe,
  GraduationCap,
  Library,
  Link2,
  Pencil,
  Unlink,
  Trash2,
  RefreshCw,
  Search,
  SearchX,
  PersonIcon,
  LinkIcon,
  BookIcon,
  Move,
  History,
} from "@/components/icons";
import { useTranslations } from "next-intl";
import { ActivitySheet } from "@/components/workspaces/activity";
import { MoveDialog } from "@/components/workspaces/move-dialog";
import { ItemPresence } from "@/components/workspaces/presence";
import type { Id } from "@/convex/_generated/dataModel";
import { PaperCard } from "@/components/paper-card";
import { FocusMode } from "@/components/ui/focus-mode";
import { useUIStore } from "@/lib/store";
import type { PaperResult } from "@/lib/types";
import {
  downloadLibraryItem,
  downloadLibraryEssentialItem,
} from "@/lib/library/download-handlers";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipHint,
} from "@/components/ui/tooltip";
import { ButtonGroup } from "@/components/ui/button-group";

import {
  SectionCard,
  Field,
  FieldError,
} from "@/components/evidence-libraries/configuration/section-card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { AuthorCard } from "@/app/actions/author-card";
import { InstitutionHoverCard, Stat, TopTopics } from "@/components/entity-cards";
import { useInstitutionFilter } from "@/components/paper-card/hooks";
import { FilterName } from "@/components/paper-card/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { readProfileAuthor } from "@/app/actions/authors";
import {PublicationListItem, PublicationMetadata} from "@/components/evidence-libraries/publication-list-item";
import type {AuthorProfile, OpenAlexMatch, AuthorPublication} from "./types";
import { OpenAlexLimitedError, unlessLimited } from "@/lib/openalex/limited";
import { authorFilterValue } from "@/lib/openalex/author-filter";
import { buildShareableUrl } from "@/lib/search-params";

const safeUrl = (value?: string) => {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

export default function AuthorPage({
  profile, configuration, canEdit, member = false, atHome = false, moveFrom, onSave, accessSection, papers, publicationStatus, loadingPublications, loadingAuthors,
  openAlexAuthors, openAlexPapers: works, onSearchAuthors, openAlexError,
  hasMoreWorks, workCount, loadingWorks: fetchingWorks, onLoadMoreWorks,
  card, automatic = false, extraActions, searchIds, linkedRecords,
}: {
  profile: AuthorProfile;
  configuration: boolean;
  canEdit: boolean;
  /** The workspace it's in, for its owners to move it to another of theirs (#654). */
  /** The person acts in the workspace that owns the profile, whose members see what changed on it. */
  member?: boolean;
  /** The page is at that workspace's address, where its members see who else has the profile open. */
  atHome?: boolean;
  moveFrom?: Id<"workspaces">;
  onSave: (profile: AuthorProfile, previous: AuthorProfile) => Promise<AuthorProfile>;
  accessSection: ReactNode;
  papers: AuthorPublication[];
  publicationStatus: string | null;
  loadingPublications: boolean;
  loadingAuthors: boolean;
  openAlexAuthors: OpenAlexMatch[];
  openAlexPapers: PaperResult[];
  onSearchAuthors: (search: string) => void;
  openAlexError: string | null;
  hasMoreWorks: boolean; workCount: number; loadingWorks: boolean; onLoadMoreWorks: () => void;
  /** What the author's record says: their counts and topics beside the profile. */
  card?: AuthorCard;
  /** A page made from the record, with no profile behind it: only its papers, and nothing to edit. */
  automatic?: boolean;
  extraActions?: ReactNode;
  /** Every author ID the profile links, which Search papers reads together. */
  searchIds?: string[];
  linkedRecords?: ReactNode;
}) {
  const tLabels = useTranslations("authorPages");
  const t = useTranslations("authorPages");
  const profileId = profile.id;
  const tm = useTranslations("workspaces.move");
  const ta = useTranslations("workspaces.activity");
  const tc = useTranslations("common");
  const tCard = useTranslations("entityCards");
  const tf = useTranslations("searchFilters");
  const institutionFilter = useInstitutionFilter();
  const [moving, setMoving] = useState(false);
  const [activity, setActivity] = useState(false);
  // Either mode of the page keeps the person in the profile's room. First in the bar's right-hand group, so faces arriving move nothing.
  const presence = atHome ? <span className="-order-1 flex"><ItemPresence kind="author" id={profileId} /></span> : null;
  // A paper is shown once its rating is read, so its card opens at its final size.
  const rated = useRatedPapers(works);
  const openAlexPapers = rated.papers;
  const loadingWorks = fetchingWorks || rated.loading;
  const profileHref = `/authors/${profileId}`;
  const configurationHref = `/authors/${profileId}/configuration`;
  // Their papers by their OpenAlex record once the profile is linked to one, otherwise by their name as written.
  const searchAuthor = authorFilterValue(profile.openalex || profile.name);
  const photoInput = useRef<HTMLInputElement>(null);
  const isFocusModeOpen = useUIStore((state) => state.isFocusModeOpen);
  const [draft, setDraft] = useState<AuthorProfile | null>(() =>
    configuration ? structuredClone(profile) : null,
  );
  const [savedProfile, setSavedProfile] = useState(profile);
  const editableFields = ["name", "headline", "affiliation", "bio", "website", "linkedin", "orcid", "openalex", "photo", "featured"] as const;
  const dirty = draft !== null && editableFields.some(field => JSON.stringify(draft[field]) !== JSON.stringify(savedProfile[field]));
  const [saving, setSaving] = useState(false);
  if (draft && !dirty && !saving && profile.revision > savedProfile.revision) {
    setDraft(structuredClone(profile));
    setSavedProfile(profile);
  }
  const profileChanged = !saving && profile.revision > savedProfile.revision;
  const [search, setSearch] = useState("");
  const [matchDialog, setMatchDialog] = useState(false);
  const [matchSearch, setMatchSearch] = useState("");
  const [candidate, setCandidate] = useState<OpenAlexMatch | null>(null);
  const unavailable = Boolean(openAlexError);
  const [unlink, setUnlink] = useState(false);
  const [formError, setFormError] = useState("");
  const [publicationTab, setPublicationTab] = useState<"selected" | "openalex">(automatic ? "openalex" : "selected");
  const source = useSearchSource();
  const SourceIcon = source === "openalex" ? OpenAlexIcon : LogoMark;
  const update = async (next: AuthorProfile) => {
    setSaving(true);
    try {
      const saved = await onSave(next, savedProfile);
      setDraft(saved);
      setSavedProfile(saved);
      setFormError("");
      return true;
    }
    catch (error) { setFormError(error instanceof Error ? error.message : tLabels("couldNotSaveThisProfile")); return false; }
    finally { setSaving(false); }
  };
  const openMatch = () => {
    setMatchSearch(draft?.name ?? profile.name);
    onSearchAuthors(draft?.name ?? profile.name);
    setCandidate(null);
    setMatchDialog(true);
  };
  const papersById = new Map(papers.map(paper => [paper.id, paper]));
  const featured = (profile.featured ?? []).flatMap(id => papersById.get(id) ?? []);
  const libraries = [...new Map(featured.map(paper => [paper.library.id, paper.library])).values()];
  const filtered = featured.filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase()),
  );
  const matches = openAlexAuthors.filter((p) =>
    `${p.name} ${p.affiliation} ${p.id}`
      .toLowerCase()
      .includes(
        matchSearch.replace("https://openalex.org/", "").trim().toLowerCase(),
      ),
  );
  return (
    <main id="author-page" className="w-full">
      {draft && (
        <ConfigurationLayout
          header={
            <PanelHeader
              icon={PersonIcon}
              title={profile.name}
              backHref={profileHref}
              backLabel={tLabels("backToAuthorProfile")}
              titleAside={<>
                <span className="hidden text-sm text-muted-foreground @3xl:inline">{t("profileSettings")}</span>
                {dirty ? (
                  <StatusChip tone="warning">
                    <PencilLine aria-hidden />
                    <span className={BAR_LABEL}>{t("unsavedChanges")}</span>
                  </StatusChip>
                ) : null}
              </>}
            >
              {presence}
              <Button variant="outline" size="sm" className={BAR_ACTION} asChild>
                <Link href={profileHref}>
                  <ArrowUpRight />
                  <span className={BAR_LABEL}>{dirty ? t("cancel") : t("viewProfile")}</span>
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={BAR_ACTION}
                type="submit"
                form="author-profile-form"
                disabled={!dirty || saving || profileChanged}
              >
                <Save className="size-4" />
                <span className={BAR_LABEL}>{t("save")}</span>
              </Button>
            </PanelHeader>
          }
          navigation={<AuthorSettingsNavigation canManageAccess={Boolean(accessSection)} />}
        >
          <form
            id="author-profile-form"
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (saving || profileChanged) return;
              if (!draft.name.trim()) {
                setFormError(tLabels("enterTheAuthorSName"));
                return;
              }
              if (
                draft.orcid &&
                !/^(https:\/\/orcid.org\/)?\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(
                  draft.orcid.trim(),
                )
              ) {
                setFormError(
                  tLabels("enterAValidOrcidSuchAs"),
                );
                return;
              }
              if (
                (draft.website && !safeUrl(draft.website)) ||
                (draft.linkedin && !safeUrl(draft.linkedin))
              ) {
                setFormError(tLabels("useAFullHttpOrHttps"));
                return;
              }
              await update({ ...draft, name: draft.name.trim() });
            }}
          >
            <div className="space-y-4">
              {profileChanged ? (
                <FieldError action={
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    setDraft(structuredClone(profile));
                    setSavedProfile(profile);
                    setFormError("");
                  }}>
                    <RefreshCw /> {t("loadLatestVersion")}
                  </Button>
                }>
                  {t("thisProfileChangedWhileYouWere")}
                </FieldError>
              ) : formError ? <FieldError>{formError}</FieldError> : null}
              <SectionCard
                icon={PersonIcon}
                title={t("profileDetails")}
                id="sec-profile-details"
              >
                <div className="flex items-center gap-4 rounded-xl bg-inset p-3">
                  <AuthorAvatar photo={draft.photo} className="size-16 border border-border-subtle" />
                  <div className="min-w-0 flex-1">
                    <p className="mb-2 text-sm font-medium">{t("profilePhoto")}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => photoInput.current?.click()}
                      >
                        <Upload className="size-3.5" />
                        {draft.photo ? t("changePhoto") : t("uploadPhoto")}
                      </Button>
                      <input
                        ref={photoInput}
                        className="hidden"
                        aria-label={t("uploadProfilePhoto")}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (
                            file.size > 500000 ||
                            !["image/png", "image/jpeg", "image/webp"].includes(
                              file.type,
                            )
                          ) {
                            setFormError(
                              "Choose a PNG, JPEG or WebP under 500 KB.",
                            );
                            return;
                          }
                          const photo = await new Promise<string>((resolve) => {
                            const reader = new FileReader();
                            reader.onload = () =>
                              resolve(String(reader.result));
                            reader.readAsDataURL(file);
                          });
                          setDraft((current) =>
                            current ? { ...current, photo } : null,
                          );
                          setFormError("");
                        }}
                      />
                      {draft.photo && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setDraft({ ...draft, photo: undefined })}
                        >
                          <Trash2 className="size-3.5" />
                          {t("remove")}
                        </Button>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("pngJpgOrWebpUpTo")}
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["name", tLabels("name"), UserRound],
                      ["affiliation", tLabels("affiliation"), GraduationCap],
                      ["headline", tLabels("headline"), Pencil],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <Field
                      key={key}
                      label={
                        <span className="flex items-center gap-2">
                          <Icon className="size-3.5 text-muted-foreground" />
                          {label}
                        </span>
                      }
                      className={
                        key === "headline" ? "sm:col-span-2" : undefined
                      }
                    >
                      {(id) => (
                        <Input
                          id={id}
                          required={key === "name"}
                          value={draft[key] ?? ""}
                          onChange={(e) =>
                            setDraft({ ...draft, [key]: e.target.value })
                          }
                        />
                      )}
                    </Field>
                  ))}
                </div>
                <Field
                  label={
                    <span className="flex items-center gap-2">
                      <FileText className="size-3.5 text-muted-foreground" />
                      {t("biography")}
                    </span>
                  }
                >
                  {(id) => (
                    <Textarea
                      id={id}
                      className="min-h-24 resize-y"
                      value={draft.bio}
                      onChange={(e) =>
                        setDraft({ ...draft, bio: e.target.value })
                      }
                    />
                  )}
                </Field>
              </SectionCard>
              <SectionCard
                id="sec-profile-links"
                icon={LinkIcon}
                title={t("linksIdentifiers")}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["website", tLabels("website"), "https://", Globe],
                      [
                        "linkedin",
                        "LinkedIn",
                        "https://linkedin.com/in/",
                        LinkedInIcon,
                      ],
                      ["orcid", "ORCID", "0000-0000-0000-0000", OrcidIcon],
                    ] as const
                  ).map(([key, label, placeholder, Icon]) => (
                    <Field
                      key={key}
                      label={
                        <span className="flex items-center gap-2">
                          <Icon className="size-3.5 text-muted-foreground" />
                          {label}
                        </span>
                      }
                      className={key === "orcid" ? "sm:col-span-2" : undefined}
                    >
                      {(id) => (
                        <Input
                          id={id}
                          type={key === "orcid" ? "text" : "url"}
                          placeholder={placeholder}
                          value={draft[key] ?? ""}
                          onChange={(e) =>
                            setDraft({ ...draft, [key]: e.target.value })
                          }
                        />
                      )}
                    </Field>
                  ))}
                </div>
              </SectionCard>
              <SectionCard
                id="sec-profile-publications"
                title={t("selectedPublications")}
                icon={BookIcon}
                description={t("chooseThePublishedWorksToFeature")}
              >
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>
                    {draft.featured?.length ?? 0} of {papers.length} selected
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={loadingPublications || Boolean(publicationStatus) || papers.length === 0}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        featured: [...new Set([...(draft.featured ?? []), ...papers.map((paper) => paper.id)])],
                      })
                    }
                  >
                    <Check className="size-3.5" />
                    {t("selectAll")}
                  </Button>
                </div>
                <div className="divide-y divide-border-subtle">
                  {papers.map((paper) => (
                    <label
                      key={paper.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted has-[:checked]:bg-primary/5"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={(draft.featured ?? []).includes(paper.id)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            featured: e.target.checked
                              ? [...(draft.featured ?? []), paper.id]
                              : (draft.featured ?? []).filter(
                                  (id) => id !== paper.id,
                                ),
                          })
                        }
                      />
                      <Avatar className="h-14 w-10 shrink-0 rounded-sm border border-border-subtle">
                        <AvatarImage
                          src={paper.cover}
                          alt=""
                          className="object-cover"
                        />
                        <AvatarFallback className="rounded-none">
                          <FileText className="size-4 text-muted-foreground" />
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {paper.title}
                        </span>
                        <PublicationMetadata year={paper.year} type={paper.type} className="mt-1 flex items-center gap-3 text-xs text-muted-foreground" />
                      </span>
                    </label>
                  ))}
                  {loadingPublications ? (
                    <ListLoading compact label={t("loadingPublications")} />
                  ) : publicationStatus ? (
                    <p className="py-3 text-sm text-muted-foreground">{publicationStatus}</p>
                  ) : !papers.length && (
                    <ListEmpty compact icon={BookOpen}>{t("noPublishedWorksAreLinkedTo")}</ListEmpty>
                  )}
                </div>
              </SectionCard>
              <SectionCard
                id="sec-profile-openalex"
                icon={SourceIcon}
                title={t("authorRecords")}
                description={t("authorRecordsDescription")}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    {draft.match ? (
                      <>
                        <p className="flex items-center gap-2 font-medium">{draft.openalex === profile.openalex && profile.match ? profile.match.name : draft.match.name}<span className="rounded bg-primary/10 px-1.5 py-0.5 text-3xs font-medium text-primary">{t("mainRecord")}</span><code className="rounded bg-inset px-1.5 py-0.5 text-3xs font-normal text-muted-foreground">{draft.match.id}</code></p>
                        <p className="text-xs text-muted-foreground">
                          {draft.openalex === profile.openalex && profile.match ? profile.match.affiliation : draft.match.affiliation}
                        </p>
                        {source === "openalex" && !isOwnId(draft.match.id) && (
                        <a
                          className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                          href={`https://openalex.org/${draft.match.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {draft.match.id}
                          <ArrowUpRight className="size-3" />
                        </a>
                        )}
                      </>
                    ) : (
                      <p className="text-muted-foreground">
                        {t("linkAnAuthorToDisplayTheir")}
                      </p>
                    )}
                  </div>
                  <ButtonGroup>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openMatch}
                    >
                      <Link2 />
                      {draft.match ? t("changeMainRecord") : t("findAuthor")}
                    </Button>
                    {draft.match && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setUnlink(true)}
                      >
                        <Unlink />
                        {t("unlink")}
                      </Button>
                    )}
                  </ButtonGroup>
                </div>
                {linkedRecords}
              </SectionCard>

            </div>
          </form>
          {accessSection}
        </ConfigurationLayout>
      )}
      {!draft && (
        <LibraryPageShell
          icon={PersonIcon}
          title={profile.name}
          backHref="/authors"
          backLabel={tLabels("backToAuthors")}
          actions={<>
            {presence}
            {member ? (
              <Button variant="ghost" size="sm" className={BAR_ACTION} onClick={() => setActivity(true)}>
                <History />
                <span className={BAR_LABEL}>{ta("title")}</span>
              </Button>
            ) : null}
            {moveFrom ? (
              <Button variant="ghost" size="sm" className={BAR_ACTION} onClick={() => setMoving(true)}>
                <Move />
                <span className={BAR_LABEL}>{tm("move")}</span>
              </Button>
            ) : null}
            {searchAuthor && <TooltipHint label={tc("searchPapers")}>
              <Button variant="outline" size="sm" className="w-8 px-0" aria-label={tc("searchPapers")} asChild>
                <Link href={buildShareableUrl("", { author: searchIds?.length ? searchIds : [searchAuthor], sort: "cited_by_count:desc" })}>
                  <Search aria-hidden />
                </Link>
              </Button>
            </TooltipHint>}
            <Button
              variant="outline"
              size="sm"
              className={BAR_ACTION}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${location.origin}/authors/${profile.id}`,
                  );
                  toast.success(t("profileLinkCopied"));
                } catch {
                  toast.error(
                    t("copyTheAddressFromYourBrowser"),
                  );
                }
              }}
            >
              <Copy />
              <span className={BAR_LABEL}>{t("share")}</span>
            </Button>
            {extraActions}
            {canEdit && <Button size="sm" className={BAR_ACTION} asChild>
              <Link href={configurationHref}>
                <Pencil />
                <span className={BAR_LABEL}>{t("editProfile")}</span>
              </Link>
            </Button>}
          </>}
          tabs={
            <ListViewTabs
              label={t("publicationSources")}
              value={publicationTab}
              onChange={setPublicationTab}
              tabs={[
                ...(automatic ? [] : [{value: "selected" as const, label: t("selectedPublications"), icon: <BookOpen className="size-3.5" />, count: loadingPublications ? undefined : featured.length}]),
                // The OpenAlex total is known once its first page arrives.
                {value: "openalex", label: source === "openalex" ? t("fromOpenalex") : SEARCH_SOURCE_NAMES[source], icon: <SourceIcon className="size-3.5 shrink-0" />, count: workCount || undefined},
              ]}
            />
          }
          filters={publicationTab === "selected" && (
            <ListSearch
              placeholder={t("findAPublication")}
              aria-label={t("searchPublications")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          filtersInCard
          intro={<>
              <header className="relative isolate overflow-hidden p-5 sm:p-6">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_0%_0%,var(--primary),transparent_65%)] opacity-[0.09] dark:opacity-[0.12]"
                />
                <svg
                  aria-hidden="true"
                  focusable="false"
                  viewBox="0 0 480 320"
                  fill="none"
                  className="pointer-events-none absolute -bottom-20 -end-16 -z-10 h-80 w-[480px] text-primary opacity-[0.07] dark:opacity-[0.10]"
                >
                  {[90, 125, 160, 195, 230, 265].map((radius) => (
                    <circle
                      key={radius}
                      cx="370"
                      cy="240"
                      r={radius}
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                  ))}
                  <path
                    d="M0 240H480M370 0V320"
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                </svg>
                <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.85fr)] lg:gap-14">
                  <div>
                    <div className="flex items-center gap-5">
                      <AuthorAvatar photo={profile.photo} className="size-24 border border-border-subtle sm:size-28" />
                      <div className="min-w-0">
                        <p className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                          {profile.name}
                        </p>
                        {profile.affiliation && (
                          <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                            <GraduationCap className="mt-0.5 size-4 shrink-0" />
                            {card?.institution?.id && card.institution.name === profile.affiliation ? (
                              <InstitutionHoverCard id={card.institution.id} name={profile.affiliation}>
                                <FilterName
                                  pressed={false}
                                  label={tf("filterByThisInstitution", { name: profile.affiliation })}
                                  onToggle={() => institutionFilter.toggle({ value: card.institution!.id!, name: profile.affiliation })}
                                >
                                  {profile.affiliation}
                                </FilterName>
                              </InstitutionHoverCard>
                            ) : profile.affiliation}
                          </p>
                        )}
                      </div>
                    </div>
                    {profile.headline && (
                      <p className="mt-5 max-w-lg text-lg leading-relaxed">
                        {profile.headline}
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
                      {[
                        {
                          name: "ORCID",
                          icon: OrcidIcon,
                          url: profile.orcid
                            ? `https://orcid.org/${profile.orcid.replace("https://orcid.org/", "")}`
                            : "",
                        },
                        { name: tLabels("website"), icon: Globe, url: profile.website },
                        {
                          name: "LinkedIn",
                          icon: LinkedInIcon,
                          url: profile.linkedin,
                        },
                      ]
                        .filter((l) => safeUrl(l.url))
                        .map((l) => (
                          <a
                            key={l.name}
                            href={safeUrl(l.url)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"
                          >
                            <l.icon className="size-3.5" />
                            {l.name}
                            <ArrowUpRight className="ms-auto size-3.5" />
                          </a>
                        ))}
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    {card && (
                      <div className={cn("max-w-md", profile.bio && "mb-6")}>
                        <div className="grid grid-cols-3 gap-3">
                          <Stat value={workCount || card.works} label={tCard("papers")} />
                          <Stat value={card.citations} label={tCard("citations")} />
                          <Stat value={card.hIndex} label={tCard("hIndex")} />
                        </div>
                        <TopTopics topics={card.topics} onNavigate={() => {}} />
                      </div>
                    )}
                    {profile.bio && (
                      <p className="max-w-prose text-sm leading-7 text-muted-foreground">
                        {profile.bio}
                      </p>
                    )}
                    {papers.length > 0 && (
                      <div
                        className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2"
                        aria-label={t("evidenceLibraries")}
                      >
                        <span className="text-xs text-muted-foreground">
                          {t("publishedIn")}
                        </span>
                        {libraries.map(library => <Tooltip key={library.id}>
                          <TooltipTrigger asChild>
                            <a
                              href={library.url}
                              target="_blank"
                              rel="noreferrer"
                              className="group inline-flex items-center gap-2 rounded-sm outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                            >
                              <Library className="size-4 text-primary" />
                              <span className="text-sm font-medium group-hover:text-primary">
                                {library.name}
                              </span>
  
                              <ArrowUpRight className="size-3 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                            </a>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={8}>
                            <p>{library.url}</p>
                            <p className="mt-1 opacity-70">
                              {t("publishedWorksInThisLibrary", { length: featured.filter(paper => paper.library.id === library.id).length })}</p>
                          </TooltipContent>
                        </Tooltip>)}
                      </div>
                    )}
                  </div>
                </div>
              </header>
          </>}
        >
          {/* The bar's heading is the author's name; this names the list for screen readers. */}
          <h2 className="sr-only">{t("publications")}</h2>
          {/* Each tab keys its own list, so the new one fades in instead of popping. */}
          {publicationTab === "selected" ? <div key="selected" className="fade-enter">
            <div className="overflow-hidden">
              {filtered.map(p => <PublicationListItem key={p.id} publication={p} />)}
              {loadingPublications ? (
                <ListLoading label={t("loadingPublications")} />
              ) : publicationStatus ? (
                <p className="p-6 text-center text-sm text-muted-foreground">{publicationStatus}</p>
              ) : !filtered.length && (
                <ListEmpty icon={featured.length ? SearchX : BookOpen}>
                  {featured.length ? t("noPublicationsMatchYourSearch") : t("noPublicationsSelectedYet")}
                </ListEmpty>
              )}
            </div>
          </div> : <div key="openalex" className="fade-enter">
            {openAlexError && <p role="alert" className="p-4 text-sm text-destructive">{openAlexError}</p>}
            {profile.match ? (
              <>
                <FocusMode
                  isOpen={isFocusModeOpen}
                  onClose={() =>
                    useUIStore.getState().setIsFocusModeOpen(false)
                  }
                  papers={openAlexPapers}
                  onDownloadItem={downloadLibraryItem}
                  onDownloadEssentialItem={downloadLibraryEssentialItem}
                />
                <div className="flex flex-col gap-4 p-4">
{!openAlexPapers.length && (loadingWorks ? <ListLoading label={t("loadingPublications")} /> : <ListEmpty icon={SourceIcon}>{t("noPublicationsToDisplay", {source: SEARCH_SOURCE_NAMES[source]})}</ListEmpty>)}
                  {openAlexPapers
                    .map((paper, index) => (
                      <PaperCard
                        key={paper.id}
                        result={paper}
                        resultIndex={index}
                        viewMode="list-detail"
                        onDownloadItem={downloadLibraryItem}
                        onDownloadEssentialItem={
                          downloadLibraryEssentialItem
                        }
                      />
                    ))}
                </div>
                {hasMoreWorks && (
                  <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-3">
                    <span className="text-xs text-muted-foreground">
                      {openAlexPapers.length} of{" "}
                      {workCount} publications
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onLoadMoreWorks}
                      disabled={loadingWorks}
                    >
                      {t("showMore")}
                      {loadingWorks ? <Spinner /> : <ChevronRight className="size-3.5 rotate-90" />}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <ListEmpty icon={SourceIcon}>{t("noPublicationsToDisplay", {source: SEARCH_SOURCE_NAMES[source]})}</ListEmpty>
            )}
          </div>}
        </LibraryPageShell>
      )}
      {profile && (
        <>
          <Dialog open={matchDialog} onOpenChange={setMatchDialog}>
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>
                  {candidate
                    ? t("confirmAuthorMatch")
                    : t("findAuthorOnOpenalex")}
                </DialogTitle>
                <DialogDescription>
                  {candidate
                    ? t("checkTheAffiliationAndResearchBefore")
                    : t("searchByNameAffiliationOrOpenalex")}
                </DialogDescription>
              </DialogHeader>
              {candidate ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-medium">{candidate.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {candidate.affiliation}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {candidate.id}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {candidate.topics}
                  </p>
                  <div className="divide-y rounded-lg border">
                    {candidate.works.slice(0, 2).map((w) => (
                      <p key={w} className="p-3 text-sm">
                        {w}
                      </p>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("yourNameBiographyLinksAndSelected")}
                  </p>
                </div>
              ) : (
                <>
                  <Input
                    aria-label={t("searchOpenalexAuthors")}
                    value={matchSearch}
                    onChange={(e) => { setMatchSearch(e.target.value); onSearchAuthors(e.target.value); }}
                    placeholder={t("nameAffiliationOrAuthorId")}
                  />
                  {unavailable ? (
                    <div
                      role="alert"
                      className="space-y-3 rounded-lg border p-4"
                    >
                      <p className="text-sm">
                        {t("openalexSearchIsUnavailableYourProfile")}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSearchAuthors(matchSearch)}
                        disabled={loadingAuthors}
                      >
                        {loadingAuthors && <Spinner />}{t("tryAgain")}
                      </Button>
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y rounded-lg border">
                      {matches.map((m) => (
                        <button
                          type="button"
                          key={m.id}
                          className="flex w-full items-center gap-3 p-3 text-start hover:bg-muted"
                          onClick={async () => {
                            setCandidate(m);
                            try { const detail = await unlessLimited(readProfileAuthor(m.id, source)); setCandidate(current => current?.id === m.id ? detail : current); }
                            catch (error) { toast.error(error instanceof OpenAlexLimitedError ? error.message : t("couldNotLoadThisAuthorS")); }
                          }}
                        >
                          <AuthorAvatar className="size-9" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">
                              {m.name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {m.affiliation}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {m.topics}
                            </span>
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                      {loadingAuthors ? (
                        matches.length ? <div className="flex justify-center p-3"><Spinner aria-label={t("searchingOpenalexAuthors")} className="size-5 text-primary" /></div> : <ListLoading compact label={t("searchingOpenalexAuthors")} />
                      ) : !matches.length && (
                        <ListEmpty compact icon={matchSearch.trim() ? SearchX : Search}>
                          {matchSearch.trim() ? t("noAuthorsMatchYourSearch") : t("searchForAnAuthorByName")}
                        </ListEmpty>
                      )}
                    </div>
                  )}

                </>
              )}
              <DialogFooter>
                {candidate ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setCandidate(null)}
                    >
                      {t("back")}
                    </Button>
                    <Button
                      onClick={() => {
                        if (!draft) return;
                        setDraft({
                          ...draft,
                          openalex: candidate.id,
                          match: structuredClone(candidate),
                        });
                        setMatchDialog(false);
                      }}
                    >
                      <Link2 />
                      {t("confirmMatch")}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setMatchDialog(false)}
                  >
                    {t("cancel")}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={unlink} onOpenChange={setUnlink}>
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>{t("unlinkOpenalexAuthor")}</DialogTitle>
                <DialogDescription>
                  {t("thisRemovesTheImportedResearchFrom")}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setUnlink(false)}>
                  {t("cancel")}
                </Button>
                <Button
                  onClick={() => {
                    if (!draft) return;
                    setDraft({ ...draft, openalex: "", match: undefined });
                    setUnlink(false);
                  }}
                >
                  {t("unlinkAuthor")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
      {/* The profile's own view has the button; its settings read nothing for a sheet they can't open. */}
      {member && !draft ? <ActivitySheet open={activity} onOpenChange={setActivity} kind="author" id={profileId} name={profile.name} /> : null}
      {moveFrom ? <MoveDialog open={moving} onOpenChange={setMoving} kind="author" id={profileId} name={profile.name} from={moveFrom} /> : null}
    </main>
  );
}
