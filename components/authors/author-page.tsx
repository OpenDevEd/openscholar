"use client";
import {
  LinkedInIcon,
  OrcidIcon,
} from "@/components/icons/author-service-icons";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthorSettingsNavigation } from "./author-settings-navigation";
import { PanelHeader } from "@/components/evidence-libraries/configuration/panel-header";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { ConfigurationLayout } from "@/components/evidence-libraries/configuration/configuration-layout";

import { AuthorAvatar } from "./author-avatar";
import { StickyAuthorHeader } from "./sticky-author-header";
import { useRef, useState, type ReactNode } from "react";
import {
  Upload,
  Save,
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
  Search,
  Unlink,
  Users,
  Trash2,
  RefreshCw,
} from "lucide-react";
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
} from "@/components/ui/tooltip";
import { ButtonGroup } from "@/components/ui/button-group";

import {
  SectionCard,
  Field,
  FieldError,
} from "@/components/evidence-libraries/configuration/section-card";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import type {AuthorProfile, OpenAlexMatch, AuthorPublication} from "./types";

const safeUrl = (value?: string) => {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

export default function AuthorPage({
  profile, configuration, canEdit, canBrowseAuthors = false, onSave, accessSection, papers, publicationStatus, loadingPublications, loadingAuthors,
  openAlexAuthors, openAlexPapers, onSearchAuthors, openAlexError,
  hasMoreWorks, workCount, loadingWorks, onLoadMoreWorks,
}: {
  profile: AuthorProfile;
  configuration: boolean;
  canEdit: boolean;
  canBrowseAuthors?: boolean;
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
}) {
  const profileId = profile.id;
  const router = useRouter();
  const profileHref = `/authors/${profileId}`;
  const configurationHref = `/authors/${profileId}/configuration`;
  const headerRef = useRef<HTMLElement>(null);
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
  const [publicationTab, setPublicationTab] = useState("selected");
  const publicationsRef = useRef<HTMLDivElement>(null);
  const update = async (next: AuthorProfile) => {
    setSaving(true);
    try {
      const saved = await onSave(next, savedProfile);
      setDraft(saved);
      setSavedProfile(saved);
      setFormError("");
      return true;
    }
    catch (error) { setFormError(error instanceof Error ? error.message : "Could not save this profile"); return false; }
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
    <main
      id="author-page"
      className={
        draft
          ? "w-full"
          : "relative isolate mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8"
      }
    >
      {profile && !draft && (
        <StickyAuthorHeader
          profile={profile}
          headerRef={headerRef}
          onEdit={canEdit ? () => router.push(configurationHref) : undefined}
        />
      )}
      {!draft && (
        <div className="!mt-0 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="size-4" />
            {canBrowseAuthors ? <Link href="/authors" className="hover:text-foreground">Authors</Link> : <span>Authors</span>}
            <ChevronRight className="size-3" />
            <span className="truncate text-foreground">
              {profile?.name ?? "Profile not found"}
            </span>
          </div>
          {profile && !draft && (
            <ButtonGroup>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${location.origin}/authors/${profile.id}`,
                    );
                    toast.success("Profile link copied");
                  } catch {
                    toast.error(
                      "Copy the address from your browser to share this profile",
                    );
                  }
                }}
              >
                <Copy />
                Share
              </Button>
              {canEdit && <Button size="sm" asChild>
                <Link href={configurationHref}>
                  <Pencil />
                  Edit profile
                </Link>
              </Button>}
            </ButtonGroup>
          )}
        </div>
      )}
      {draft && (
        <ConfigurationLayout
          header={
            <PanelHeader
              icon={UserRound}
              title={profile?.name ?? "Author profile"}
              description="Author profile settings"
              backHref={profileHref}
              backLabel="Back to author profile"
              className="border-b-0 px-0 md:px-0"
              titleAside={
                dirty ? (
                  <StatusChip tone="warning">Unsaved changes</StatusChip>
                ) : null
              }
            >
              <Button variant="outline" asChild>
                <Link href={profileHref}>
                  <ArrowUpRight />
                  {dirty ? "Cancel" : "View profile"}
                </Link>
              </Button>
              <Button
                variant="outline"
                type="submit"
                form="author-profile-form"
                disabled={!dirty || saving || profileChanged}
              >
                <Save className="size-4" />
                Save
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
                setFormError("Enter the author's name.");
                return;
              }
              if (
                draft.orcid &&
                !/^(https:\/\/orcid.org\/)?\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(
                  draft.orcid.trim(),
                )
              ) {
                setFormError(
                  "Enter a valid ORCID, such as 0000-0000-0000-0000.",
                );
                return;
              }
              if (
                (draft.website && !safeUrl(draft.website)) ||
                (draft.linkedin && !safeUrl(draft.linkedin))
              ) {
                setFormError("Use a full http or https URL.");
                return;
              }
              if (
                await update({
                  ...draft,
                  name: draft.name.trim(),
                })
              ) {
                toast.success("Profile saved");
              }
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
                    <RefreshCw /> Load latest version
                  </Button>
                }>
                  This profile changed while you were editing. Loading the latest version replaces your unsaved changes.
                </FieldError>
              ) : formError ? <FieldError>{formError}</FieldError> : null}
              <SectionCard
                icon={UserRound}
                title="Profile details"
                id="sec-profile-details"
                className="scroll-mt-28"
              >
                <div className="flex items-center gap-4 rounded-xl bg-muted/20 p-3">
                  <AuthorAvatar photo={draft.photo} className="size-16 border border-border/50" />
                  <div className="min-w-0 flex-1">
                    <p className="mb-2 text-sm font-medium">Profile photo</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => photoInput.current?.click()}
                      >
                        <Upload className="size-3.5" />
                        {draft.photo ? "Change photo" : "Upload photo"}
                      </Button>
                      <input
                        ref={photoInput}
                        className="hidden"
                        aria-label="Upload profile photo"
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
                          Remove
                        </Button>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      PNG, JPG or WebP. Up to 500 KB.
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["name", "Name", UserRound],
                      ["affiliation", "Affiliation", GraduationCap],
                      ["headline", "Headline", Pencil],
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
                      Biography
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
                icon={Link2}
                title="Links & identifiers"
                className="scroll-mt-28"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["website", "Website", "https://", Globe],
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
                title="Selected publications"
                icon={BookOpen}
                description="Choose the published works to feature on this profile."
                className="scroll-mt-28"
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
                    Select all
                  </Button>
                </div>
                <div className="divide-y divide-border/50">
                  {papers.map((paper) => (
                    <label
                      key={paper.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/30 has-[:checked]:bg-primary/5"
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
                      <Avatar className="h-14 w-10 shrink-0 rounded-sm border border-border/50">
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
                        <span className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{paper.year}</span>
                          <span>{paper.type}</span>
                        </span>
                      </span>
                    </label>
                  ))}
                  {loadingPublications ? (
                    <div className="flex min-h-24 items-center justify-center"><Spinner aria-label="Loading publications" className="size-5 text-primary" /></div>
                  ) : (publicationStatus || !papers.length) && (
                    <p className="py-3 text-sm text-muted-foreground">
                      {publicationStatus ?? "No published works are linked to this author yet."}
                    </p>
                  )}
                </div>
              </SectionCard>
              <SectionCard
                id="sec-profile-openalex"
                className="scroll-mt-28"
                icon={OpenAlexIcon}
                title="OpenAlex"
                description="Connect the author's research record to display their publications."
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    {draft.match ? (
                      <>
                        <p className="font-medium">{draft.match.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {draft.match.affiliation}
                        </p>
                        <a
                          className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                          href={`https://openalex.org/${draft.match.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          openalex.org/{draft.match.id}
                          <ArrowUpRight className="size-3" />
                        </a>
                      </>
                    ) : (
                      <p className="text-muted-foreground">
                        Link an author to display their OpenAlex publications.
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
                      {draft.match ? "Change match" : "Find author"}
                    </Button>
                    {draft.match && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setUnlink(true)}
                      >
                        <Unlink />
                        Unlink
                      </Button>
                    )}
                  </ButtonGroup>
                </div>
              </SectionCard>

            </div>
          </form>
          {accessSection}
        </ConfigurationLayout>
      )}
      {!draft &&
        (!profile ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground">
              Author profile not found.
            </CardContent>
          </Card>
        ) : (
          <>
            <header
              ref={headerRef}
              className="relative isolate overflow-hidden rounded-2xl border-2 border-border/60 bg-muted/20 p-5 sm:p-6"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_0%_0%,var(--primary),transparent_65%)] opacity-[0.09] dark:opacity-[0.12]"
              />
              <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 480 320"
                fill="none"
                className="pointer-events-none absolute -bottom-20 -right-16 -z-10 h-80 w-[480px] text-primary opacity-[0.07] dark:opacity-[0.10]"
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
                    <AuthorAvatar photo={profile.photo} className="size-24 border border-border/50 sm:size-28" />
                    <div className="min-w-0">
                      <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                        {profile.name}
                      </h1>
                      {profile.affiliation && (
                        <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                          <GraduationCap className="mt-0.5 size-4 shrink-0" />
                          {profile.affiliation}
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
                      { name: "Website", icon: Globe, url: profile.website },
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
                          <ArrowUpRight className="ml-auto size-3.5" />
                        </a>
                      ))}
                  </div>
                </div>
                <div className="flex flex-col justify-center">
                  {profile.bio && (
                    <p className="max-w-prose text-sm leading-7 text-muted-foreground">
                      {profile.bio}
                    </p>
                  )}
                  {papers.length > 0 && (
                    <div
                      className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2"
                      aria-label="Evidence libraries"
                    >
                      <span className="text-xs text-muted-foreground">
                        Published in
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
                            {featured.filter(paper => paper.library.id === library.id).length} published works in this library
                          </p>
                        </TooltipContent>
                      </Tooltip>)}
                    </div>
                  )}
                </div>
              </div>
            </header>
            <SectionCard
              title="Publications"
              icon={BookOpen}
              bodyClassName="p-0 space-y-0"
            >
              <Tabs
                ref={publicationsRef}
                value={publicationTab}
                onValueChange={setPublicationTab}
                className="min-w-0 gap-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
                  <TabsList className="justify-start gap-1 rounded-lg bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-auto">
                    <TabsTrigger
                      value="selected"
                      className="h-8 flex-none gap-2 rounded-md border-0 px-3 py-1 text-xs transition-colors after:hidden data-[state=active]:bg-muted data-[state=active]:shadow-none dark:data-[state=active]:bg-muted"
                    >
                      <BookOpen className="size-3.5" />
                      Selected publications{" "}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {featured.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="openalex"
                      className="h-8 flex-none gap-2 rounded-md border-0 px-3 py-1 text-xs transition-colors after:hidden data-[state=active]:bg-muted data-[state=active]:shadow-none dark:data-[state=active]:bg-muted"
                    >
                      <OpenAlexIcon className="size-3.5" />
                      From OpenAlex
                    </TabsTrigger>
                  </TabsList>
                  {publicationTab === "selected" && (
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="h-8 border-border/50 bg-background pl-8 text-xs shadow-none"
                        placeholder="Find a publication…"
                        aria-label="Search publications"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  )}
                </div>
                <TabsContent value="selected" className="mt-0 space-y-0">
                  <div className="overflow-hidden">
                    {filtered.map((p) => (
                      <article
                        key={p.id}
                        className="group grid grid-cols-[64px_minmax(0,1fr)] items-center gap-4 border-b border-border/50 px-4 py-4 transition-colors hover:bg-muted/20 last:border-b-0 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:gap-6"
                      >
                        <button
                          className="rounded-sm outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                          aria-label={`Preview ${p.title} cover`}
                          onClick={() => window.open(p.url, "_blank", "noopener,noreferrer")}
                        >
                          <Avatar className="h-[92px] w-16 rounded-sm border border-border/50 shadow-sm transition-transform group-hover:-translate-y-0.5 sm:h-28 sm:w-20">
                            <AvatarImage
                              src={p.cover}
                              alt=""
                              className="object-cover"
                            />
                            <AvatarFallback className="rounded-none bg-muted/30">
                              <FileText className="size-6 text-muted-foreground/50" />
                            </AvatarFallback>
                          </Avatar>
                        </button>
                        <div className="min-w-0">
                          <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium tabular-nums">
                              {p.year}
                            </span>
                            <span className="size-0.5 rounded-full bg-muted-foreground" />
                            {p.type}
                          </p>
                          <button
                            className="text-left text-base font-semibold leading-snug hover:text-primary sm:text-lg"
                            onClick={() => window.open(p.url, "_blank", "noopener,noreferrer")}
                          >
                            {p.title}
                          </button>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {p.authors}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <a
                              href={p.library.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 hover:text-foreground"
                            >
                              <Library className="size-3" />
                              {p.library.name}
                            </a>
                            {p.pages !== undefined && <span className="flex items-center gap-1.5">
                              <FileText className="size-3" />
                              <span>PDF</span>
                              <span>{p.pages} pages</span>
                            </span>}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="hidden sm:inline-flex"
                          aria-label={`Preview ${p.title}`}
                          onClick={() => window.open(p.url, "_blank", "noopener,noreferrer")}
                        >
                          <ArrowUpRight />
                        </Button>
                      </article>
                    ))}
                    {loadingPublications ? (
                      <div className="flex min-h-40 items-center justify-center"><Spinner aria-label="Loading publications" className="size-6 text-primary" /></div>
                    ) : (publicationStatus || !filtered.length) && (
                      <p className="p-6 text-center text-sm text-muted-foreground">
                        {publicationStatus ?? (featured.length
                          ? "No publications match your search."
                          : "No publications selected yet.")}
                      </p>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="openalex" className="mt-0 space-y-0">
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
                        {loadingWorks && !openAlexPapers.length && <div className="flex min-h-40 items-center justify-center"><Spinner aria-label="Loading OpenAlex publications" className="size-6 text-primary" /></div>}
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
                        <div className="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-3">
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
                            Show more
                            {loadingWorks ? <Spinner /> : <ChevronRight className="size-3.5 rotate-90" />}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="p-6 text-sm text-muted-foreground">
                      No OpenAlex publications to display.
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </SectionCard>
          </>
        ))}
      {profile && (
        <>
          <Dialog open={matchDialog} onOpenChange={setMatchDialog}>
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>
                  {candidate
                    ? "Confirm author match"
                    : "Find author on OpenAlex"}
                </DialogTitle>
                <DialogDescription>
                  {candidate
                    ? "Check the affiliation and research before linking this record."
                    : "Search by name, affiliation or OpenAlex author ID."}
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
                    Your name, biography, links and selected publications will
                    stay as you entered them.
                  </p>
                </div>
              ) : (
                <>
                  <Input
                    aria-label="Search OpenAlex authors"
                    value={matchSearch}
                    onChange={(e) => { setMatchSearch(e.target.value); onSearchAuthors(e.target.value); }}
                    placeholder="Name, affiliation or author ID"
                  />
                  {unavailable ? (
                    <div
                      role="alert"
                      className="space-y-3 rounded-lg border p-4"
                    >
                      <p className="text-sm">
                        OpenAlex search is unavailable. Your profile and current
                        match are unchanged.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSearchAuthors(matchSearch)}
                        disabled={loadingAuthors}
                      >
                        {loadingAuthors && <Spinner />}Try again
                      </Button>
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y rounded-lg border">
                      {matches.map((m) => (
                        <button
                          type="button"
                          key={m.id}
                          className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50"
                          onClick={async () => {
                            setCandidate(m);
                            try { const detail = await readProfileAuthor(m.id); setCandidate(current => current?.id === m.id ? detail : current); }
                            catch { toast.error("Could not load this author’s publications"); }
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
                        <div className={matches.length ? "flex justify-center p-3" : "flex min-h-24 items-center justify-center"}><Spinner aria-label="Searching OpenAlex authors" className="size-5 text-primary" /></div>
                      ) : !matches.length && (
                        <p className="p-5 text-sm text-muted-foreground">
                          {matchSearch.trim() ? "No authors match your search." : "Search for an author by name, affiliation or OpenAlex ID."}
                        </p>
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
                      Back
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
                      Confirm match
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setMatchDialog(false)}
                  >
                    Cancel
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={unlink} onOpenChange={setUnlink}>
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>Unlink OpenAlex author?</DialogTitle>
                <DialogDescription>
                  This removes the imported research from this profile. Your
                  profile details and selected publications remain.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setUnlink(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (!draft) return;
                    setDraft({ ...draft, openalex: "", match: undefined });
                    setUnlink(false);
                  }}
                >
                  Unlink author
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </main>
  );
}
