"use client";

// A screening's form: where its papers come from, the criteria, who reads them, how a paper is
// decided and where the included ones go. A new screening starts from it, and a running or finished
// one is changed with the same form, which says what each change will do before it is saved.

import { ButtonCredits } from "@/components/ui/button-credits";
import { useId, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useConvex } from "convex/react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import useSWR from "swr";
import { FileText, GitCompare, AiIcon, Ban, Hash, Upload, Check, ChevronDown, ChevronRight, CircleHelp, Clock, Coins, Copy, ExternalLink, FileX, Folder, FolderPlus, Highlighter, ListChecks, Lock, Minus, MoreHorizontal, PenLine, Plus, RefreshCw, Search, Trash2, TriangleAlert, Undo2, UserPlus, Users, X, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { ListEmpty, ListLoading, ListRowsSkeleton } from "@/components/evidence-libraries/list-controls";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { LibrarySelect, useLibrarySources, useRowLabel } from "./library-sources";
import { AnimatedNumber, Chip, Meter, SOURCE_ICON } from "./parts";
import { PaperScope, PickMark } from "./source-row";
import { EASE } from "@/components/settings/model-map";
import { LIST, Segmented } from "@/components/settings/parts";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { FadeRow } from "@/components/ui/fade-row";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpFact } from "@/components/ui/help";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showStyledToast } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { useCurrentWorkspace, useWorkspaces, WorkspaceTag } from "@/components/workspaces/parts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useGenerateScreeningCriteria } from "@/lib/ai/client/router";
import { rowKey, screeningQuestionsOf, setOfRow } from "@/lib/evidence-libraries/reader-sources";
import { LIBRARY_COLLECTION_NAME_MAX, fittingCollectionName } from "@/lib/evidence-libraries/source-address";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useWatchedSearch } from "@/lib/research/reads";
import { useSearchList } from "@/lib/research/search-list";
import { useSearchHistoryStore } from "@/lib/store";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import type { SearchResult } from "@/lib/types/search.types";
import { cn } from "@/lib/utils";
import { EVERY_MS, MAX_SOURCES, readersFor } from "@/lib/screening/rules";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace as usePageWorkspace, useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { bringsPdfs, leftOf, leftTotal, personIn, foundTotal, grown, hash, readersOf, GROWS, SHORT_NAME_LENGTH, baseTaken, baseTotal, growing, activeReviewers, defaultRule, defaultScoring, invitedReviewer, modelKey, modelReviewer, modelsOf, paperTotal, peopleOf, personReviewer, shortOf, taken, type Criterion, type Person, type Reviewer, type Screening, type Source, lookOf, inOrder, withTwins, isNamed } from "./data";
import { useSharing } from "./dialogs";
import { draftOf, useKept } from "./drafts";
import { EffectList, JumpLink, NO_PREVIEW, criterionName, effectItems, movesText, pdfsPromised, promisedBy, scoringChanged, widenedBy, type EffectLine, type EffectSection, type EffectsSay, type Move, type Preview } from "./effects";
import { useScreeningsCrumb, overviewHref, papersHref, newHref } from "./links";
import { workspaceHref } from "@/lib/workspaces/paths";
import { CommunityTab, DoiTab, OfferRow, PdfFacts, PdfFiles, UploadTab, ZoteroTab } from "./sources";
import { Faces, youFirst, EmptyNote, ActionBar, BELOW_HEADER, DIVIDED_ROW, Help, kindIcon, LinkChip, Named, Panel, ReviewerMark, ReviewerName, Section, StateChip, StickyColumn, RuleExamples, TONE, MODELS_SAY, INLINE_LINK } from "./pieces";
import { paperCredits, pdfsMissed, pdfsOf, pdfReadingCredits, perPaper, readableBy, readingCredits, takesFiles, unreadPdfs, useOpenScreening } from "./store";
import { AddModel, AddPerson, ConfirmChange } from "./team";
import { useFrame } from "./workspace";
import { useWords, type Words } from "./words";
import { ScrollArea } from "@/components/ui/scroll-area";

// The whole library and its collections are one place to a person, so they share a tab.
type Kind = "search" | "upload" | "collection" | "screening" | "evidenceLibrary" | "zotero" | "dois";
/** This part's messages, and the shared words, for a function that is handed them. */
type T = ReturnType<typeof useTranslations<"screening.form">>;
type Say = { words: Words; t: T; effects: EffectsSay };
const KINDS: Array<{ id: Kind; icon: AppIcon }> = [
  { id: "search", icon: SOURCE_ICON.search },
  // A file follows a search: the two ways most people bring papers. On a phone the row shows its first three or four, and someone who came with a file looks for it there.
  { id: "upload", icon: Upload },
  { id: "collection", icon: SOURCE_ICON.saved },
  { id: "screening", icon: SOURCE_ICON.screening },
  { id: "evidenceLibrary", icon: SOURCE_ICON.evidenceLibrary },
  { id: "zotero", icon: SOURCE_ICON.zotero },
  { id: "dois", icon: Hash },
];
const OFFER_PAGE = 5;
/** Collections one page of the places included papers can go holds. */
const DESTINATION_PAGE = 6;
/** Something a tab offers to add: what the server reads it from, the name its list gave it, and how many papers that list counted. `ref` tells two apart where they share a name. */
type Offer = { ref: string; name: string; detail: string; total: number; set: NonNullable<Source["set"]>; filters?: string[]; questions?: string[] };
/** A list read a page at a time, as its pager needs it. */
/** A saved search as something to add, with the questions its own page screens with. */
const searchOffer = (search: SearchResult): Offer => ({ ref: `search:${search.id}`, name: search.query, detail: "", total: search.count, set: { kind: "search", searchId: search.id }, questions: search.screeningQuestions.map((one) => one.question) });
/** The source an offer becomes when it is added: all of what it holds, until a range is picked. */
const sourceFrom = (offer: Offer): Source => ({ id: `new:${offer.ref}`, kind: offer.set.kind, name: offer.name, detail: offer.detail, total: offer.total, scope: "all", range: [1, Math.max(1, offer.total)], duplicates: 0, set: offer.set, ref: offer.ref, addedAt: Date.now(), ...(offer.filters ? { filters: offer.filters } : {}), ...(offer.questions?.length ? { questions: offer.questions } : {}) });
/** A criterion made from a question as it was written. */
const criterionFrom = (question: string, more: { short?: string; terms?: string[] } = {}): Criterion => ({ key: `new:${hash(question)}`, text: question, short: more.short ?? shortOf(question), must: true, terms: more.terms ?? [], addedAt: Date.now() });

type Pager = { page: number; canPrevious: boolean; canNext: boolean; hasPages: boolean; previous: () => void; next: () => void; offset: number; items: unknown[]; isStale: boolean };

/** What a screening is set up as: a change here is a change to its settings, which a vote is not. */
/** The papers of a source a screening asks for: all of it, or a range of it. */
const scopeOf = (source: Source) => (source.scope === "range" ? source.range.join("-") : "all");
/** The sources a change asks for other papers of. The draft that is kept, the list of unsaved changes and the save all go by this one test. */
const rangedIn = (before: Screening, after: Screening) => after.sources.filter((source) => { const was = before.sources.find((one) => one.id === source.id); return was !== undefined && scopeOf(was) !== scopeOf(source); });
const SETTINGS = ["name", "question", "sources", "criteria", "reviewers", "rule", "scoring", "destination", "living"] as const;
const settingOf = (screening: Screening, field: (typeof SETTINGS)[number]) =>
  JSON.stringify(
    field === "living" ? screening.living?.every
    : field === "reviewers" ? activeReviewers(screening).map((one) => [one.kind === "model" && one.model ? modelKey(one.model) : one.id, one.discarded ?? null])
    : field === "sources" ? screening.sources.map((source) => [source.id, scopeOf(source)])
    : screening[field],
  );
const settingsOf = (screening: Screening) => SETTINGS.map((field) => settingOf(screening, field)).join();

/** A criterion as the server takes it: one the form made has no key there yet. */
const criterionOf = (screening: Screening) => (criterion: Criterion) => {
  const [yes, no, unclear] = screening.scoring.points[criterion.key] ?? [1, 0, 0];
  return { ...(criterion.key.startsWith("new:") ? {} : { key: criterion.key }), text: criterion.text, short: criterion.short, must: criterion.must, ...(criterion.note?.trim() ? { note: criterion.note.trim() } : {}), terms: criterion.terms, points: { yes, no, unclear } };
};
const ruleOf = (screening: Screening, members: Reviewer[]) => ({ each: screening.rule.each === "all" ? ("all" as const) : Number(screening.rule.each), settle: screening.rule.settle, blind: screening.rule.blind, models: screening.rule.models, ...(members.some((one) => one.id === screening.rule.resolver) ? { resolver: screening.rule.resolver as Id<"users"> } : {}) });
/** How long the form waits after the last change to a new screening's sources before the server reads them: a range being dragged, or a second source on its way, is one read and not several. */
const SOURCES_SETTLE_MS = 1_200;
/**
 * The papers a source holds, for the row that takes them all. A Zotero collection added with everything under it
 * holds the papers that were found once it is read. Until then nobody knows how many: Zotero counts what is filed in
 * each collection, where a paper filed in two counts twice, so the row gives no number (null).
 */
const heldBy = (source: Source) => (source.set?.kind === "zotero" && source.set.deep ? (source.read?.state === "done" ? source.read.taken + source.read.duplicates + source.read.left : null) : baseTotal(source));
/** The papers a source's open row shows a sample of: what it brought, or, while it is still read, what its range promises. */
const promised = (source: Source) => (source.read?.state === "waiting" || source.read?.state === "reading" ? Math.max(taken(source), baseTaken(source)) : taken(source));
/** A source the server hasn't read yet, as its row shows it. */
const READING: NonNullable<Source["read"]> = { state: "waiting", read: 0, taken: 0, duplicates: 0, left: 0, bare: 0, filed: 0, filePages: 0 };
const sourceOf = (source: Source) => ({ set: source.set as never, name: source.name, ...(source.detail ? { detail: source.detail } : {}), ...(source.filters?.length && source.kind !== "dois" ? { facts: source.filters } : {}), ...(source.scope === "range" ? { first: source.range[0], last: source.range[1] } : {}) });
const saveToOf = (say: Say, screening: Screening) =>
  screening.destination.kind === "community" && screening.destination.community
    ? screening.destination.community.collection === "new"
      ? { kind: "newLibraryCollection" as const, libraryId: screening.destination.community.libraryId as Id<"evidenceLibraries">, name: communityCollectionName(say, screening), private: screening.destination.community.private, requestId: screening.destination.community.requestId }
      : { kind: "libraryCollection" as const, libraryId: screening.destination.community.libraryId as Id<"evidenceLibraries">, collection: screening.destination.community.collection }
  : screening.destination.kind === "none" ? { kind: "none" as const }
  : screening.destination.kind === "collection" && screening.destination.collection ? { kind: "collection" as const, collectionId: screening.destination.collection as Id<"collections"> }
  : { kind: "new" as const, name: screening.destination.name.trim() || say.words.includedIn(screening.name) };
/** The name a new collection in a community gets: the one typed, else the screening's own, cut to what a community takes. */
const communityCollectionName = ({ words, t }: Say, screening: Screening) => (screening.destination.name.trim() || fittingCollectionName(words.includedIn(screening.name), screening.name.trim() || t("includedPapers"))).slice(0, LIBRARY_COLLECTION_NAME_MAX);
/** The members of the workspace among a screening's people: someone from outside joins by sharing, once it is there to share. */
const membersOf = (screening: Screening) => activeReviewers(screening).filter((one) => one.kind === "person" && !one.guest && !one.email);
const modelOf = (reviewer: Reviewer) => ({ model: reviewer.model!.id, ...(reviewer.model!.effort ? { effort: reviewer.model!.effort } : {}) });

/** A new screening as the server starts it. */
function setupOf(say: Say, draft: Screening) {
  const members = membersOf(draft);
  return {
    name: draft.name,
    ...(draft.question.trim() ? { question: draft.question.trim() } : {}),
    criteria: draft.criteria.map(criterionOf(draft)),
    stars: draft.scoring.stars,
    rule: ruleOf(draft, members),
    sources: draft.sources.map(sourceOf),
    people: members.map((one) => one.id as Id<"users">),
    models: modelsOf(draft).map(modelOf),
    saveTo: saveToOf(say, draft),
    ...(draft.destination.prune ? { prune: true } : {}),
    ...(draft.living ? { living: draft.living.every } : {}),
  };
}

/**
 * What a save changes on a running screening, as the server takes it: only the parts the form changed. The preview
 * of what it does and the save itself are given the same one, so they never differ.
 */
function changeOf(say: Say, saved: Screening, draft: Screening, recheck: boolean) {
  const differs = (field: (typeof SETTINGS)[number]) => settingOf(saved, field) !== settingOf(draft, field);
  const [was, is] = [activeReviewers(saved), activeReviewers(draft)];
  const on = (list: Reviewer[], one: Reviewer) => list.some((other) => other.id === one.id);
  const joining = is.filter((one) => !on(was, one));
  const leaving = was.filter((one) => !on(is, one) && one.row);
  const ranged = rangedIn(saved, draft);
  return {
    ...(differs("name") ? { name: draft.name } : {}),
    ...(differs("question") ? { question: draft.question } : {}),
    ...(differs("criteria") || differs("scoring") ? { criteria: draft.criteria.map(criterionOf(draft)), stars: draft.scoring.stars } : {}),
    ...(differs("rule") ? { rule: ruleOf(draft, membersOf(draft)) } : {}),
    ...(differs("living") ? { living: draft.living?.every ?? null } : {}),
    ...(differs("destination") ? { saveTo: saveToOf(say, draft), prune: draft.destination.prune } : {}),
    ...(draft.sources.some((source) => !saved.sources.some((one) => one.id === source.id)) ? { addSources: draft.sources.filter((source) => !saved.sources.some((one) => one.id === source.id)).map(sourceOf) } : {}),
    ...(saved.sources.some((source) => !draft.sources.some((one) => one.id === source.id)) ? { removeSources: saved.sources.filter((source) => !draft.sources.some((one) => one.id === source.id)).map((source) => source.id as Id<"screeningSources">) } : {}),
    ...(ranged.length ? { ranges: ranged.map((source) => ({ sourceId: source.id as Id<"screeningSources">, ...(source.scope === "range" ? { first: source.range[0], last: source.range[1] } : {}) })) } : {}),
    ...(joining.some((one) => one.kind === "person" && !one.guest && !one.email) ? { addPeople: joining.filter((one) => one.kind === "person" && !one.guest && !one.email).map((one) => one.id as Id<"users">) } : {}),
    ...(joining.some((one) => one.kind === "person" && one.email) ? { inviting: joining.filter((one) => one.kind === "person" && one.email).length } : {}),
    ...(joining.some((one) => one.kind === "model") ? { addModels: joining.filter((one) => one.kind === "model").map(modelOf) } : {}),
    ...(leaving.length ? { remove: leaving.map((one) => ({ reviewerId: one.row!, ...(draft.reviewers.find((now) => now.id === one.id)?.discarded && !one.discarded ? { discard: true } : {}) })) } : {}),
    ...(recheck ? { recheck: true } : {}),
  };
}

/** Where a source can be read as it stands, in a new tab: a search runs again, a collection opens where it lives, a screening opens its included papers. A file or pasted DOIs have nowhere to open. */
function sourceLink(source: Pick<Source, "set">): { href: string; where: "search" | "library" | "collection" | "screening" | "zotero" } | null {
  const set = source.set;
  if (!set) return null;
  if (set.kind === "search") return { href: `/results/${encodeURIComponent(set.searchId)}`, where: "search" };
  if (set.kind === "saved") return { href: "/library", where: "library" };
  if (set.kind === "collection") return { href: `/library?col=${set.collectionId}`, where: "collection" };
  if (set.kind === "screening") return { href: papersHref(set.jobId, { result: "include" }), where: "screening" };
  if (set.kind === "zotero") return { href: "https://www.zotero.org/mylibrary", where: "zotero" };
  return null;
}

/** Stars follow the criteria until someone sets them: a screening with three criteria doesn't give five stars at one point. */
function withCriteria(d: Screening, criteria: Criterion[], points: Screening["scoring"]["points"]): Screening {
  const untouched = JSON.stringify(d.scoring.stars) === JSON.stringify(defaultScoring(d.criteria).stars);
  return { ...d, criteria, scoring: { ...d.scoring, points, ...(untouched ? { stars: defaultScoring(criteria).stars } : {}) } };
}

/** A screening nobody has started: the person making it as its one reviewer, the usual rule, and nothing else yet. */
function blank(me: Person): Screening {
  const now = Date.now();
  return {
    id: "" as Id<"screeningJobs">,
    name: "",
    createdBy: me.id,
    createdAt: now,
    question: "",
    sources: [],
    criteria: [],
    reviewers: [personReviewer(me, now)],
    rule: { ...defaultRule(me.id), each: "1" },
    scoring: defaultScoring([]),
    destination: { kind: "new", name: "", prune: false },
    workspace: { id: "", kind: "personal", name: "" },
    people: { [me.id]: me },
  };
}

/** Each change between the saved screening and the form, named, with the part of the form it is in. */
type Edit = { text: string; section: EffectSection };
function changesOf({ words, t, effects }: Say, before: Screening, after: Screening): Edit[] {
  const parts: Edit[] = [];
  const push = (text: string, section: EffectSection) => parts.push({ text, section });
  // One or two by name, more as a count.
  const named = (list: string[]) => ({ count: list.length, names: words.listed(list.slice(0, 2)) });
  const gone = <T extends { id?: string; key?: string }>(a: T[], b: T[]) => a.filter((x) => !b.some((y) => (y.id ?? y.key) === (x.id ?? x.key)));
  if (before.name !== after.name) push(t("edit.renamed", { name: words.quoted(after.name.trim() || t("untitled")) }), "name");
  if (before.question !== after.question) push(t("edit.question"), "name");
  const [newSources, oldSources] = [gone(after.sources, before.sources), gone(before.sources, after.sources)];
  if (newSources.length) push(t("edit.addedSources", named(newSources.map((source) => source.name))), "papers");
  if (oldSources.length) push(t("edit.removedSources", named(oldSources.map((source) => source.name))), "papers");
  const ranged = rangedIn(before, after);
  if (ranged.length) push(t("edit.rangedSources", named(ranged.map((source) => source.name))), "papers");
  if (Boolean(before.living) !== Boolean(after.living)) push(after.living ? t("edit.madeLiving") : t("edit.stoppedLiving"), "new-papers");
  else if (before.living?.every !== after.living?.every) push(t("edit.livingEvery"), "new-papers");
  const quoted = (list: Criterion[]) => list.map((criterion) => criterionName(effects, criterion));
  const [newCriteria, oldCriteria] = [gone(after.criteria, before.criteria), gone(before.criteria, after.criteria)];
  if (newCriteria.length) push(t("edit.addedCriteria", named(quoted(newCriteria))), "criteria");
  if (oldCriteria.length) push(t("edit.removedCriteria", named(quoted(oldCriteria))), "criteria");
  const reworded = after.criteria.filter((criterion) => { const was = before.criteria.find((one) => one.key === criterion.key); return was && (was.must !== criterion.must || was.text !== criterion.text); });
  if (reworded.length) push(t("edit.changedCriteria", named(quoted(reworded))), "criteria");
  const guided = after.criteria.filter((criterion) => { const was = before.criteria.find((one) => one.key === criterion.key); return was && (was.note ?? "") !== (criterion.note ?? ""); });
  if (guided.length) push(t("edit.guidance", named(quoted(guided))), "criteria");
  // A short name that only followed its reworded question is part of that change, not one of its own.
  const own = (criterion: Criterion) => !isNamed(criterion);
  const renamed = after.criteria.flatMap((criterion) => { const was = before.criteria.find((one) => one.key === criterion.key); return was && was.short !== criterion.short && !(own(was) && own(criterion)) ? [t("edit.renamedOne", { was: words.quoted(was.short), is: words.quoted(criterion.short) })] : []; });
  if (renamed.length) push(t("edit.renamedCriteria", named(renamed)), "criteria");
  if (scoringChanged(before, after)) push(t("edit.scoring"), "criteria");
  const [was, is] = [activeReviewers(before), activeReviewers(after)];
  if (gone(is, was).length) push(t("edit.addedReviewers", named(gone(is, was).map((reviewer) => reviewer.name))), "reviewers");
  if (gone(was, is).length) push(t("edit.removedReviewers", named(gone(was, is).map((reviewer) => reviewer.name))), "reviewers");
  if (JSON.stringify(before.rule) !== JSON.stringify(after.rule)) push(t("edit.rule"), "decided");
  if (JSON.stringify(before.destination) !== JSON.stringify(after.destination)) {
    const renamed = before.destination.kind === "new" && after.destination.kind === "new" && !after.destination.collection;
    const to = words.collectionName(after);
    push(words.collectionName(before) === to ? t("edit.destination") : renamed ? t("edit.collectionRenamed", { name: words.quoted(to ?? "") }) : to !== null ? t("edit.goesTo", { name: to }) : t("edit.goesNowhere"), "goes-to");
  }
  return parts;
}
/** A list with one item put back where it was. */
const insertAt = <T,>(list: T[], at: number, item: T) => [...list.slice(0, at), item, ...list.slice(at)];
/** A list in the saved order, with what is new to it after. */
const inSavedOrder = <T extends { id?: string; key?: string }>(list: T[], saved: T[]) => {
  const idOf = (item: T) => item.id ?? item.key;
  return [...saved.flatMap((one) => list.find((item) => idOf(item) === idOf(one)) ?? []), ...list.filter((item) => !saved.some((one) => idOf(one) === idOf(item)))];
};

// A criterion is one row where the list is wide enough for its question, and wraps under the question where it isn't: the list's own width decides, since the form's column is narrow in a wide window too.
/** The width the short names take in the criteria's rows, and their column's name above them. */
const SHORT_NAME = "w-44 shrink-0 @max-3xl/criteria:ms-5 @max-3xl/criteria:w-auto @max-3xl/criteria:min-w-48 @max-3xl/criteria:flex-1";
/** The room a row's last two controls take, must-have or nice to have and remove, so the column names line up with the fields under them. */
const ROW_END = "flex w-58 shrink-0 items-center justify-end gap-x-3 @max-3xl/criteria:ms-5 @max-3xl/criteria:w-auto";

/**
 * A criterion's short name. What is typed stays here while the field has the keyboard, so an emptied
 * field shows the name the criterion falls back to: its question's own words.
 */
function ShortName({ criterion, n, help, onChange }: { criterion: Criterion; n: number; /** The "?" beside the field's own name, which shows where the column names are hidden. */ help?: ReactNode; onChange: (short: string) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  const t = useTranslations("screening.form");
  const field = useId();
  return (
    <div className={cn(SHORT_NAME, "flex items-center gap-2")}>
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground @3xl/criteria:hidden"><label htmlFor={field}>{t("criteria.shortName")}</label>{/* The other rows keep the "?"'s room, so every field starts in line. */ help ?? <span aria-hidden className="size-5 shrink-0" />}</span>
      <Input
        id={field}
        value={typing ?? criterion.short}
        maxLength={SHORT_NAME_LENGTH}
        placeholder={shortOf(criterion.text)}
        aria-label={t("criteria.shortNameOf", { n })}
        onChange={(event) => { setTyping(event.target.value); onChange(event.target.value.trim() || shortOf(criterion.text)); }}
        onBlur={() => setTyping(null)}
        className="h-8 min-w-0 flex-1 px-2 text-sm"
      />
    </div>
  );
}

export function ScreeningForm({ id }: { id?: string }) {
  const t = useTranslations("screening.form");
  const crumb = useScreeningsCrumb();
  const pieces = useTranslations("screening.pieces");
  const list = useTranslations("screening.list");
  const words = useWords();
  const format = useFormatter();
  const effects = useTranslations("screening.effects");
  const effectsSay = { words, t: effects };
  const say = { words, t, effects: effectsSay };
  const router = useWorkspaceRouter();
  const convex = useConvex();
  const workspaceId = usePageWorkspace();
  const here = useCurrentWorkspace();
  const [from] = useQueryState("from");
  // "Screen all" on a results page opens the form with that search picked and its questions as criteria.
  const [fromSearch] = useQueryState("search");
  // What a community handed over opens the form on it (app/from-library): its source as the person may read it now, and its yes-or-no questions as criteria.
  const [fromHandoff] = useQueryState("handoff");
  const openHandoff = useWorkspaceAction(api.evidenceLibraries.handoffs.open);
  const handedOver = useSWR(!id && fromHandoff && workspaceId ? ["library-handoff", workspaceId, fromHandoff] : null, () => openHandoff({ handoffId: fromHandoff! }), { revalidateOnFocus: false });
  const handed = handedOver.data && !("gone" in handedOver.data) && "row" in handedOver.data.found ? { ...handedOver.data.found, fields: handedOver.data.fields } : null;
  // A hand-off that is gone, or whose source can't be read now, is said so, and nothing is put in its place.
  const handoffProblem = Boolean(fromHandoff) && !id && (Boolean(handedOver.error) || (handedOver.data !== undefined && !handed));
  const rowLabel = useRowLabel();
  // An open screening's settings sit in its frame, which has read it. A new one has no frame.
  const frame = useFrame();
  const saved = id ? frame?.open.screening : undefined;
  const open = id ? frame?.open : undefined;
  // The search is read while the form shows, so the store has it whether the person came from its results or from a link.
  useWatchedSearch(fromSearch ?? undefined);
  const picked = useSearchHistoryStore((state) => (fromSearch ? state.searchHistory.find((item) => item.id === fromSearch) : undefined));
  const copiedRead = useOpenScreening(!id && from ? from : "");
  const copied = !id && from ? (copiedRead?.screening ?? undefined) : undefined;
  // Who is making it, what the workspace has to pay its models with, and a screening whose models would read before this one's.
  const setup = useProtectedQuery(api.screening.view.setup, inWorkspace(workspaceId, {})).data;
  const me = open?.me ?? setup?.me.id ?? "";
  // What the form starts from: the saved screening, a copy of another to run again, or nothing yet.
  // A copy's sources start over: what they hold now is what the new screening starts with, and nothing has come in since.
  const made = useMemo<Screening | null>(() => {
    if (!setup) return null;
    const start = blank(setup.me);
    // Screen all on a results page: the form starts on that search, with the questions its page screens with as criteria. Where the search was written from a question put to the assistant, that question is the screening's, and its name: the words a person asked say more than the query made from them.
    if (!copied && picked) {
      const criteria = searchOffer(picked).questions?.map((question) => criterionFrom(question)) ?? [];
      const asked = picked.latestQuestion?.trim() ?? "";
      return { ...start, name: (asked || picked.query).slice(0, 200), question: asked, sources: [sourceFrom(searchOffer(picked))], criteria, scoring: defaultScoring(criteria) };
    }
    if (!copied && handed) {
      const criteria = screeningQuestionsOf(handed.fields).map((question) => criterionFrom(question));
      const name = rowLabel(handed.row);
      return { ...start, name: name.slice(0, 200), sources: [sourceFrom({ ref: `evidenceLibrary:${rowKey(handed.row)}`, name, detail: t("inLibrary", { name: handed.library.name }), total: handed.row.records, set: setOfRow(handed.row) as Offer["set"] })], criteria, scoring: defaultScoring(criteria) };
    }
    if (!copied) return start;
    // A copy takes the papers the one it copies took: the same part of each source. Whoever votes on that one from outside its workspace is not on the copy: a screening is shared with a guest once it exists (`guestsLeft`).
    const mine = (one: Reviewer) => one.kind === "model" || !one.guest;
    return { ...start, name: t("again", { name: copied.name }), question: copied.question, sources: copied.sources.filter((source) => source.set).map((source) => ({ ...source, id: `new:${source.id}`, read: undefined, updates: undefined, range: (source.scope === "range" ? [Math.min(source.range[0], Math.max(1, source.total)), Math.min(source.range[1], Math.max(1, source.total))] : [1, Math.max(1, source.total)]) as [number, number], duplicates: 0, addedAt: Date.now() })), criteria: copied.criteria, reviewers: activeReviewers(copied).filter(mine).map(({ row: _row, tally: _tally, ...one }) => ({ ...one, id: one.kind === "model" && one.model ? modelKey(one.model) : one.id })), rule: copied.rule, scoring: copied.scoring, destination: { ...copied.destination, name: "" } };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one blank form for each person and each screening it is copied from
  }, [setup?.me.id, copied?.id, picked?.id, handed ? rowKey(handed.row) : null]);
  const origin = saved ?? made;
  // The guests who vote on the screening this one is copied from, by name: they are not on the copy, and the form says how they get on it.
  const guestsLeft = !id && copied ? activeReviewers(copied).filter((one) => one.kind === "person" && one.guest).map((one) => one.name) : [];
  // What isn't saved yet is kept with the tab, so leaving the page and coming back loses nothing.
  // A new screening being filled in is its maker's, in the workspace it was begun in: its files, its searches and what was read of them are that workspace's.
  const key = id ?? `new:${workspaceId ?? ""}:${setup?.me.id ?? ""}:${from ?? ""}:${fromSearch ?? ""}:${fromHandoff ?? ""}`;
  const kept = useKept((store) => store.drafts[key]);
  // A new screening is kept with the workspace it was begun in. Where this workspace's form is still empty and another holds one of theirs, the form points to it: switching workspace never looks like losing it.
  const workspaces = useWorkspaces().list;
  const begun = useKept((store) => store.drafts);
  const elsewhere = id || kept ? undefined : Object.entries(begun).flatMap(([name, held]) => {
    const draft = draftOf(name);
    const row = draft && draft.who === setup?.me.id && draft.workspace !== (workspaceId ?? "") ? workspaces?.find((one) => one.workspaceId === draft.workspace) : undefined;
    return row ? [{ name: held.name.trim(), workspace: row.name, href: workspaceHref(row.kind === "organization" ? row.slug : undefined, newHref(draft!.started)) }] : [];
  })[0];
  const keep = useKept((store) => store.draft);
  // Once it is started, the form shows what was sent until the new screening's page takes its place: the draft is dropped then, and a blank form never shows in between.
  const [sent, setSent] = useState<Screening | null>(null);
  const unnamed = sent ?? kept ?? origin;
  const draft = unnamed ? withTwins(unnamed, words.modelAtEffort) : unnamed;
  // A new screening's sources are read by the server as the form holds them, a moment after the last change to them
  // (convex/screening/screenings.ts `sync`). So each row says what its source holds, what another source already
  // brought and what is left out, as counted by what takes the papers, and starting has nothing left to read.
  const readSources = useWorkspaceMutation(api.screening.screenings.sync);
  // The form's own sources: none until what it starts from has loaded.
  const drafted = draft?.sources ?? [];
  const held = id ? "[]" : JSON.stringify(drafted.map(sourceOf));
  const settled = useDebouncedValue(held, SOURCES_SETTLE_MS);
  const readAhead = useSWR(
    settled === "[]" ? null : ["screening-read-ahead", workspaceId, key, settled],
    async () => {
      const read = await readSources({ ...(useKept.getState().reads[key] ? { draft: useKept.getState().reads[key] as Id<"screeningJobs"> } : {}), sources: JSON.parse(settled) });
      const { [key]: _was, ...others } = useKept.getState().reads;
      useKept.getState().set({ reads: read ? { ...others, [key]: read.jobId } : others });
      return read;
    },
    // Sources that come back to what they were before (a range widened again, a source put back) are read again: the screening that read them then is gone, replaced by the one read since. So what is kept under a key is asked for again whenever the key comes back, and the same sources answer with the same screening.
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  // What was read is of the sources as they are now: after a change, the rows wait for the next read.
  const early = settled === held ? (readAhead.data ?? null) : null;
  const earlyRead = useOpenScreening(early?.jobId ?? "")?.screening.sources;
  /** A source's row on the server, where the server reads it: a running screening's own, or the early read's. */
  const rowOf = (source: Source): { jobId: Id<"screeningJobs">; sourceId: Id<"screeningSources"> } | null => {
    if (id) return saved?.sources.some((one) => one.id === source.id) ? { jobId: saved.id, sourceId: source.id as Id<"screeningSources"> } : null;
    const at = drafted.findIndex((one) => one.id === source.id);
    return early?.sources[at] ? { jobId: early.jobId, sourceId: early.sources[at] } : null;
  };
  /** The sources with how their reading stands. A new screening's wait as "reading" until the early read has them. */
  const sources = id ? drafted : drafted.map((source) => {
    const read = earlyRead?.find((one) => one.id === rowOf(source)?.sourceId)?.read;
    // A file or a pasted list was counted in the browser when it was added. Once the screening has read all of it, its row says what was read: a DOI listed twice is one paper, and the rows then add up to what was found.
    const whole = read?.state === "done" && source.scope === "all" && (source.kind === "upload" || source.kind === "dois" || source.kind === "pdf");
    return { ...source, ...(whole ? { total: read.read, range: [1, read.read] as [number, number] } : {}), read: read ?? READING, duplicates: read?.duplicates ?? 0 };
  });
  // What the last save did, shown under Changes until the next edit.
  const [lastSave, setLastSave] = useState<{ edits: Edit[]; lines: EffectLine[]; moves: Move[] } | null>(null);
  const [discarding, setDiscarding] = useState<Edit[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Why the server wouldn't start it, said in the bar beside the button: a toast would sit over the button itself.
  const [refused, setRefused] = useState<string | null>(null);
  const setDraft = (next: Screening | ((now: Screening) => Screening)) => {
    if (!origin) return;
    setLastSave(null);
    // An edit taken back leaves nothing unsaved: a draft that says what is saved is no draft.
    keep(key, (now) => {
      const made = typeof next === "function" ? next(now ?? origin) : next;
      return saved && settingsOf(saved) === settingsOf(made) ? undefined : made;
    });
  };
  const [kind, setKind] = useState<Kind>(fromHandoff && !id ? "evidenceLibrary" : "search");
  const [find, setFind] = useState("");
  const [recheck, setRecheck] = useState(false);
  // The source whose row is open, and on which part: the papers taken from it, or what it held and left out.
  const [openSource, setOpenSource] = useState<{ id: string; part: "papers" | "left" | "merged" } | null>(null);
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [scoring, setScoring] = useState(false);

  // What can be added, a page of each at a time. Every kind is read up front, so switching between them moves nothing.
  const typed = useDebouncedValue(find.trim(), 300);
  const searches = useSearchList({ sort: "recent", pageSize: OFFER_PAGE, text: kind === "search" ? typed : "" });
  const collections = useCursorPage(api.library.collections.listCollections, inWorkspace(workspaceId, {}), OFFER_PAGE);
  const savedCount = useProtectedQuery(api.library.queries.getLibraryCount, inWorkspace(workspaceId, {})).data;
  // The workspace's newest screenings, whose criteria can be copied.
  const screenings = useCursorPage(api.screening.view.list, inWorkspace(workspaceId, { show: "all" as const, sort: "newest" as const }), OFFER_PAGE);
  // The ones that have included a paper, a page at a time, for the Screening tab: the server pages only those, so a page never comes back empty with more behind it.
  const withIncluded = useCursorPage(api.screening.view.list, inWorkspace(workspaceId, { show: "all" as const, sort: "newest" as const, included: true as const, ...(kind === "screening" && typed ? { text: typed } : {}) }), OFFER_PAGE);
  const destinations = useCursorPage(api.library.collections.listCollections, inWorkspace(workspaceId, {}), DESTINATION_PAGE);
  // The communities the person reads in, with their collections there: where included papers can go beside their own library.
  const communities = useLibrarySources();
  const create = useWorkspaceAction(api.screening.screenings.create);
  const saveChange = useWorkspaceMutation(api.screening.settings.save);
  const readSourceAgain = useWorkspaceMutation(api.screening.living.readSourceAgain);
  const saveToCommunity = useWorkspaceAction(api.screening.settings.saveToCommunity);
  const previewChange = useWorkspaceAction(api.screening.effects.preview);
  const { execute: writeQuestions, credits: writeCredits } = useGenerateScreeningCriteria();
  const share = useSharing((saved?.id ?? "") as Id<"screeningJobs">);
  const give = useWorkspaceMutation(api.sharing.guests.add);
  const invite = useWorkspaceAction(api.sharing.invitations.invite);
  // What one PDF's first reading cost when it was added (./sources.tsx says the same before any is).
  // Read up front for the Upload tab too, whose line about it is then there when the tab opens.
  const lookCredits = useProtectedQuery(api.screening.held.pdfLook, inWorkspace(workspaceId, {})).data;

  // What a save would do to a running screening, counted by the server for the change as it stands: the lines and the moves both read it.
  const change = saved && draft ? changeOf(say, saved, draft, recheck) : null;
  const changing = change && Object.keys(change).length > 0 ? JSON.stringify(change) : null;
  const counted = useSWR(saved && changing && workspaceId ? ["screening-preview", saved.id, changing] : null, () => previewChange({ jobId: saved!.id, change: change! }), { revalidateOnFocus: false });
  // Until the server has counted the change as it now stands, nothing it would do is known: no figure from an earlier change stands in.
  const known = !changing || counted.data !== undefined || Boolean(counted.error);
  const preview: Preview = (changing ? counted.data : undefined) ?? NO_PREVIEW;
  // While the server counts a change, what it would do isn't known: the save waits for it.
  const counting = Boolean(changing) && (counted.isLoading || counted.isValidating) && !counted.error;

  // A new form waits for whoever makes it, and a screening that is gone, or not shared with the person, is said by the frame its settings open in.
  if (!draft || !origin || (id && !saved)) return id ? null : <ListLoading label={t("loading")} />;

  // Its workspace's members change it. The frame has no Settings tab for anyone else, and the address alone says why.
  if (saved && !open?.canChange) {
    return (
      <ListEmpty icon={Lock} action={<Button asChild variant="outline" size="sm"><NextLink href={overviewHref(saved.id)}>{t("goToOverview")}<ChevronRight /></NextLink></Button>}>
        {t("onlyMembers", { workspace: saved.workspace.name, personal: String(saved.workspace.kind === "personal") })}
      </ListEmpty>
    );
  }

  const fresh = !saved;
  // A new screening is made in the workspace you are in.
  const workspace = saved ? saved.workspace : { name: here?.name ?? t("thisWorkspace") };
  // The credits its models are paid from: its own workspace's.
  const wallet = open?.wallet ?? setup?.credits ?? 0;
  // The workspace's models read so many papers at once: a screening started while another's are reading waits its turn.
  const ahead_ = fresh ? setup?.reading : undefined;
  const set = (patch: Partial<Screening>) => setDraft((d) => ({ ...d, ...patch }));
  const people = peopleOf(draft);
  // Someone invited by email reads papers once they have joined.
  const { people: joined, each } = readersOf(draft);
  // Who the rule can put on a paper: the people on it and the ones invited by email.
  const readers = draft.reviewers.filter((one) => !one.left && one.kind === "person").length;
  const models = modelsOf(draft);
  // What a wider range of a source promises is found as much as it is to screen: counted in both, so what was merged is never under what it was.
  const found = foundTotal(sources) + (saved ? widenedBy(saved, draft) : 0);
  // What its sources hold, and what a wider range of one of them promises on top: nobody knows how many of those are new until the source is read again.
  const papers = paperTotal(sources) + (saved ? widenedBy(saved, draft) : 0);
  const pdfs = pdfsOf(sources);
  // A running screening's new sources aren't read until the save: what they promise is the most they can bring, and every figure that counts them says "up to".
  const promisedNew = saved ? promisedBy(saved, draft) : 0;
  const upTo = Boolean(promisedNew);
  // Some of those can come as their PDF, which costs by the page: the figures count each as a paper with an abstract, and the cost says what they leave out.
  const pdfsUnpriced = Boolean(saved && pdfsPromised(saved, draft));
  // What each person reads. A new screening shares all of it out evenly. A running one says what a save would leave each person with: settled papers take nobody new, so the loads can differ.
  const shareSays = (() => {
    if (!joined.length) return undefined;
    // Shared out among everyone the rule counts, people invited by email among them.
    if (fresh && readers === 1) return t("share.readsAll", { you: String(joined[0]!.id === me), name: words.firstName(joined[0]!.name) });
    if (fresh) return t("share.about", { more: "false", count: Math.ceil((papers * each) / readers) });
    const loads = preview.loads ?? (() => { const dealt = joined.map((person) => person.tally?.dealt ?? 0); return { least: Math.min(...dealt), most: Math.max(...dealt) }; })();
    const more = String(Boolean(promisedNew));
    return loads.most - loads.least <= 2 ? t("share.about", { more, count: loads.most }) : t("share.range", { more, least: words.num(loads.least), most: words.num(loads.most) });
  })();
  // The papers each model has still to read: all of them for a new screening, and for a running one the ones still open that it hasn't got to.
  const ahead = (model: Reviewer) => (fresh ? readableBy(model.model!, papers, pdfs) : (preview.models[model.id]?.ahead ?? preview.joining[model.id]?.reads ?? model.tally?.waiting ?? 0) + promisedNew);
  const due = (model: Reviewer) => readingCredits(model.model!, ahead(model), pdfs);
  // A model on it with nothing left to read that it can read: never while the change is counted, never one that is given no PDF it can't read, and never one only being added, which the lines under Changes speak for.
  // Never before the model has been given its papers: just after a save that adds it, it has none yet, and nothing read.
  const allRead = (model: Reviewer) => known && !fresh && papers > 0 && (model.tally?.dealt ?? 0) > 0 && !due(model) && !pdfsMissed(model.model!, pdfs).papers && Boolean(saved?.reviewers.some((one) => one.id === model.id && !one.left));
  // How much of what the models still cost is the papers they are sent as PDFs: said beside the PDFs' pages, where a price a paper times the papers falls short of the total.
  const pdfCost = models.reduce((sum, model) => sum + pdfReadingCredits(model.model!, ahead(model), pdfs), 0);
  // What a save has each model read at once, and pay for: a criterion added to a running screening is answered on the open papers it has read, and a check of the settled papers opens some it had passed over.
  const added = Boolean(saved && draft.criteria.some((criterion) => !saved.criteria.some((one) => one.key === criterion.key)));
  const atOnce = (model: Reviewer) => (saved ? readingCredits(model.model!, preview.models[model.id]?.atOnce ?? 0, pdfs) : 0);
  const reread = models.reduce((sum, model) => sum + atOnce(model), 0);
  // How many settled papers the change would move if they were checked again. They keep their result unless that is asked for.
  const again = saved ? preview.again : 0;
  const cost = models.reduce((sum, model) => sum + due(model), 0) + reread;
  const perNew = models.reduce((sum, model) => sum + paperCredits(model.model!), 0);
  // A new paper from Zotero can come as its PDF, which a model is sent whole: the price of a new paper says so.
  const pdfsCome = bringsPdfs(growing(draft)) && models.some((model) => takesFiles(model.model!));
  // What keeps its models from reading now: a model added here starts once that is over, and the line says so.
  const heldNow = open?.modelsNow ?? null;
  const lines = saved && changing && known ? effectItems(effectsSay, saved, draft, preview, { me, wallet, waiting: heldNow === "waiting", ...(open ? { openNow: open.counts.waiting + open.counts.conflict } : {}) }) : [];
  const moves = saved && changing && known ? preview.moves : [];
  // A model answers criteria: with none it would include every paper it reads.
  const needsCriteria = models.length > 0 && draft.criteria.length === 0;
  const lastCheck = open?.latest ?? null;
  // What its models have cost so far.
  const spentSoFar = saved ? saved.reviewers.reduce((sum, reviewer) => sum + (reviewer.tally?.spent ?? 0), 0) : 0;
  const edits = saved ? changesOf(say, saved, draft) : [];
  const dirty = edits.length > 0;
  // Paused models read nothing until someone resumes them: their rows and the cost say so.
  const paused = Boolean(saved?.paused && !saved.finishedAt && models.length);
  const unsaved = t("unsaved", { count: edits.length });
  const moved = moves.reduce((sum, move) => sum + move.count - move.hidden, 0);
  // Beside a part's title while it holds an edit that isn't saved.
  const changed = (...sections: EffectSection[]) => (edits.some((edit) => sections.includes(edit.section)) ? <StateChip tone="warning" icon={PenLine} className="ms-1.5 h-5 px-1.5">{t("changed")}</StateChip> : null);
  // A criterion whose question was deleted asks nothing, and leaves its short name no words to fall back to.
  const unasked = draft.criteria.some((criterion) => !criterion.text.trim()) ? { text: t("block.emptyCriterion"), section: "criteria" as const, focus: "#criteria textarea[aria-invalid=true]" } : null;
  // What it has to be able to pay for now: all its reading to start, and for a running screening only what the save itself has the models read. What is left to read is paid for as it is read, and stops where the credits do.
  const owed = saved ? reread : cost;
  // What its plan lets one screening hold: papers, and models reading them.
  const overPapers = setup?.limits.papers !== undefined && setup.limits.papers !== null && papers > setup.limits.papers ? setup.limits.papers : null;
  const overModels = setup && models.length > setup.limits.models ? setup.limits.models : null;
  // Papers that are only a PDF none of its reviewers can read: they would wait for a vote nobody casts.
  const orphaned = unreadPdfs({ reviewers: draft.reviewers, sources });
  // What neither starting nor saving can do yet, and the control that fixes it: the reason opens its section and puts the cursor there.
  const lacking: Block | null = unasked ?? (needsCriteria ? { text: t("block.needsCriterion", { many: String(models.length > 1) }), section: "criteria", focus: "#new-criterion" } : overPapers !== null ? { text: t("block.overPapers", { count: overPapers, workspace: workspace.name, personal: String((saved?.workspace.kind ?? here?.kind) !== "organization") }), section: "papers" } : overModels !== null ? { text: t("block.overModels", { count: overModels }), section: "reviewers" } : orphaned ? { text: t("block.orphaned", { many: String(models.length > 1), count: orphaned }), section: "reviewers", focus: "#add-person" } : owed > wallet && fresh ? { text: t("block.creditsShort", { credits: words.credits(owed - wallet) }) } : null);
  const holdUp = saved ? lacking : null;
  // How many votes each reviewer has cast: what a row's chips open.
  const votesOf = (reviewer: Reviewer) => reviewer.tally?.cast ?? 0;
  const wasOn = (reviewer: Reviewer) => Boolean(saved?.reviewers.some((one) => one.id === reviewer.id && !one.left));
  // The papers a model got to and couldn't read: it has read everything else.
  const unreadBy = (reviewer: Reviewer) => reviewer.tally?.failed ?? 0;
  const unreadText = (count: number) => t("unread", { count });
  // A new screening's sources are still being read: every count of its papers is of what has been read so far, and says so.
  const reading = fresh && sources.some((source) => source.read?.state === "waiting" || source.read?.state === "reading");
  const soFar = String(reading);
  // The PDFs it was handed, each read once as it was added, which the workspace paid for then.
  const handedPdfs = fresh ? sources.reduce((sum, source) => sum + (source.set?.kind === "pdf" ? baseTotal(source) : 0), 0) : 0;
  // Why it can't start yet: it needs papers and a reviewer first. While a source is still being read nobody knows how many papers it starts with, or what its models will cost: it starts once they are all read.
  const stop: Block | null = !papers || reading
    ? { text: reading ? t("block.reading") : t("block.addPapers"), section: "papers", focus: "#add-papers [role=tab][data-state=active]" }
    : !activeReviewers(draft).length
      ? { text: t("block.addReviewer"), section: "reviewers", focus: "#add-person" }
      : lacking;

  // A source is what the server reads it from (`set`), under the name its list gave it. What it holds is what the list counted; what it leaves out and what another source already has are known once it is read.
  const addSource = (offer: Offer) =>
    setDraft((d) => {
      if (d.sources.some((source) => source.ref === offer.ref)) return d;
      return { ...d, sources: [...d.sources, sourceFrom(offer)] };
    });
  // A source picked from a list opens to which of its papers are taken.
  const pick = (offer: Offer) => {
    if (offer.total > 1) setOpenSource({ id: `new:${offer.ref}`, part: "papers" });
    addSource(offer);
  };
  const patchSource = (sourceId: string, patch: Partial<Source> | ((source: Source) => Partial<Source>)) =>
    setDraft((d) => ({ ...d, sources: d.sources.map((source) => (source.id === sourceId ? { ...source, ...(typeof patch === "function" ? patch(source) : patch) } : source)) }));

  // A criterion decides unless it is marked as nice to have: an inclusion criterion that excludes nothing is a surprise.
  const addCriterion = (question: string, more: { short?: string; terms?: string[] } = {}) =>
    setDraft((d) => {
      const clean = question.trim();
      if (!clean || d.criteria.some((criterion) => criterion.text.toLowerCase() === clean.toLowerCase())) return d;
      const made = criterionFrom(clean, more);
      return withCriteria(d, [...d.criteria, made], { ...d.scoring.points, [made.key]: [1, 0, 0] });
    });
  // A patch can be worked out from the criterion as it stands when it applies, never from an earlier render: two keystrokes before a render must not read the first's.
  const patchCriterion = (criterionKey: string, patch: Partial<Criterion> | ((now: Criterion) => Partial<Criterion>)) => setDraft((d) => ({ ...d, criteria: d.criteria.map((criterion) => (criterion.key === criterionKey ? { ...criterion, ...(typeof patch === "function" ? patch(criterion) : patch) } : criterion)) }));
  // Another screening's criteria are read when they are asked for, and added to the ones here with their points.
  const copyCriteria = async (one: { id: Id<"screeningJobs"> }) => {
    if (!workspaceId) return;
    const other = await convex.query(api.screening.view.get, { workspaceId, jobId: one.id });
    if (!other) return;
    setDraft((d) => {
      const mine = other.criteria.filter((criterion) => !d.criteria.some((own) => own.text === criterion.text));
      return withCriteria(d, [...d.criteria, ...mine.map(({ key: theirs, text: question, short, must, note, terms }) => ({ key: `new:${hash(question)}:${theirs}`, text: question, short, must, terms, addedAt: Date.now(), ...(note ? { note } : {}) }))], { ...Object.fromEntries(mine.map((criterion) => [`new:${hash(criterion.text)}:${criterion.key}`, [criterion.points.yes, criterion.points.no, criterion.points.unclear] as [number, number, number]])), ...d.scoring.points });
    });
  };
  const shortNameHelp = <Help title={t("criteria.shortName")} facts={<HelpFact>{t("criteria.shortNameMax", { count: SHORT_NAME_LENGTH })}</HelpFact>}>{t("criteria.shortNameHelp")}</Help>;
  const copyable = screenings.items.filter((one) => one.id !== id && one.criteria > 0).slice(0, 8);
  const cantWrite = !draft.question.trim() ? t("criteria.needQuestion") : null;
  // A model writes yes-or-no criteria from the research question, each with a short name and the words to mark for whoever votes.
  const writeCriteria = async () => {
    setWriting(true);
    try {
      const written = await writeQuestions({ researchQuestion: draft.question, existingQuestions: draft.criteria.map((criterion) => criterion.text) });
      written.criteria.forEach((one) => addCriterion(one.text, { short: one.short, terms: one.terms }));
      if (!written.criteria.length) toast(t("toast.nothingWritten"));
    } catch (error) {
      showStyledToast("error", getErrorMessage(error, t("toast.notWritten")));
    } finally {
      setWriting(false);
    }
  };

  const addReviewer = (reviewer: Reviewer) =>
    setDraft((d) => {
      // Someone put back on keeps the votes they cast and their place in the reading. A model whose votes were thrown out starts its reading over.
      const back = d.reviewers.find((one) => one.id === reviewer.id || (one.kind === "model" && reviewer.kind === "model" && one.model && reviewer.model && modelKey(one.model) === modelKey(reviewer.model)));
      const reviewers = back ? d.reviewers.map((one) => (one === back ? { ...one, left: undefined } : one)) : [...d.reviewers, { ...reviewer, addedAt: fresh ? d.createdAt : Date.now() }];
      // Someone invited by email counts: the rule waits for them as for anyone on it.
      const here_ = reviewers.filter((one) => !one.left && one.kind === "person").length;
      return {
        ...d,
        reviewers,
        // A reviewer is no longer someone it is only shared with to look at.
        viewers: d.viewers?.filter((one) => one.id !== reviewer.id),
        // Two people on every paper is how a review is usually screened: a new screening takes that up when its second person is added.
        ...(fresh && reviewer.kind === "person" && here_ === 2 && d.rule.each === "1" && d.rule.settle !== "one" ? { rule: { ...d.rule, each: "2" as const } } : {}),
      };
    });
  // On a running screening a removed reviewer, source or criterion stays in its list until the save, struck through, with Keep to put it back.
  // On a new one it goes at once, and the toast can put it back where it was.
  const undoable = (what: string, back: () => void) => toast(t("toast.removed", { name: what }), { action: { label: t("toast.undo"), onClick: back } });
  const removeReviewer = (reviewer: Reviewer) => {
    const at = draft.reviewers.findIndex((one) => one.id === reviewer.id);
    const resolver = draft.rule.resolver;
    setDraft((d) => {
      const kept_ = saved?.reviewers.some((one) => one.id === reviewer.id) ? d.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: Date.now() } : one)) : d.reviewers.filter((one) => one.id !== reviewer.id);
      const left = kept_.filter((one) => !one.left && one.kind === "person" && !one.email);
      return { ...d, reviewers: kept_, rule: { ...d.rule, resolver: left.some((one) => one.id === d.rule.resolver) ? d.rule.resolver : (left[0]?.id ?? d.createdBy) } };
    });
    if (!wasOn(reviewer)) undoable(reviewer.name, () => setDraft((d) => ({ ...d, reviewers: insertAt(d.reviewers, at, reviewer), rule: { ...d.rule, resolver } })));
  };
  // A reviewer kept on settles conflicts again if they did before.
  const keepReviewer = (reviewer: Reviewer) => setDraft((d) => ({ ...d, reviewers: d.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: undefined, discarded: saved?.reviewers.find((was) => was.id === one.id)?.discarded } : one)), rule: saved?.rule.resolver === reviewer.id ? { ...d.rule, resolver: reviewer.id } : d.rule }));
  const removeSource = (source: Source) => {
    const at = draft.sources.findIndex((one) => one.id === source.id);
    setDraft((d) => ({ ...d, sources: d.sources.filter((one) => one.id !== source.id) }));
    if (!saved?.sources.some((one) => one.id === source.id)) undoable(source.name, () => setDraft((d) => ({ ...d, sources: insertAt(d.sources, at, source) })));
  };
  const keepSource = (source: Source) => setDraft((d) => ({ ...d, sources: inSavedOrder([...d.sources, source], saved?.sources ?? []) }));
  const removeCriterion = (criterion: Criterion) => {
    const at = draft.criteria.findIndex((one) => one.key === criterion.key);
    const points = draft.scoring.points[criterion.key] ?? [1, 0, 0];
    setDraft((d) => withCriteria(d, d.criteria.filter((one) => one.key !== criterion.key), d.scoring.points));
    if (!saved?.criteria.some((one) => one.key === criterion.key)) undoable(criterionName(effectsSay, criterion), () => setDraft((d) => withCriteria(d, insertAt(d.criteria, at, criterion), { ...d.scoring.points, [criterion.key]: points })));
  };
  const keepCriterion = (criterion: Criterion) => setDraft((d) => withCriteria(d, inSavedOrder([...d.criteria, criterion], saved?.criteria ?? []), { ...d.scoring.points, [criterion.key]: saved?.scoring.points[criterion.key] ?? [1, 0, 0] }));
  // What each list shows: on a running screening, what saving would remove stays in its place.
  const sourceRows = saved ? inSavedOrder([...draft.sources, ...saved.sources.filter((one) => !draft.sources.some((source) => source.id === one.id))], saved.sources).map((source) => ({ source, gone: !draft.sources.some((one) => one.id === source.id) })) : sources.map((source) => ({ source, gone: false }));
  const criterionRows = saved ? inSavedOrder([...draft.criteria, ...saved.criteria.filter((one) => !draft.criteria.some((criterion) => criterion.key === one.key))], saved.criteria).map((criterion) => ({ criterion, gone: !draft.criteria.some((one) => one.key === criterion.key) })) : draft.criteria.map((criterion) => ({ criterion, gone: false }));
  const reviewerRows = draft.reviewers.filter((reviewer) => !reviewer.left || wasOn(reviewer)).map((reviewer) => ({ reviewer, gone: Boolean(reviewer.left) }));

  const failed = (error: unknown) => showStyledToast("error", getErrorMessage(error, t("toast.failed")));
  const start = async () => {
    if (busy) return;
    setBusy(true);
    setRefused(null);
    const name = draft.name.trim() || draft.sources[0]?.name || t("untitled");
    try {
      const { jobId } = await create({ ...setupOf(say, { ...draft, name }), ...(early ? { draft: early.jobId } : {}) });
      // People from outside the workspace are given it, or invited to it, once it is there to share: to vote, or to look.
      const outside = [...activeReviewers(draft).filter((one) => one.kind === "person" && one.guest).map((one) => ({ one, role: "editor" as const })), ...(draft.viewers ?? []).map((one) => ({ one, role: "viewer" as const }))];
      const sent = await Promise.allSettled(outside.map(({ one, role }) => (one.email ? invite({ kind: "screening", id: jobId, email: one.email, role }) : give({ kind: "screening", id: jobId, personId: one.id as Id<"users">, role }))));
      if (sent.some((one) => one.status === "rejected")) showStyledToast("error", t("toast.notAdded"));
      flushSync(() => setSent(draft));
      keep(key, () => undefined);
      // The new screening takes the form's place in the history: Back from it returns to the list, not to a form already sent.
      router.replace(overviewHref(jobId));
    } catch (error) {
      setRefused(getErrorMessage(error, t("toast.notStarted")));
      setBusy(false);
    }
  };
  const save = async () => {
    if (!saved || !id || !change || busy || counting) return;
    setBusy(true);
    try {
      // People from outside the workspace join by sharing: a reviewer as a guest who votes.
      const outside = activeReviewers(draft).filter((one) => one.kind === "person" && one.guest && !saved.reviewers.some((was) => was.id === one.id && !was.left));
      // Sent before the save, so the papers it settles wait for whoever is invited (lib/screening/project.ts).
      await Promise.allSettled(outside.map((one) => (one.email ? share.invite(one.email) : share.give(one.id as Id<"users">))));
      // A community's collection is checked, or made, there before the save.
      if (change.saveTo?.kind === "libraryCollection" || change.saveTo?.kind === "newLibraryCollection") await saveToCommunity({ jobId: saved.id, change });
      else await saveChange({ jobId: saved.id, change });
      // The page stays where it is: Changes keeps what the save did until the next edit.
      setLastSave({ edits, lines, moves });
      setRecheck(false);
      keep(key, () => undefined);
      // What the save did to the papers is said with it, so a count that changed elsewhere is no surprise.
      toast(t("toast.saved"), { description: moves.length ? movesText(effectsSay, moves) : undefined, action: <NextLink data-button href={overviewHref(id)}>{t("goToOverview")}</NextLink> });
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  };
  const discard = () => {
    const was = kept;
    setRecheck(false);
    keep(key, () => undefined);
    toast(t("toast.discarded"), { action: { label: t("toast.undo"), onClick: () => keep(key, () => was) } });
  };

  // What each tab offers, a page at a time: the workspace's saved searches, its library and collections, and the included papers of its other screenings.
  const taken_ = (ref: string) => draft.sources.some((source) => source.ref === ref);
  const offered: { rows: Offer[]; pager?: Pager; loading: boolean } =
    kind === "search"
      ? { rows: [...(picked && searches.page === 1 && !typed ? [searchOffer(picked)] : []), ...searches.items.filter((search) => search.id !== picked?.id).map(searchOffer)], pager: searches, loading: searches.isLoading }
      : kind === "collection"
        ? { rows: [...(collections.page === 1 ? [{ ref: "saved", name: t("offer.allSaved"), detail: t("offer.library"), total: savedCount ?? 0, set: { kind: "saved" as const } }] : []), ...collections.items.map((one) => ({ ref: `collection:${one._id}`, name: one.name, detail: "", total: one.itemCount, set: { kind: "collection" as const, collectionId: one._id } }))], pager: collections, loading: collections.isLoading || savedCount === undefined }
        : { rows: withIncluded.items.filter((one) => one.id !== id).map((one) => ({ ref: `screening:${one.id}`, name: words.includedIn(one.name), detail: one.finishedAt ? t("offer.finished") : t("offer.running"), total: one.counts.include, set: { kind: "screening" as const, jobId: one.id } })), pager: withIncluded, loading: withIncluded.isLoading };
  const importable = draft.sources.flatMap((source) => (source.questions ?? []).filter((question) => !draft.criteria.some((criterion) => criterion.text === question)).map((question) => ({ question, source })));
  const importSearches = new Set(importable.map(({ source }) => source.id)).size;
  const suggested = draft.name || draft.sources[0] ? words.includedIn(draft.name || draft.sources[0]!.name) : t("includedPapers");
  // A started screening's own collection already holds what it has included: it is a collection like the others, which can be renamed.
  const ownCollection = saved?.destination.kind === "new" || saved?.destination.kind === "collection" ? saved.destination : null;
  const onOwn = Boolean(ownCollection) && draft.destination.kind === ownCollection?.kind && draft.destination.collection === ownCollection?.collection;
  // The name of the collection picked, under its row: a new one is named.
  const nameField = (label: string, placeholder: string) => (
    <div className="flex flex-col gap-1.5 px-4 pb-3 ps-11">
      <label htmlFor="collection-name" className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input id="collection-name" value={draft.destination.name} onChange={(event) => set({ destination: { ...draft.destination, name: event.target.value } })} placeholder={placeholder} className="h-9 max-w-md bg-card text-sm" />
    </div>
  );
  const another = { ...draft.destination, kind: "new" as const, name: "", collection: undefined };
  const onAnother = draft.destination.kind === "new" && !onOwn;
  // Every place the included papers can go, all at once: its own collection or a new one first, the ones there are, and nowhere last.
  const places = [
    ...(ownCollection ? [<Destination key="own" on={onOwn} onPick={() => set({ destination: { ...ownCollection, prune: draft.destination.prune } })} icon={Folder} name={words.collectionName(saved!) ?? t("goes.itsCollection")} facts={<Chip>{words.count("papers", open?.counts.include ?? 0)}</Chip>} />] : []),
    <Destination key="new" on={onAnother} onPick={() => { if (!onAnother) set({ destination: another }); }} icon={FolderPlus} name={t("goes.newCollection")} below={onAnother ? nameField(t("goes.collectionName"), suggested) : null} />,
    // The workspace's collections are read after the page: two rows hold their place, and the list slides to its length.
    ...(destinations.isLoading ? [<ListRowsSkeleton key="loading" rows={2} height={57} label={t("papers.loadingList")} />] : []),
    ...destinations.items.filter((collection) => collection._id !== ownCollection?.collection).map((collection) => (
      <Destination key={collection._id} on={draft.destination.collection === collection._id} onPick={() => set({ destination: { ...draft.destination, kind: "collection", name: collection.name, collection: collection._id } })} icon={Folder} name={t("goes.addTo", { name: collection.name })} facts={<Chip>{words.count("papers", collection.itemCount)}</Chip>} />
    )),
    <Destination key="none" on={draft.destination.kind === "none"} onPick={() => set({ destination: { ...draft.destination, kind: "none", collection: undefined } })} icon={Ban} name={t("goes.nowhere")} facts={<Chip>{t("goes.kept")}</Chip>} />,
  ];
  const fromCollection = draft.sources.find((source) => source.kind === "collection");
  // In a community: one of the person's collections there that they can change, or a new one of theirs.
  const there = draft.destination.kind === "community" ? draft.destination.community : undefined;
  const community = communities.libraries.find((one) => one.libraryId === there?.libraryId) ?? communities.libraries[0];
  const toCommunity = (libraryId: string, collection = "new", name = "") => set({ destination: { ...draft.destination, kind: "community", name, collection: undefined, community: { libraryId, collection, private: there?.private ?? true, requestId: there?.requestId || crypto.randomUUID() } } });
  const toOwn = () => set({ destination: ownCollection ? { ...ownCollection, prune: draft.destination.prune } : { kind: "new", name: "", prune: draft.destination.prune } });
  const theirs = (communities.contents.find((one) => one.libraryId === community?.libraryId)?.rows ?? []).filter((row) => (row.what === "yours" || (row.what !== "library" && row.access === "editor")) && "readerCollection" in row.source && row.source.readerCollection);
  const communityPlaces = community ? [
    <Destination
      key="new"
      on={there?.collection === "new"}
      onPick={() => { if (there?.collection !== "new") toCommunity(community.libraryId); }}
      icon={FolderPlus}
      name={t("goes.newCollection")}
      below={there?.collection === "new" ? (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 px-4 pb-3 ps-11">
          <div className="flex min-w-48 max-w-md flex-1 flex-col gap-1.5">
            <label htmlFor="community-collection-name" className="text-xs font-medium text-muted-foreground">{t("goes.collectionName")}</label>
            <Input id="community-collection-name" value={draft.destination.name} maxLength={LIBRARY_COLLECTION_NAME_MAX} onChange={(event) => set({ destination: { ...draft.destination, name: event.target.value } })} placeholder={communityCollectionName(say, { ...draft, destination: { ...draft.destination, name: "" } })} className="h-9 bg-card text-sm" />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm">
            <Lock className="size-3.5 text-muted-foreground" />
            {t("goes.private")}
            <Switch checked={there.private} onCheckedChange={(next) => set({ destination: { ...draft.destination, community: { ...there, private: next } } })} aria-label={t("goes.keepPrivate")} />
          </label>
        </div>
      ) : null}
    />,
    ...theirs.map((row) => {
      const collection = "readerCollection" in row.source ? (row.source.readerCollection ?? "") : "";
      return <Destination key={collection} on={there?.collection === collection} onPick={() => toCommunity(community.libraryId, collection, row.label)} icon={row.private ? Lock : Folder} name={t("goes.addTo", { name: row.label })} facts={<Chip>{words.count("papers", row.records)}</Chip>} />;
    }),
    // One it was sent to that the community no longer lists among the first, or that is its own already.
    ...(there && there.collection !== "new" && !theirs.some((row) => "readerCollection" in row.source && row.source.readerCollection === there.collection) ? [<Destination key={there.collection} on onPick={() => {}} icon={Folder} name={draft.destination.name ? t("goes.addTo", { name: draft.destination.name }) : t("goes.addToIts")} />] : []),
  ] : [];

  // The summary beside the form: one line for each part, which opens it.
  const resolver = joined.find((person) => person.id === draft.rule.resolver) ?? joined[0];
  const destinationName = draft.destination.kind === "none" ? t("goes.nowhere") : draft.destination.kind === "new" && !draft.destination.name && !draft.name ? t("goes.newCollection") : (words.collectionName(draft) ?? t("goes.aCollection"));
  const musts = draft.criteria.filter((criterion) => criterion.must).length;
  const reviewersNow = inOrder(activeReviewers(draft), me);
  // Who reviews it, counted: people, those invited and not joined yet, and models.
  const whoCounts = [joined.length ? words.count("people", joined.length) : "", people.length > joined.length ? t("summary.invited", { count: people.length - joined.length }) : "", models.length ? words.count("models", models.length) : ""].filter(Boolean);
  // `unset`: a part left empty that the screening can start without. It gets no tick, which would read as done.
  const summary: Array<{ id: string; label: string; value: string; problem: boolean; unset?: boolean; aside?: ReactNode }> = [
    { id: "papers", label: t("part.papers"), value: papers ? t("summary.papers", { state: upTo ? "upTo" : reading ? "soFar" : "none", papers, sources: draft.sources.length }) : reading ? t("block.reading") : t("summary.noPapers"), problem: !papers },
    { id: "criteria", label: t("part.criteria"), value: draft.criteria.length ? t("summary.criteria", { count: draft.criteria.length, musts }) : t("summary.noCriteria"), problem: needsCriteria, unset: !draft.criteria.length },
    {
      id: "reviewers",
      label: t("part.reviewers"),
      value: reviewersNow.length ? format.list(whoCounts, { type: "unit", style: "short" }) : t("summary.nobody"),
      problem: !reviewersNow.length,
      aside: reviewersNow.length ? (
        <Faces reviewers={reviewersNow} me={me} max={4} mark="size-6" />
      ) : null,
    },
    { id: "decided", label: t("part.decided"), value: draft.rule.settle === "one" ? words.t("settle.label.one") : t("summary.decided", { rule: words.t(`settle.label.${draft.rule.settle}`), you: String(!resolver || resolver.id === me), name: resolver ? words.firstName(resolver.name) : "" }), problem: false },
    { id: "goes-to", label: t("part.goesTo"), value: destinationName, problem: false },
  ];

  const body = (
    <>
      {copied ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle bg-inset px-4 py-2.5 text-sm sm:px-6">
          <Copy className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">{t.rich("filledFrom", { name: copied.name, b: (chunks) => <span className="font-medium">{chunks}</span> })}</span>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs"><NextLink href={overviewHref(copied.id)}>{t("openIt")}<ChevronRight /></NextLink></Button>
        </div>
      ) : null}
      {/* Where the summary follows the form instead of standing beside it, its list of the form's parts is a long way down: the parts are one line of links over the form. */}
      <nav aria-label={t("partsNav")} className="border-b border-border-subtle px-4 py-2.5 sm:px-6 @6xl:hidden">
        <FadeRow scrolls scrollbar="none" className="flex items-center gap-1.5 *:shrink-0">
          {summary.map((line) => (
            <JumpLink key={line.id} to={line.id} className="flex h-7 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-3 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              {line.problem ? <TriangleAlert aria-label={t("neededToStart")} className="size-3.5 shrink-0 ink-warning" /> : null}
              {line.label}
            </JumpLink>
          ))}
        </FadeRow>
      </nav>
      {/* The summary sits beside the form only where that leaves the form's rows room to stay on one line each; below that it follows the form. */}
      <div className="grid @6xl:grid-cols-[minmax(0,1fr)_24rem] @7xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-10 p-4 sm:p-6">
          {elsewhere ? (
            <Panel className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">{t("elsewhere", { named: String(Boolean(elsewhere.name)), name: words.quoted(elsewhere.name), workspace: elsewhere.workspace })}</span>
              <Button asChild size="sm" variant="outline"><a href={elsewhere.href}>{t("goOnThere")}</a></Button>
            </Panel>
          ) : null}
          <section id="name" className={cn("grid gap-4 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]", BELOW_HEADER)}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="screening-name" className="flex h-5 items-center text-xs font-medium text-muted-foreground">{t("name.label")}{changed("name")}</label>
              <Input id="screening-name" value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder={draft.sources[0]?.name ?? t("name.placeholder")} maxLength={200} className="h-10 text-base font-semibold placeholder:font-normal placeholder:text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex h-5 items-center gap-1">
                <label htmlFor="research-question" className="text-xs font-medium text-muted-foreground">{t.rich("name.question", { optional: (chunks) => <span className="font-normal">{chunks}</span> })}</label>
                <Help title={t("name.questionTitle")} facts={<HelpFact>{t("name.optional")}</HelpFact>}>{t("name.questionHelp")}</Help>
              </span>
              <Textarea id="research-question" dir="auto" rows={1} value={draft.question} onChange={(event) => set({ question: event.target.value })} placeholder={t("name.questionPlaceholder")} className="min-h-10 resize-none py-2 text-sm field-sizing-content" />
            </div>
          </section>

          <Section
            id="papers"
            title={t("part.papers")}
            help={<><Help title={t("part.papers")} facts={<><HelpFact>{t("papers.upToSources", { count: MAX_SOURCES })}</HelpFact><HelpFact>{words.t("removed.merged")}</HelpFact></>}><p>{t("papers.helpFrom")}</p><p>{t("papers.helpRead")}</p><p>{t("papers.helpLeft")}</p></Help>{changed("papers")}</>}
            aside={
              <>
                {/* What the sources held, what of that can't be screened, what two of them both held, and what is left. */}
                {reading ? <Chip><Spinner className="size-3" />{t("papers.stillReading")}</Chip> : null}
                <Chip>{t.rich("papers.found", { soFar, n: () => <AnimatedNumber value={found + leftTotal(sources)} /> })}</Chip>
                {leftTotal(sources) ? <Chip>{t.rich("papers.leftOut", { n: () => <AnimatedNumber value={leftTotal(sources)} /> })}</Chip> : null}
                <Chip>{t.rich("papers.merged", { count: found - papers, n: () => <AnimatedNumber value={found - papers} /> })}</Chip>
                {/* A running screening's papers open on its Papers page, under the same name the summary gives them. */}
                {saved ? (
                  <LinkChip href={papersHref(saved.id)} tone="primary">{t.rich("papers.link", { upTo: String(upTo), count: papers, n: () => <AnimatedNumber value={papers} /> })}</LinkChip>
                ) : (
                  <Chip className="bg-primary/12 font-medium text-primary">{t.rich("papers.toScreen", { n: () => <AnimatedNumber value={papers} /> })}</Chip>
                )}
              </>
            }
          >
            <div className="grid items-start gap-4">
              <div className="min-w-0 space-y-3">
                {/* The list and what stands in for it when it is empty are different heights: the frame around them slides from one to the other. */}
                <AutoHeight>
                {sourceRows.length ? (
                  <div className={cn(LIST, "bg-card")}>
                    <AnimatePresence initial={false}>
                      {sourceRows.map(({ source, gone }) => {
                        const Icon = kindIcon(source.kind);
                        const open = openSource?.id === source.id && !gone ? openSource.part : null;
                        const isOpen = open === "papers";
                        // What it held and doesn't take: a PDF source's files that can't be screened, a file's records with no title, the DOIs that weren't found.
                        const leftOut = leftOf(source);
                        // While the screening reads it, the row says only that: what it takes and leaves out isn't known yet.
                        const busy = source.read?.state === "reading" || source.read?.state === "waiting" ? t("papers.readingIt") : null;
                        const stopped = source.read?.state === "failed";
                        const itemsLabel = leftOut ? t("papers.leftOutCount", { count: leftOut }) : null;
                        const link = sourceLink(source);
                        // What it held at the start and what its checks found add up to its total. Each says how many of its own were duplicates: papers another source already had, or that it lists twice itself.
                        const grew = grown(source);
                        const grewDoubled = (source.updates ?? []).reduce((sum, update) => sum + update.duplicates, 0);
                        const grewText = t("papers.grew", { count: grew, doubled: grewDoubled });
                        const doubled = Math.min(source.duplicates, taken(source) - grew);
                        // On a running screening the name opens the papers it brought; where it lives opens from the icon beside it.
                        const own = saved?.sources.some((one) => one.id === source.id) ? saved.id : null;
                        // The papers it has brought stay in the screening whatever its range becomes (convex/screening/settings.ts): the range can only take more of it, and says so.
                        const heldRange = (one: Source) => {
                          const was = saved?.sources.find((kept) => kept.id === one.id);
                          if (!was) return undefined;
                          const range: [number, number] = was.scope === "range" ? was.range : [1, Math.max(1, baseTotal(was))];
                          return { range, note: t("papers.rangeHeld", { first: words.num(range[0]), last: words.num(range[1]) }) };
                        };
                        return (
                          <motion.div key={source.id} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", DIVIDED_ROW)}>
                            <div className={cn("flex min-h-14 items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors max-sm:flex-wrap", gone && TONE.warning.panel)}>
                              <span className="flex size-9 shrink-0 items-center justify-center self-start rounded-lg bg-foreground/[0.06] text-foreground"><Icon className="size-4" /></span>
                              <div className="min-w-0 flex-1 space-y-1.5 max-sm:basis-[calc(100%-3rem)]">
                                <div className="flex min-w-0 items-center gap-1">
                                  {gone ? (
                                    <p className="truncate text-sm font-medium text-muted-foreground line-through max-sm:line-clamp-2 max-sm:whitespace-normal">{source.name}</p>
                                  ) : own ? (
                                    <NextLink href={papersHref(own, { source: source.id })} className={cn(INLINE_LINK, "truncate text-sm max-sm:line-clamp-2 max-sm:whitespace-normal")}>{source.name}</NextLink>
                                  ) : link ? (
                                    <a href={link.href} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                                      <span className="truncate max-sm:line-clamp-2 max-sm:whitespace-normal">{source.name}</span>
                                      <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                                      <span className="sr-only">{t("papers.newTab")}</span>
                                    </a>
                                  ) : (
                                    <p className="truncate text-sm font-medium max-sm:line-clamp-2 max-sm:whitespace-normal">{source.name}</p>
                                  )}
                                  {own && link && !gone ? (
                                    <TooltipHint label={t("where.open", { where: link.where })}>
                                      <a href={link.href} target="_blank" rel="noreferrer" aria-label={t("where.openNewTab", { where: link.where })} className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"><ExternalLink className="size-3.5" /></a>
                                    </TooltipHint>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {gone ? <StateChip tone="warning" icon={Trash2}>{t("papers.removedOnSave")}</StateChip> : null}
                                  {/* Its counts take the place the chip holds once the lookup or the count is back, so the row keeps its height. */}
                                  {busy ? <Chip key="busy"><Spinner className="size-3" />{busy}</Chip> : (
                                    <>
                                      <Chip key="count">{source.scope === "all" ? (source.total > baseTotal(source) ? t("papers.atStart", { count: baseTotal(source) }) : heldBy(source) === null ? t("papers.allOfIt") : t("papers.all", { count: heldBy(source)! })) : t("papers.inSource", { count: baseTotal(source) })}</Chip>
                                      {source.read?.filed ? <Chip icon={FileText}>{t("papers.readAsPdf", { count: source.read.filed })}</Chip> : null}
                                      {/* The records it merged open from the chip that counts them, as what it left out does: each with the paper that stands for it. */}
                                      {doubled > 0 && taken(source) ? (
                                        rowOf(source) ? (
                                          <button type="button" aria-expanded={open === "merged"} onClick={() => setOpenSource(open === "merged" ? null : { id: source.id, part: "merged" })} className="flex rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
                                            <Chip>{t("papers.duplicates", { count: doubled })}<ChevronDown aria-hidden className={cn("size-3 transition-transform duration-200", open === "merged" && "rotate-180")} /></Chip>
                                          </button>
                                        ) : <Chip>{t("papers.duplicates", { count: doubled })}</Chip>
                                      ) : null}
                                      {grew > 0 && own && !gone ? (
                                        <LinkChip href={papersHref(own, { source: source.id, ...((source.updates?.length ?? 0) === 1 ? { added: String(source.updates![0]!.at) } : { sort: "added" }) })} tone="primary" icon={RefreshCw}>{grewText}</LinkChip>
                                      ) : grew > 0 ? (
                                        <StateChip tone="primary" icon={RefreshCw}>{grewText}</StateChip>
                                      ) : draft.living && GROWS.includes(source.kind) ? <Chip icon={RefreshCw}>{t("papers.checkedEvery", { every: draft.living.every })}</Chip> : null}
                                      {stopped ? <StateChip tone="destructive" icon={TriangleAlert}>{source.read!.read ? t("papers.stoppedAfter", { read: source.read!.read, total: words.num(source.total) }) : t("papers.couldntBeRead")}</StateChip> : null}
                                      {/* PDFs not yet in a screening: how their first reading stands, as it arrives. */}
                                      {source.set?.kind === "pdf" && !own ? <PdfFacts batch={source.set.batch} /> : null}
                                      {source.filters?.map((filter) => <Chip key={filter}>{filter}</Chip>)}
                                      {source.facts?.map((fact) => (/not in the index/.test(fact) ? <Chip key={fact}>{fact}</Chip> : <Chip key={fact} icon={Check}>{fact}</Chip>))}
                                    </>
                                  )}
                                  {/* What it left out opens from the chip that counts it: the list says why for each. */}
                                  {itemsLabel && !gone && !busy ? (
                                    <button type="button" aria-expanded={open === "left"} onClick={() => setOpenSource(open === "left" ? null : { id: source.id, part: "left" })} className="flex rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
                                      <StateChip tone={leftOut ? "warning" : "neutral"} icon={leftOut ? FileX : undefined}>{itemsLabel}<ChevronDown aria-hidden className={cn("size-3 transition-transform duration-200", open === "left" && "rotate-180")} /></StateChip>
                                    </button>
                                  ) : null}
                                </div>
                                {/* Why, on its own line: what the person can do about it, or that it went wrong in Openscholar. */}
                                {stopped && !gone ? <p className="text-xs text-destructive">{source.read!.failure ?? t("papers.notSaved")}</p> : null}
                              </div>
                              {gone ? (
                                <Button variant="ghost" size="sm" className="h-8 shrink-0 max-sm:ms-auto" onClick={() => keepSource(source)}><Undo2 />{t("papers.keep")}</Button>
                              ) : (
                                <>
                                  {stopped && own ? <Button variant="ghost" size="sm" className="h-8 shrink-0 max-sm:ms-auto" onClick={() => void readSourceAgain({ sourceId: source.id as Id<"screeningSources"> }).catch(failed)}><RefreshCw />{t("papers.readAgain")}</Button> : null}
                                  {baseTotal(source) > 1 ? (
                                    <Button variant="ghost" size="sm" aria-expanded={isOpen} className="h-8 shrink-0 text-xs text-muted-foreground max-sm:ms-auto" onClick={() => setOpenSource(isOpen ? null : { id: source.id, part: "papers" })}>
                                      {source.scope === "range" ? t("papers.range", { first: words.num(source.range[0]), last: words.num(source.range[1]) }) : t("papers.choose")}<ChevronDown className={cn("transition-transform duration-200", isOpen && "rotate-180")} />
                                    </Button>
                                  ) : null}
                                  <TooltipHint label={t("papers.remove", { name: source.name })}>
                                    <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={t("papers.remove", { name: source.name })} onClick={() => removeSource(source)}><Trash2 /></Button>
                                  </TooltipHint>
                                </>
                              )}
                            </div>
                            <AnimatePresence initial={false}>
                              {open ? (
                                <motion.div key="scope" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                                  {/* The row's two parts are different heights: going from one to the other slides. */}
                                  <AutoHeight>
                                  {open === "left" ? (
                                    <div className="pb-4 ps-16 pe-4 max-sm:ps-4">
                                      {/* Each row says why it was left out, and the section's "?" says the rule: the list needs no words of its own. */}
                                      {rowOf(source) ? <LeftOut {...rowOf(source)!} total={leftOut} /> : null}
                                    </div>
                                  ) : open === "merged" ? (
                                    <div className="pb-4 ps-16 pe-4 max-sm:ps-4">
                                      {rowOf(source) ? <Merged {...rowOf(source)!} total={doubled} open={own} sources={sources} /> : null}
                                    </div>
                                  ) : (
                                  <div className="space-y-4 pb-4 ps-16 pe-4 max-sm:ps-4">
                                    <PaperScope
                                      search={source.kind === "search"}
                                      page={false}
                                      scope={source.scope}
                                      onScope={(scope) => patchSource(source.id, { scope: scope === "all" ? "all" : "range" })}
                                      range={source.range}
                                      onRange={(next) => patchSource(source.id, (now) => ({ range: typeof next === "function" ? next(now.range) : next }))}
                                      total={baseTotal(source)}
                                      held={heldRange(source)}
                                      label={t("papers.of", { name: source.name })}
                                      summary={<p className="text-xs text-muted-foreground">{heldBy(source) === null ? t("papers.everyDeep") : t("papers.everyOne", { count: heldBy(source)! })}</p>}
                                    />
                                    {/* While it is read, the titles hold the room its range promises: nothing arrives under the row once it is open. */}
                                    {SAMPLED.has(source.kind) && source.set && promised(source) ? <SampleTitles set={source.set} sourceId={id ? rowOf(source)?.sourceId : undefined} first={source.scope === "range" ? source.range[0] : 1} taken={promised(source)} /> : null}
                                    {source.set?.kind === "pdf" && !own ? <div className="border-t border-border-subtle pt-3"><PdfFiles batch={source.set.batch} total={baseTotal(source)} /></div> : null}
                                    {link && promised(source) ? (
                                      <p className="border-t border-border-subtle pt-3 text-xs">
                                        <a href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">{busy ? t("where.see", { where: link.where }) : t("where.seeAll", { where: link.where, count: words.num(taken(source)) })}<ExternalLink aria-hidden className="size-3" /></a>
                                      </p>
                                    ) : null}
                                    {/* A range of a Zotero source is counted in the order its papers were added there, which holds from one read to the next. */}
                                    {source.kind === "zotero" && source.scope === "range" ? <Chip icon={Clock}>{t("papers.zoteroOrder")}</Chip> : null}
                                  </div>
                                  )}
                                  </AutoHeight>
                                </motion.div>
                              ) : null}
                            </AnimatePresence>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                ) : (
                  <EmptyNote>{t("summary.noPapers")}</EmptyNote>
                )}
                </AutoHeight>
              </div>

              {handoffProblem ? <p role="alert" className="rounded-2xl bg-warning/10 px-4 py-2.5 text-sm ink-warning">{t("papers.handoffGone")}</p> : null}
              {/* What can be added sits in a well of its own, under its own title: it never looks like what is already in. */}
              <Panel className="@container min-w-0 space-y-3">
                <h3 className="text-sm font-semibold">{t("papers.addFrom")}</h3>
                <Tabs value={kind} onValueChange={(next) => { setKind(next as Kind); setFind(""); }} className="gap-3">
                  <ScrollArea axis="x" shades className="rounded-[1.375rem] bg-card ring-1 ring-border-subtle">
                  <TabsList id="add-papers" aria-label={t("papers.addFrom")} className="h-auto w-max justify-start gap-1 bg-transparent p-1 group-data-[orientation=horizontal]/tabs:h-auto">
                    {KINDS.map((one) => (
                      <TabsTrigger key={one.id} value={one.id} className="h-8 flex-none rounded-full px-3 text-xs text-muted-foreground data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:ring-1 data-[state=active]:ring-primary/40 dark:data-[state=active]:bg-primary/15 dark:data-[state=active]:text-primary">
                        <one.icon className="size-3.5 @max-[43rem]:hidden" />{t(`kind.${one.id}`)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  </ScrollArea>
                  <TabsContent value={kind}>
                    {/* The tabs are different heights: the frame slides from one to the next, and what is under it moves with it. */}
                    <AutoHeight>
                    {kind === "upload" ? <UploadTab sources={draft.sources} onAdd={pick} {...(lookCredits === undefined ? {} : { lookCredits })} />
                    : kind === "dois" ? <DoiTab sources={draft.sources} onAdd={pick} />
                    : kind === "zotero" ? <ZoteroTab sources={draft.sources} onAdd={pick} />
                    : kind === "evidenceLibrary" ? <CommunityTab sources={draft.sources} onAdd={pick} />
                    : (
                    <div className="space-y-2">
                      {/* A search is found by its words and a screening by its name. The library's collections are few enough to page through. */}
                      {kind !== "collection" ? (
                        <div className="relative">
                          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input value={find} onChange={(event) => setFind(event.target.value)} placeholder={t(`find.${kind as "search" | "screening"}`)} aria-label={t("papers.findSource")} className="h-8 rounded-full bg-card ps-8 text-sm" />
                        </div>
                      ) : null}
                      {/* While a list is read, and while it runs to more than a page, it keeps a page's height, so a short last page moves nothing under it. A list that turns out shorter slides to its own height. */}
                      <AutoHeight>
                      <div className={cn("divide-y divide-border-subtle transition-opacity", offered.pager?.isStale && "pointer-events-none opacity-60")} style={{ minHeight: offered.loading || offered.pager?.hasPages ? OFFER_PAGE * 57 : undefined }}>
                        {offered.loading && !offered.rows.length ? <ListRowsSkeleton rows={OFFER_PAGE} height={57} label={t("papers.loadingList")} /> : null}
                        {offered.rows.map((offer) => <OfferRow key={offer.ref} offer={offer} icon={kindIcon(offer.set.kind)} added={taken_(offer.ref)} onAdd={() => pick(offer)} />)}
                        {!offered.rows.length && !offered.loading ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{typed ? t("papers.noneByName") : kind === "screening" ? (here?.kind === "personal" ? t("papers.noneOwnIncluded") : t("papers.noneIncluded", { workspace: workspace.name })) : kind === "search" ? t("papers.noSearches") : t("papers.nothingHere")}</p> : null}
                      </div>
                      {offered.pager?.hasPages ? <CommandCenterPagination className="pt-1" currentPage={offered.pager.page} itemLabel={t("papers.pagerSources")} steps={{ canPrevious: offered.pager.canPrevious, canNext: offered.pager.canNext, onPrevious: offered.pager.previous, onNext: offered.pager.next, offset: offered.pager.offset, shown: offered.pager.items.length }} /> : null}
                      </AutoHeight>
                    </div>
                    )}
                    </AutoHeight>
                  </TabsContent>
                </Tabs>
              </Panel>

              {/* A living screening: its sources are checked again on a schedule, and only what is new is screened. */}
              <div id="new-papers" className={cn(LIST, BELOW_HEADER, "min-w-0 bg-card")}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <p className="flex min-w-48 flex-1 items-center gap-1 text-sm font-medium">
                    {t("living.title")}
                    <Help title={t("living.title")} facts={<><HelpFact>{t("living.factFixed")}</HelpFact><HelpFact>{t("living.factEmail")}</HelpFact><HelpFact icon={Coins}>{t("living.factCharge")}</HelpFact></>}>{t("living.help")}</Help>
                    {changed("new-papers")}
                  </p>
                  <Segmented
                    label={t("living.check")}
                    value={draft.living?.every ?? "off"}
                    onChange={(next) => set({ living: next === "off" ? undefined : { every: next, next: Date.now() + EVERY_MS[next] } })}
                    options={[{ id: "off" as const, label: t("living.off") }, ...(["day", "week", "month"] as const).map((id) => ({ id, label: words.t(`every.${id}`) }))]}
                  />
                </div>
                {draft.living ? (
                  growing(draft).length ? (
                    <div className="flex flex-wrap gap-1.5 bg-inset px-4 py-2.5">
                      <Chip icon={RefreshCw}>{growing(draft).length === draft.sources.length ? t("living.checksAll", { count: draft.sources.length }) : t("living.checksSome", { count: draft.sources.length, growing: growing(draft).length })}</Chip>
                      <Chip icon={Clock}>{saved?.living ? t("living.nextCheck", { day: words.day(draft.living.next) }) : fresh ? t("living.firstCheck", { day: words.day(draft.living.next) }) : t("living.firstOnSave")}</Chip>
                      {models.length ? <Chip icon={Coins}>{t("living.perNew", { credits: words.credits(perNew), pdf: String(pdfsCome) })}</Chip> : null}
                    </div>
                  ) : (
                    <p className="bg-warning/10 px-4 py-2.5 text-sm ink-warning">{draft.sources.length ? t("living.noneGrow") : t("living.addToCheck")}</p>
                  )
                ) : null}
              </div>
            </div>
          </Section>

          <Section
            id="criteria"
            className="@container/criteria"
            title={t("part.criteria")}
            help={<><Help title={t("criteria.helpTitle")} facts={<><HelpFact>{t("criteria.factPeople")}</HelpFact><HelpFact>{t("criteria.factModels")}</HelpFact></>}>{t("criteria.help")}</Help>{changed("criteria")}</>}
            aside={
              <span className="flex items-center gap-1">
                <span className="flex flex-wrap items-center justify-end gap-1 @max-[40rem]/criteria:hidden">
                  {importable.length ? (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => importable.forEach(({ question }) => addCriterion(question))}>
                      <ListChecks />{t("criteria.import", { count: importable.length, searches: importSearches })}
                    </Button>
                  ) : null}
                  {copyable.length ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="fade-enter h-7 text-xs"><Copy />{t("criteria.copyFrom")}<ChevronDown /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-80">
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("criteria.copyAdds")}</DropdownMenuLabel>
                        {copyable.map((one) => (
                          <DropdownMenuItem key={one.id} onSelect={() => copyCriteria(one)}>
                            <span className="min-w-0 flex-1 truncate">{one.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{words.count("criteria", one.criteria)}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                  <TooltipHint label={writing ? undefined : (cantWrite ?? undefined)}>
                    <span tabIndex={cantWrite && !writing ? 0 : -1} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={writing || Boolean(cantWrite)} onClick={writeCriteria}><AiIcon working={writing} />{t("criteria.write")}<ButtonCredits credits={writeCredits} /></Button>
                    </span>
                  </TooltipHint>
                </span>
                {/* Where the section's line is too short for them beside its title, the three are one menu: none wraps onto a line of its own. */}
                <DropdownMenu>
                  <TooltipHint label={t("criteria.more")}>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8 text-muted-foreground @[40rem]/criteria:hidden" aria-label={t("criteria.actions")}><MoreHorizontal /></Button></DropdownMenuTrigger>
                  </TooltipHint>
                  <DropdownMenuContent align="end" className="w-72">
                    {importable.length ? <DropdownMenuItem onSelect={() => importable.forEach(({ question }) => addCriterion(question))}><ListChecks />{t("criteria.import", { count: importable.length, searches: importSearches })}</DropdownMenuItem> : null}
                    {/* Why it can't be pressed goes under the label, and the icon stays on the label's line. */}
                    <DropdownMenuItem disabled={writing || Boolean(cantWrite)} onSelect={writeCriteria} className="items-start"><span className="flex h-5 shrink-0 items-center"><AiIcon working={writing} /></span><span className="min-w-0 flex-1">{t("criteria.write")}{cantWrite ? <span className="block text-xs text-muted-foreground">{cantWrite}</span> : null}</span></DropdownMenuItem>
                    {copyable.length ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("criteria.copyCriteriaFrom")}</DropdownMenuLabel>
                        {copyable.map((one) => (
                          <DropdownMenuItem key={one.id} onSelect={() => copyCriteria(one)}>
                            <span className="min-w-0 flex-1 truncate">{one.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{words.num(one.criteria)}</span>
                          </DropdownMenuItem>
                        ))}
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            }
          >
            <div className={cn(LIST, "bg-card")}>
              {/* The column names come and go with the first and the last criterion, growing and shrinking as a row does. */}
              <AnimatePresence initial={false}>
                {criterionRows.length ? (
                  <motion.div key="names" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden @max-3xl/criteria:hidden", DIVIDED_ROW)}>
                <div className="flex items-center gap-x-3 px-4 py-1.5 text-xs text-muted-foreground">
                  <span className="w-4 shrink-0" />
                  <span className="min-w-0 flex-1 px-1">{t("criteria.questionColumn")}</span>
                  <span className={cn(SHORT_NAME, "flex items-center gap-1")}>{t("criteria.shortName")}{shortNameHelp}</span>
                  <span aria-hidden className={ROW_END} />
                </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {criterionRows.map(({ criterion, gone }, i) => (
                  <motion.div key={criterion.key} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", DIVIDED_ROW)}>
                    {/* A criterion is two lines, its question and the guidance under it, so what sits beside them lines up with the question. */}
                    <div className={cn("flex items-start gap-x-3 gap-y-1 px-4 py-2 transition-colors @max-3xl/criteria:flex-wrap", gone && TONE.warning.panel)}>
                      <span className="mt-2 w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{words.num(i + 1)}</span>
                      {gone ? (
                        <>
                          <p className="min-w-0 flex-1 px-1 py-1.5 text-sm text-muted-foreground line-through @max-3xl/criteria:basis-[calc(100%-1.75rem)]">{criterion.text}</p>
                          <StateChip tone="warning" icon={Trash2} className="@max-3xl/criteria:ms-5">{t("papers.removedOnSave")}</StateChip>
                          <Button variant="ghost" size="sm" className="h-8 shrink-0" onClick={() => keepCriterion(criterion)}><Undo2 />{t("papers.keep")}</Button>
                        </>
                      ) : (
                        <>
                          {/* The short name follows the question's words until someone has written one. */}
                          <div className="min-w-0 flex-1 @max-3xl/criteria:basis-[calc(100%-1.75rem)]">
                            <Textarea rows={1} value={criterion.text} onChange={(event) => patchCriterion(criterion.key, ((text) => (now: Criterion) => ({ text, short: isNamed(now) ? now.short : shortOf(text) }))(event.target.value))} aria-label={t("criteria.criterion", { n: i + 1 })} aria-invalid={!criterion.text.trim() || undefined} placeholder={t("criteria.questionPlaceholder")} className="min-h-8 w-full resize-none border-transparent bg-transparent px-1 py-1.5 text-sm shadow-none field-sizing-content hover:border-border-subtle" />
                            {/* What counts and what doesn't. A reviewer opens it with "Guidance" under the question on Screen, and a model is given it with the question. */}
                            <div className="flex items-start gap-1 ps-1 text-muted-foreground">
                              <CircleHelp aria-hidden className="mt-1 size-3.5 shrink-0" />
                              <Textarea rows={1} value={criterion.note ?? ""} onChange={(event) => patchCriterion(criterion.key, { note: event.target.value || undefined })} aria-label={t("criteria.guidanceFor", { n: i + 1 })} placeholder={t("criteria.guidancePlaceholder")} className="min-h-0 min-w-0 flex-1 resize-none border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground shadow-none field-sizing-content placeholder-shown:border-dashed placeholder-shown:border-border hover:border-border-subtle" />
                            </div>
                            {/* The words a person sees marked in each abstract while they vote on this criterion. */}
                            <MarkedWords criterion={criterion} n={i + 1} onChange={(terms) => patchCriterion(criterion.key, { terms })} />
                          </div>
                          <ShortName criterion={criterion} n={i + 1} help={criterion.key === criterionRows.find((row) => !row.gone)?.criterion.key ? shortNameHelp : undefined} onChange={(short) => patchCriterion(criterion.key, { short })} />
                          <span className={ROW_END}>
                            <Segmented label={t("criteria.is", { n: i + 1 })} value={criterion.must ? "must" : "nice"} onChange={(next) => patchCriterion(criterion.key, { must: next === "must" })} options={[{ id: "must", label: t("criteria.must") }, { id: "nice", label: t("criteria.nice") }]} />
                            <TooltipHint label={t("papers.remove", { name: criterionName(effectsSay, criterion) })}>
                              <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={t("papers.remove", { name: criterionName(effectsSay, criterion) })} onClick={() => removeCriterion(criterion)}><Trash2 /></Button>
                            </TooltipHint>
                          </span>
                        </>
                      )}
                    </div>
                  </motion.div>
                ))}
                {/* Criteria being written hold the room about five of them take, from the press of the button: what is under the list moves once, under the hand that pressed, and hardly again when they arrive. */}
                {writing ? <motion.div key="writing" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", DIVIDED_ROW)}><p className="flex min-h-[17.5rem] items-center justify-center gap-2 px-4 py-4 text-sm text-muted-foreground"><AiIcon working className="size-4" />{t("criteria.writing")}</p></motion.div> : null}
                {/* The line a list with nothing in it shows grows in as its last row shrinks away, as a row does. */}
                {!criterionRows.length && !writing ? <motion.div key="none" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", DIVIDED_ROW)}><p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">{t("criteria.none")}</p></motion.div> : null}
              </AnimatePresence>
              <form className="flex items-center gap-2 px-4 py-2.5" onSubmit={(event) => { event.preventDefault(); addCriterion(text); setText(""); }}>
                <Input id="new-criterion" value={text} onChange={(event) => setText(event.target.value)} placeholder={t("criteria.newPlaceholder")} aria-label={t("criteria.new")} className="h-9 flex-1" />
                <Button type="submit" variant="outline" size="sm" className="h-9" disabled={!text.trim()}><Plus />{t("criteria.add")}</Button>
              </form>
              <div>
                <div className="flex items-center gap-1 px-4 py-2">
                  <button type="button" aria-expanded={scoring} aria-controls="scoring" onClick={() => setScoring(!scoring)} className="-ms-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50">
                    {t("scoring.title")}
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", scoring && "rotate-180")} />
                  </button>
                  <Help title={t("scoring.title")} facts={<><HelpFact>{t("scoring.factPoints")}</HelpFact><HelpFact>{t("scoring.factStars")}</HelpFact></>}>{t("scoring.help")}</Help>
                </div>
                <AnimatePresence initial={false}>
                  {scoring ? (
                    <motion.div id="scoring" key="scoring" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                      <div className="space-y-4 px-4 pb-4">
                        {draft.criteria.length ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-end gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <span />
                              <span className="col-span-3 border-b border-border-subtle pb-1 text-center">{t("scoring.pointsEach")}</span>
                              <span>{t("scoring.criterion")}</span><span className="text-center">{t("scoring.yes")}</span><span className="text-center">{t("scoring.no")}</span><span className="text-center">{t("scoring.unclear")}</span>
                            </div>
                            {draft.criteria.map((criterion) => (
                              <div key={criterion.key} className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-center gap-2">
                                <span className="flex min-w-0 items-center gap-2 text-sm"><span className="min-w-0">{criterion.text}</span>{criterion.must ? <Chip className="shrink-0">{t("criteria.must")}</Chip> : null}</span>
                                {[0, 1, 2].map((slot) => (
                                  <Input key={slot} type="number" value={draft.scoring.points[criterion.key]?.[slot] ?? 0} onChange={(event) => set({ scoring: { ...draft.scoring, points: { ...draft.scoring.points, [criterion.key]: (draft.scoring.points[criterion.key] ?? [1, 0, 0]).map((points, at) => (at === slot ? Number(event.target.value) : points)) as [number, number, number] } } })} aria-label={t("scoring.pointsFor", { answer: (["yes", "no", "unclear"] as const)[slot]!, name: criterionName(effectsSay, criterion) })} className="h-8 px-1 text-center text-sm tabular-nums" />
                                ))}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={t("scoring.starsGroup")}>
                          <span>{t("scoring.starsBegin")}</span>
                          {draft.scoring.stars.map((points, star) => <Input key={star} type="number" value={points} onChange={(event) => set({ scoring: { ...draft.scoring, stars: draft.scoring.stars.map((now, at) => (at === star ? Number(event.target.value) : now)) } })} aria-label={t("scoring.pointsForStars", { count: star + 1 })} className="h-8 w-12 px-1 text-center text-sm tabular-nums" />)}
                          <span className="text-xs text-muted-foreground">{t("scoring.starsRange")}</span>
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </Section>

          <Section
            id="reviewers"
            title={t("part.reviewers")}
            help={<><Help title={t("part.reviewers")} facts={<><HelpFact>{t("reviewers.factPeople")}</HelpFact><HelpFact icon={Coins}>{t("reviewers.factModels")}</HelpFact></>}>{t("reviewers.help")}</Help>{changed("reviewers")}</>}
            aside={<Chip>{words.listed(whoCounts) || t("summary.nobody")}</Chip>}
          >
            {/* People and models in one list, people first, each row the same height: what each costs, what each has voted, and the way to take them off. */}
            <div className={cn(LIST, "bg-card")}>
              <AnimatePresence initial={false}>
                {youFirst(reviewerRows, me).map(({ reviewer, gone }) => {
                  const votes = wasOn(reviewer) || gone ? votesOf(reviewer) : 0;
                  const left = reviewer.kind === "model" ? ahead(reviewer) : 0;
                  return (
                    <ReviewerRow
                      key={reviewer.id}
                      reviewer={reviewer}
                      you={reviewer.id === me}
                      href={saved && (wasOn(reviewer) || gone) ? papersHref(saved.id, { reviewer: reviewer.id }) : undefined}
                      gone={gone}
                      detail={reviewer.kind === "model" ? (reviewer.model?.effort && !words.twinEffort(reviewer) ? t("reviewers.aiModelAt", { effort: words.effortOf(reviewer.model.effort).toLocaleLowerCase() }) : t("reviewers.aiModel")) : reviewer.email ? (!saved ? words.t("person.toInviteAtStart") : !wasOn(reviewer) ? words.t("person.toInvite") : words.t("person.invited")) : reviewer.id === draft.rule.resolver && draft.rule.settle !== "one" ? words.t("person.settles") : words.standsTo(reviewer)}
                      chips={
                        gone ? (
                          <>
                            <StateChip tone="warning" icon={Trash2}>{t("papers.removedOnSave")}</StateChip>
                            {votes ? <Chip>{t("reviewers.votesKeep", { count: votes })}</Chip> : null}
                          </>
                        ) : (
                          <>
                            {reviewer.model ? (
                              <>
                                {paused ? <StateChip tone="warning" icon={MODELS_SAY.paused.icon}>{pieces("modelsSay.paused.row")}</StateChip> : null}
                                <Chip icon={Coins}>{perPaper({ words, t: list }, reviewer.model)}</Chip>
                                {/* A model that takes no files is given no paper that is only its PDF: said where it is picked, before it is paid for. */}
                                {pdfsMissed(reviewer.model, pdfs).papers ? <StateChip tone="warning" icon={FileText}>{t("reviewers.pdfsMissed", { why: pdfsMissed(reviewer.model, pdfs).why === "text" ? "text" : "long", count: pdfsMissed(reviewer.model, pdfs).papers })}</StateChip> : null}
                                {due(reviewer) ? (
                                  <Chip icon={Coins}>{t("reviewers.creditsFor", { credits: words.credits(due(reviewer)), count: left })}</Chip>
                                ) : null}
                                {/* A paper it couldn't read shows beside what it still has to read: one never hides the other. */}
                                {saved && unreadBy(reviewer) ? (
                                  <LinkChip href={papersHref(saved.id, { reviewer: reviewer.id, voted: "failed" })} tone="destructive" icon={TriangleAlert}>{unreadText(unreadBy(reviewer))}</LinkChip>
                                ) : allRead(reviewer) ? <Chip icon={Check}>{t("reviewers.allRead")}</Chip> : null}
                              </>
                            ) : null}
                            {votes && saved ? <LinkChip href={papersHref(saved.id, { reviewer: reviewer.id })}>{words.count("votes", votes)}</LinkChip> : null}
                          </>
                        )
                      }
                      onRemove={() => removeReviewer(reviewer)}
                      onKeep={() => keepReviewer(reviewer)}
                    />
                  );
                })}
                {!reviewerRows.length ? <motion.div key="none" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", DIVIDED_ROW)}><p className="px-4 py-4 text-sm text-muted-foreground">{t("reviewers.none")}</p></motion.div> : null}
              </AnimatePresence>
              {guestsLeft.length ? <p className="flex items-start gap-2 px-4 py-2.5 text-xs text-muted-foreground"><Users aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>{t("reviewers.guestsLeft", { count: guestsLeft.length, names: words.listed(guestsLeft) })}</span></p> : null}
              <div className="grid gap-2 px-4 py-2.5 sm:grid-cols-2">
                <AddPerson exclude={people.map((person) => person.id)} onPick={(pick) => addReviewer("person" in pick ? personReviewer(pick.person, Date.now()) : invitedReviewer(pick.email, Date.now()))}>
                  <Button id="add-person" variant="outline" size="sm" className="w-full"><UserPlus />{t("reviewers.addPerson")}</Button>
                </AddPerson>
                <AddModel taken={models.map((model) => modelKey(model.model!))} pdfs={pdfs} onPick={(model) => addReviewer(modelReviewer(model, Date.now()))}>
                  <Button variant="outline" size="sm" className="w-full"><AiIcon />{t("reviewers.addModel")}</Button>
                </AddModel>
              </div>
            </div>
          </Section>

          <Section
            id="decided"
            title={t("part.decided")}
            help={<><Help title={t("part.decided")} facts={<><HelpFact icon={Check}><Named name={t("decided.votesAgree")}>{t("decided.settled")}</Named></HelpFact><HelpFact icon={GitCompare}><Named name={t("decided.votesSplit")}>{words.result("conflict")}</Named></HelpFact></>}>{t("decided.help")}</Help>{changed("decided")}</>}
          >
            <div className={cn(LIST, "bg-card")}>
              <RuleRow name={t("decided.each")} help={<Help title={t("decided.each")} facts={<><HelpFact>{t("decided.factModels")}</HelpFact><HelpFact>{t("decided.factEveryone")}</HelpFact></>}>{t("decided.eachHelp")}</Help>} detail={shareSays}>
                {draft.rule.settle === "one" && readers ? (
                  // The first vote settles a paper: a second person on it would read it for nothing, or at the same moment.
                  <span className="text-sm text-muted-foreground">{t("decided.onePerson")}</span>
                ) : readers ? (
                  // Every number up to the team's size, invited people included, then Everyone, which is its own choice: it goes on meaning everyone when someone joins, where a number stays that number. One person alone can choose it too, for whoever joins later.
                  <Segmented label={t("decided.each")} value={draft.rule.each !== "all" && Number(draft.rule.each) > readers ? (String(readers) as Screening["rule"]["each"]) : draft.rule.each} onChange={(next) => set({ rule: { ...draft.rule, each: next } })} options={[...Array.from({ length: readers }, (_, k) => ({ id: String(k + 1) as Screening["rule"]["each"], label: words.num(k + 1) })), { id: "all" as const, label: t("decided.everyone") }]} />
                ) : <span className="text-sm text-muted-foreground">{t("decided.addPerson")}</span>}
              </RuleRow>
              <RuleRow name={t("decided.settledWhen")} help={<Help title={t("decided.settlingTitle")}><p>{t("decided.oneVote")}</p>{(["all", "most", "one"] as const).map((rule) => <p key={rule}>{t.rich("decided.ruleMeans", { label: words.t(`settle.label.${rule}`), means: words.t(`settle.means.${rule}`), b: (chunks) => <span className="font-medium text-foreground">{chunks}</span> })}</p>)}</Help>}>
                <Segmented label={t("decided.settledWhen")} value={draft.rule.settle} onChange={(next) => set({ rule: { ...draft.rule, settle: next, ...(next === "one" ? { each: "1" as const } : {}) } })} options={(["all", "most", "one"] as const).map((id) => ({ id, label: words.t(`settle.label.${id}`) }))} />
              </RuleRow>
              <RuleRow name={t("decided.modelVotes")} help={<Help title={t("decided.modelVotes")}><p>{t("decided.modelVotesVote")}</p><p>{t("decided.modelVotesAdvice")}</p><p>{t("decided.modelVotesNever")}</p></Help>}>
                {/* A rule that doesn't apply says why in its place: with no model there is nothing to count, and the first vote is a person's whatever the setting. */}
                {!models.length ? <JumpLink to="reviewers" className={cn(INLINE_LINK, "text-sm font-normal")}>{t("decided.addModel")}</JumpLink>
                  : draft.rule.settle === "one" ? <span className="text-sm text-muted-foreground">{t("decided.modelsUnderOne")}</span>
                  : <Segmented label={t("decided.modelVotes")} value={draft.rule.models} onChange={(next) => set({ rule: { ...draft.rule, models: next } })} options={[{ id: "vote" as const, label: t("decided.countAsVote") }, { id: "advice" as const, label: t("decided.adviceOnly") }]} />}
              </RuleRow>
              <RuleRow name={t("decided.settledBy")} help={<Help title={t("decided.conflictsTitle")}>{t("decided.conflictsHelp")}</Help>}>
                {draft.rule.settle === "one" ? (
                  <Chip icon={Check}>{t("decided.noConflicts")}</Chip>
                ) : joined.length ? (
                  <Select value={joined.some((person) => person.id === draft.rule.resolver) ? draft.rule.resolver : joined[0]!.id} onValueChange={(next) => set({ rule: { ...draft.rule, resolver: next } })}>
                    <SelectTrigger aria-label={t("decided.whoSettles")} className="h-8 w-56 rounded-full px-3.5 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {joined.map((person) => <SelectItem key={person.id} value={person.id}><span className="flex items-center gap-2"><ReviewerMark reviewer={person} className="size-5" /><ReviewerName reviewer={person} you={person.id === me} /></span></SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : <Settler person={personIn(draft, draft.createdBy)} you={draft.createdBy === me} />}
              </RuleRow>
              <RuleRow name={t("decided.seeVotes")} help={<Help title={t("decided.seeingTitle")}>{t("decided.seeingHelp")}</Help>}>
                <Segmented label={t("decided.seeVotes")} value={draft.rule.blind} onChange={(next) => set({ rule: { ...draft.rule, blind: next } })} options={[{ id: "after" as const, label: t("decided.after") }, { id: "always" as const, label: t("decided.always") }]} />
              </RuleRow>
              {/* What the rule does, on three made-up papers. */}
              <div className="space-y-2 bg-inset px-4 py-3">
                {/* The examples show as many votes as a paper gets here. With nobody on it yet there are none to show. */}
                {/* Someone invited by email is counted: the rule waits for their vote as for anyone's. */}
                {models.length + readersFor(draft.rule.each === "all" ? "all" : Number(draft.rule.each), readers) ? (
                  <>
                    {/* As advice the models' votes show on the papers, but the people's are the ones the examples count. */}
                    <p className="text-xs text-muted-foreground">{t("decided.withVotes", { count: (draft.rule.models === "advice" && readers && draft.rule.settle !== "one" ? 0 : models.length) + readersFor(draft.rule.each === "all" ? "all" : Number(draft.rule.each), readers) })}</p>
                    <RuleExamples rule={draft.rule} people={readers} models={draft.rule.models === "advice" && readers && draft.rule.settle !== "one" ? 0 : models.length} />
                  </>
                ) : <p className="text-xs text-muted-foreground">{t("decided.addReviewer")}</p>}
              </div>
            </div>
            {draft.rule.settle === "one" && models.length ? <p className="rounded-2xl bg-inset px-4 py-2.5 text-sm text-muted-foreground">{t("decided.modelSettles")}</p> : null}
          </Section>

          <Section
            id="goes-to"
            title={t("part.goesTo")}
            help={<><Help title={t("part.goesTo")}>{t("goesHelp")}</Help>{changed("goes-to")}</>}
            aside={communities.libraries.length || there ? <Segmented className="fade-enter" label={t("part.goesTo")} value={there ? "community" : "openscholar"} onChange={(next) => (next === "openscholar" ? toOwn() : community ? toCommunity(community.libraryId) : undefined)} options={[{ id: "openscholar" as const, label: t("goes.yourLibrary") }, { id: "community" as const, label: t("goes.aCommunity") }]} /> : undefined}
          >
            {there && community ? <LibrarySelect libraries={communities.libraries} value={community.libraryId} onChange={(libraryId) => toCommunity(libraryId)} /> : null}
            {/* The collections arrive after the page: the list slides to its length instead of pushing what is under it. */}
            <AutoHeight>
            <div className={cn(LIST, "bg-card")} role="radiogroup" aria-label={t("part.goesTo")}>
              {there ? (communities.loaded ? communityPlaces : <ListRowsSkeleton rows={3} height={57} label={t("goes.readingCommunity")} />) : places}
            </div>
            </AutoHeight>
            {fromCollection ? (
              <label className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-card px-4 py-3">
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="block truncate text-sm font-medium">{t("goes.prune", { name: fromCollection.name })}</span>
                  <span className="flex flex-wrap gap-1.5"><Chip icon={X}>{t("goes.excludedLeave")}</Chip><Chip>{t("goes.othersStay")}</Chip></span>
                </span>
                <Switch checked={draft.destination.prune} onCheckedChange={(prune) => set({ destination: { ...draft.destination, prune } })} aria-label={t("goes.prune", { name: fromCollection.name })} />
              </label>
            ) : null}
          </Section>
        </div>

        {/* What it comes to: a well beside the form, in view while the form scrolls. */}
        <aside id="summary" aria-label={t("summaryLabel")} className={cn("min-w-0 border-border-subtle bg-inset/60 @max-6xl:border-t @6xl:border-s", BELOW_HEADER)}>
          <StickyColumn clear={fresh || dirty ? "5rem" : "1rem"} className="space-y-6 p-4 sm:p-6">
            {/* What saving will do, before it is done, and after it what the save did, until the next edit. Each line opens the part of the form it is about. */}
            {!fresh ? (
              <Section
                id="changes"
                title={t("changes.title")}
                help={
                  <Help title={t("changes.helpTitle")} side="left" facts={<><HelpFact icon={Check}>{t("changes.factVotes")}</HelpFact><HelpFact>{t("changes.factRemoved")}</HelpFact></>}>
                    {t("changes.help")}
                  </Help>
                }
                aside={<>{dirty ? <StateChip tone="warning" icon={PenLine}>{t("unsavedCount", { count: edits.length })}</StateChip> : lastSave ? <Chip icon={Check}>{t("changes.savedNow")}</Chip> : null}<PastChanges /></>}
                className={cn("rounded-2xl border p-4 transition-colors", dirty ? "border-warning/30 bg-warning/5" : "border-border-subtle bg-card")}
              >
                {dirty || lastSave ? (
                  <>
                    <ul className="space-y-0.5">
                      {(dirty ? edits : lastSave!.edits).map((edit) => (
                        <li key={edit.text}>
                          <JumpLink to={edit.section} className="-mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-1 text-sm font-medium outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/50">
                            <PenLine aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", dirty ? "ink-warning" : "text-muted-foreground")} />
                            <span className="min-w-0 flex-1">{edit.text}</span>
                            <ChevronRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                          </JumpLink>
                        </li>
                      ))}
                    </ul>
                    <div className="space-y-2 border-t border-border-subtle pt-3">
                      <p className="text-xs font-medium text-muted-foreground">{dirty ? t("changes.willDo") : t("changes.did")}</p>
                      <EffectList lines={dirty ? lines : lastSave!.lines} moves={dirty ? moves : lastSave!.moves} none={known ? undefined : t("changes.counting")} screening={saved?.id} jump done={!dirty} />
                      {/* A change applies to the papers still open. Checking the settled ones again is asked for here, where the change would give some of them another result. */}
                      {dirty && (again > 0 || recheck) ? (
                        <label className="flex items-start gap-3 rounded-xl border border-border-subtle bg-card p-2.5 text-sm">
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{t("changes.recheck")}</span>
                            <span className="block text-xs text-muted-foreground">{recheck ? t("changes.recheckOn") : t("changes.recheckOff", { count: again })}</span>
                          </span>
                          <Switch checked={recheck} onCheckedChange={setRecheck} aria-label={t("changes.recheck")} />
                        </label>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("changes.none")}</p>
                )}
              </Section>
            ) : null}
            {saved?.checking ? (
              <div className="flex items-center gap-2.5 rounded-2xl bg-card px-3 py-2.5 text-sm">
                <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
                <span className="min-w-0 flex-1">{t("changes.checking")}</span>
                <Chip className="tabular-nums">{t("changes.checked", { done: words.num(saved.checking.done), of: saved.checking.of })}</Chip>
              </div>
            ) : lastSave && lastCheck && lastCheck.at > saved!.createdAt ? (
              <div className="flex items-center gap-2.5 rounded-2xl bg-primary/8 px-3 py-2.5 text-sm">
                <RefreshCw className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">{lastCheck.added ? t("changes.lastAdded", { count: lastCheck.added }) : t("changes.lastNothing")}</span>
                {lastCheck.added ? <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs"><NextLink href={papersHref(saved!.id, { added: lastCheck.id })}>{t("changes.seePapers", { count: lastCheck.added })}<ChevronRight /></NextLink></Button> : null}
              </div>
            ) : null}

            {/* One line for each part of the form: each opens its part, and one that stops the start says so. */}
            <nav aria-label={t("changes.partsNav")} className={cn(LIST, "bg-card")}>
              {summary.map((line) => (
                <JumpLink key={line.id} to={line.id} className="flex items-center gap-3 px-3.5 py-2.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
                  {line.problem ? <TriangleAlert aria-label={t("neededToStart")} className="mt-0.5 size-4 shrink-0 self-start ink-warning" /> : line.unset ? <Minus aria-hidden className="mt-0.5 size-4 shrink-0 self-start text-muted-foreground opacity-60" /> : <Check aria-hidden className="mt-0.5 size-4 shrink-0 self-start text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted-foreground">{line.label}</span>
                    <span className="block truncate text-sm font-medium">{line.value}</span>
                  </span>
                  {line.aside}
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </JumpLink>
              ))}
            </nav>

            <Section
              title={t("cost.title")}
              help={
                <>
                  <Help title={t("cost.helpTitle")} side="left" facts={<><HelpFact>{t("cost.factPeople")}</HelpFact>{setup ? <HelpFact>{t("cost.factAtOnce", { count: setup.limits.atOnce })}</HelpFact> : null}</>}>
                    <p>{t("cost.help", { atOnce: setup ? words.num(setup.limits.atOnce) : "none" })}</p>
                    {models.length && draft.living ? <p>{t("cost.helpLiving")}</p> : null}
                  </Help>
                  {paused ? <StateChip tone="warning" icon={MODELS_SAY.paused.icon} className="ms-1.5 h-5 px-1.5">{pieces("modelsSay.paused.row")}</StateChip> : null}
                </>
              }
            >
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{t("cost.people")}</span><span className="text-muted-foreground">{t("cost.free")}</span></div>
                {models.map((model) => (
                  // The row opens the model's row under Reviewers, where a paper it couldn't read opens on the Papers page.
                  <JumpLink key={model.id} to={`reviewer-${model.id}`} block="center" className="-mx-1.5 flex min-h-7 items-center gap-2 rounded-md px-1.5 py-0.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
                    <ReviewerMark reviewer={model} className="size-5" />
                    <span className="min-w-0 truncate">{model.name}</span>
                    {!fresh && unreadBy(model) ? <StateChip tone="destructive" icon={TriangleAlert} className="h-5 px-1.5">{unreadText(unreadBy(model))}</StateChip> : allRead(model) ? <Chip icon={Check} className="h-5 px-1.5">{t("reviewers.allRead")}</Chip> : null}
                    <span className="ms-auto shrink-0 text-end tabular-nums">{due(model) ? t("cost.credits", { credits: words.credits(due(model)) }) : fresh ? <span className="text-muted-foreground">{t("cost.noPapers")}</span> : null}</span>
                  </JumpLink>
                ))}
                {pdfs.papers && models.length ? <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><FileText aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>{t("cost.pdfsRead", { count: pdfs.papers, pages: pdfs.pages, capped: String(Boolean(pdfCost)), credits: words.credits(pdfCost) })}</span></p> : null}
                {pdfsUnpriced ? <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><FileText aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>{t("cost.pdfsUnpriced")}</span></p> : null}
                {handedPdfs && lookCredits ? <div className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1">{t("cost.firstReading", { count: handedPdfs })}</span><span className="shrink-0 text-end tabular-nums text-muted-foreground">{t("cost.upTo", { credits: words.credits(handedPdfs * lookCredits) })}</span></div> : null}
                {reread ? <div className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1">{added ? t("cost.answering", { count: draft.criteria.filter((criterion) => !saved?.criteria.some((one) => one.key === criterion.key)).length }) : t("cost.rereading")}</span><span className="shrink-0 tabular-nums">{t("cost.credits", { credits: words.credits(reread) })}</span></div> : null}
                <div className="flex items-center gap-2 border-t border-border-subtle pt-2.5 text-sm font-semibold"><Coins className="size-4 text-primary" /><span className="flex-1">{fresh ? t("cost.atMost", { still: String(Boolean(handedPdfs && lookCredits)), soFar }) : paused ? t("cost.resumed") : t("cost.still")}</span><span className="shrink-0 text-end tabular-nums">{cost || fresh ? t("cost.credits", { credits: words.credits(cost) }) : t("cost.nothing")}</span></div>
                <div role="img" aria-label={cost > wallet ? t("cost.overWallet", { credits: words.credits(cost - wallet) }) : t("cost.walletShare", { share: format.number(Math.round((cost / Math.max(wallet, 1)) * 100) / 100, { style: "percent" }) })}>
                  <Meter value={cost} max={Math.max(wallet, 1)} fill={cost > wallet ? "bg-warning" : "bg-primary"} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {cost && cost <= wallet ? <span className="text-xs tabular-nums text-muted-foreground">{cost / Math.max(wallet, 1) < 0.01 ? t("cost.shareOf", { under: "true", share: format.number(0.01, { style: "percent" }) }) : t("cost.shareOf", { under: "false", share: format.number(Math.round((cost / Math.max(wallet, 1)) * 100) / 100, { style: "percent" }) })}</span> : null}
                  <WorkspaceTag size="sm" workspace={saved ? lookOf(saved.workspace) : (here ?? { kind: "personal", name: workspace.name })}>{t("cost.inWorkspace", { credits: words.credits(wallet), workspace: workspace.name, own: String((saved ? saved.workspace.kind : here?.kind) === "personal" && (!saved || Boolean(open?.canChange))) })}</WorkspaceTag>
                  {cost > wallet ? <StateChip tone="warning" icon={Coins}>{t("block.creditsShort", { credits: words.credits(cost - wallet) })}</StateChip> : cost ? <Chip>{t("cost.leftAfter", { credits: words.credits(wallet - cost) })}</Chip> : null}
                  {spentSoFar ? <Chip>{t("cost.spent", { credits: words.credits(spentSoFar) })}</Chip> : null}
                  {/* In the same run of chips, so the column stays short enough to stay in view. */}
                  {models.length && draft.living ? (
                    <>
                    <Chip icon={RefreshCw}>{t("living.perNew", { credits: words.credits(perNew), pdf: String(pdfsCome) })}</Chip>
                    {lastCheck?.added ? <Chip icon={Coins}>{t("living.lastSpent", { spent: words.credits(lastCheck.added * perNew), count: lastCheck.added })}</Chip> : null}
                    </>
                  ) : null}
                </div>
                {ahead_ && models.length ? <LinkChip href={overviewHref(ahead_.id)} icon={MODELS_SAY.waiting.icon} className="w-fit max-w-full [&>span]:shrink">{pieces.rich("modelsSay.waiting.says", { name: ahead_.name, link: (chunks) => chunks })}</LinkChip> : null}
              </div>
            </Section>

          </StickyColumn>
        </aside>
      </div>

      {/* The page's one action, at the foot of the window: what starting does, and why it can't yet. */}
      {fresh ? (
        <ActionBar>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 max-lg:pe-[5.5rem]">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-0.5">
              <span className="text-sm">{t.rich("bar.toScreen", { count: papers, soFar, n: () => <span className="text-lg font-semibold tabular-nums"><AnimatedNumber value={papers} /></span>, m: (chunks) => <span className="text-muted-foreground">{chunks}</span> })}</span>
              <span className="text-sm">{models.length ? t.rich("bar.cost", { still: String(Boolean(handedPdfs && lookCredits)), soFar, credits: words.credits(cost), m: (chunks) => <span className="text-muted-foreground">{chunks}</span>, b: (chunks) => <span className="font-semibold tabular-nums">{chunks}</span> }) : <span className="text-muted-foreground">{t("bar.peopleOnly", { handed: String(Boolean(handedPdfs && lookCredits)) })}</span>}</span>
            </div>
            <div className="ms-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
              {stop ? <Blocker block={stop} /> : refused ? <p role="alert" className="flex max-w-md items-start gap-1.5 text-sm font-medium ink-destructive"><TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{refused}</p> : null}
              {stop && cost > wallet ? <Button asChild variant="outline"><NextLink href="/settings/billing"><Coins />{t("bar.addCredits")}</NextLink></Button> : null}
              <Button disabled={Boolean(stop)} onClick={start}><ListChecks />{t("bar.start")}</Button>
            </div>
          </div>
        </ActionBar>
      ) : dirty ? (
        // While anything is unsaved: how much, what stops the save, and the three things to do about it. It rises in from the window's foot.
        <ActionBar className="animate-in fade-in slide-in-from-bottom-4 duration-300 motion-reduce:animate-none">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6 max-lg:pe-[5.5rem]">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <PenLine aria-hidden className="size-4 shrink-0 ink-warning" />{unsaved}
              {/* Papers that saving moves to another result are said here, where Save is: the summary that lists them can be far from it. */}
              {moved ? <StateChip tone="warning">{t("bar.moved", { count: moved })}</StateChip> : null}
              <Button asChild variant="ghost" size="sm" className="h-8"><JumpLink to="changes" find={() => document.getElementById("summary")}>{t("bar.review")}</JumpLink></Button>
            </span>
            {holdUp ? <Blocker block={holdUp} /> : null}
            <div className="ms-auto flex items-center gap-2">
              <Button variant="ghost" onClick={() => setDiscarding(edits)}>{t("bar.discard")}</Button>
              <Button disabled={Boolean(holdUp)} onClick={save}><Check />{t("bar.save")}</Button>
            </div>
          </div>
        </ActionBar>
      ) : null}
      <ConfirmChange open={discarding !== null} title={t("bar.discardTitle", { count: discarding?.length ?? 0 })} confirm={t("bar.discard")} cancel={t("bar.keepEditing")} variant="destructive" onClose={() => setDiscarding(null)} onConfirm={discard}>
        <ul className="space-y-1.5">
          {discarding?.map((edit) => <li key={edit.text} className="flex items-start gap-2 text-sm"><PenLine aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{edit.text}</li>)}
        </ul>
      </ConfirmChange>
    </>
  );
  // A screening's settings are a page of its frame, which has the header, the trail and the page tabs. A new screening has no frame yet.
  if (!fresh) return body;
  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        <div className={`contents ${AVATARS_FADE_IN}`}>
          <LibraryPageShell
            wide
            icon={ListChecks}
            title={t("page.title")}
            trail={[crumb]}
            titleAside={<Help title={t("page.helpTitle")} side="bottom" facts={<><HelpFact>{t("page.factRead")}</HelpFact><HelpFact>{t("page.factWho")}</HelpFact></>}>{t("page.help")}</Help>}
          >
            {body}
          </LibraryPageShell>
        </div>
      </PageWrapper>
    </MotionConfig>
  );
}

type Block = { text: string; section?: "papers" | "reviewers" | "criteria"; focus?: string };
/** Why the form can't be started or saved yet. One that names a section opens it and puts the cursor on the control that fixes it. */
function Blocker({ block }: { block: Block }) {
  const says = <><TriangleAlert aria-hidden className="size-4 shrink-0" />{block.text}</>;
  if (!block.section) return <span className="flex items-center gap-1.5 text-sm font-medium ink-warning">{says}</span>;
  return <JumpLink to={block.section} find={() => (block.focus ? document.querySelector<HTMLElement>(block.focus) : null)} block="center" className="flex items-center gap-1.5 rounded text-sm font-medium ink-warning outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">{says}</JumpLink>;
}

/** A reviewer on the screening, a person or a model, as the same row: what they are to it, what they cost, and the way to take them off. The summary's cost lines open a model's row. */
function ReviewerRow({ reviewer, you, detail, chips, href, gone, onRemove, onKeep }: { reviewer: Reviewer; you: boolean; detail: string; chips?: ReactNode; /** Their votes on the Papers page, for someone already on the screening. */ href?: string; /** Removed in the form and not saved yet: struck through, with Keep. */ gone: boolean; onRemove: () => void; onKeep: () => void }) {
  const t = useTranslations("screening.form");
  // Removed here and not saved yet: the chip beside the name says so, and the name carries no "Taken off" of its own.
  const name = <ReviewerName reviewer={gone ? { ...reviewer, left: undefined } : reviewer} you={you} className={cn("text-sm font-medium", gone && "text-muted-foreground line-through")} />;
  return (
    <motion.div id={`reviewer-${reviewer.id}`} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", BELOW_HEADER, DIVIDED_ROW)}>
      <div className={cn("flex min-h-14 items-center gap-x-3 gap-y-2 px-4 py-2.5 transition-colors max-sm:flex-wrap", gone && TONE.warning.panel)}>
        <ReviewerMark reviewer={reviewer} className="size-9 self-start" />
        {/* The name keeps its room: where the chips beside it are many, they run onto a second line among themselves. */}
        <div className="min-w-40 flex-1">
          {href && !gone ? <NextLink href={href} className="flex w-fit max-w-full rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">{name}</NextLink> : name}
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
        {/* On a phone the chips take a line of their own under the name. */}
        {chips ? <span className="flex min-w-0 shrink flex-wrap items-center justify-end gap-1.5 max-sm:order-last max-sm:basis-full max-sm:justify-start max-sm:ps-12">{chips}</span> : null}
        {gone ? (
          <Button variant="ghost" size="sm" className="h-8" onClick={onKeep}><Undo2 />{t("papers.keep")}</Button>
        ) : (
          <TooltipHint label={t("papers.remove", { name: reviewer.name })}><Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={t("papers.remove", { name: reviewer.name })} onClick={onRemove}><Trash2 /></Button></TooltipHint>
        )}
      </div>
    </motion.div>
  );
}

/** One choice of the rule: its name and "?" on the left, and the choice on the right with a live figure beside it where there is one. */
function RuleRow({ name, help, detail, children }: { name: string; help: ReactNode; detail?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <p className="flex min-w-48 flex-1 items-center gap-1 text-sm font-medium">{name}{help}</p>
      {detail ? <Chip>{detail}</Chip> : null}
      {children}
    </div>
  );
}

/** One place the included papers can go, as a radio row. `below` is what the choice asks for once picked, under the row. */
function Destination({ on, onPick, icon: Icon, name, facts, below }: { on: boolean; onPick: () => void; icon: AppIcon; name: string; facts?: ReactNode; below?: ReactNode }) {
  return (
    <div className={cn("transition-colors", on && "bg-primary/5")}>
      <div role="radio" aria-checked={on} tabIndex={0} onClick={onPick} onKeyDown={(event) => (event.key === " " || event.key === "Enter") && event.target === event.currentTarget && onPick()} className={cn("flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", !on && "hover:bg-muted")}>
        {/* The icon sits on the name's line: on a phone, where the name runs onto a second line and its count goes under it, it stays on the first. */}
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <span className="flex h-5 shrink-0 items-center"><Icon className={cn("size-4", on ? "text-primary" : "text-muted-foreground")} /></span>
          <div className="flex min-w-0 flex-1 items-center gap-3 max-sm:flex-col max-sm:items-start max-sm:gap-1">
            <span className="min-w-0 max-w-full truncate text-sm font-medium sm:flex-1 max-sm:line-clamp-2 max-sm:whitespace-normal">{name}</span>
            {facts}
          </div>
        </div>
        <PickMark on={on} />
      </div>
      {below}
    </div>
  );
}

/** Opens the screening's record of past changes. A screening's settings are inside its frame, which has that record. */
function PastChanges() {
  const frame = useFrame();
  const t = useTranslations("screening.form");
  return <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={frame?.openActivity}>{t("changes.activity")}</Button>;
}

/** Whoever settles conflicts where nobody else can be picked: the person who started the screening. */
function Settler({ person, you }: { person: Person | undefined; you: boolean }) {
  if (!person) return null;
  const reviewer = personReviewer(person, 0);
  return <span className="flex items-center gap-2 text-sm"><ReviewerMark reviewer={reviewer} className="size-5" /><ReviewerName reviewer={reviewer} you={you} /></span>;
}

/** The most words one criterion marks (convex/screening/validators.ts `MAX_TERMS`). */
const MAX_TERMS = 20;
/**
 * The words a criterion marks in each abstract for whoever votes, typed with commas between them. What is typed
 * stays here while the field has the keyboard, so a comma just typed isn't taken away.
 */
function MarkedWords({ criterion, n, onChange }: { criterion: Criterion; n: number; onChange: (terms: string[]) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  const t = useTranslations("screening.form");
  const read = (text: string) => [...new Set(text.split(",").map((term) => term.trim()).filter(Boolean))].slice(0, MAX_TERMS);
  return (
    <div className="mt-1.5 flex items-start gap-1 ps-1 text-muted-foreground">
      <Highlighter aria-hidden className="mt-1 size-3.5 shrink-0" />
      <Textarea rows={1} value={typing ?? criterion.terms.join(", ")} onChange={(event) => { setTyping(event.target.value); onChange(read(event.target.value)); }} onBlur={() => setTyping(null)} aria-label={t("criteria.wordsFor", { n })} placeholder={t("criteria.wordsPlaceholder")} className="min-h-0 min-w-0 flex-1 resize-none border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground shadow-none field-sizing-content placeholder-shown:border-dashed placeholder-shown:border-border hover:border-border-subtle" />
    </div>
  );
}

/** Rows one page of what a source left out holds. */
/** The kinds of source whose first papers can be read from any place in them before the screening is (convex/screening/sampling.ts). */
const SAMPLED = new Set<Source["kind"]>(["search", "collection", "saved", "screening", "zotero", "evidenceLibrary"]);
const SAMPLE = 3;
/**
 * The first papers a source's range takes, read from the source as the range is set: which papers these are is what
 * a range is picked by. The list keeps its lines' height from the first frame, and the titles fade in over it.
 */
function SampleTitles({ set, sourceId, first, taken }: { set: NonNullable<Source["set"]>; /** The source's row, once the screening reads it. */ sourceId?: Id<"screeningSources">; first: number; taken: number }) {
  const t = useTranslations("screening.form");
  const read = useWorkspaceAction(api.screening.sampling.sample);
  // A range dragged by its slider is read once it rests.
  const at = useDebouncedValue(first, 400);
  const lines = Math.min(SAMPLE, taken);
  const titles = useSWR(["screening-sample", JSON.stringify(set), at], () => read({ set: set as never, first: at, ...(sourceId ? { sourceId } : {}) }), { revalidateOnFocus: false, keepPreviousData: true });
  // A source that can't be read at this place shows none, and takes no room for them.
  if (titles.data && !titles.data.length) return null;
  if (titles.error) return null;
  return (
    <ul aria-label={t("papers.firstPapers")} className={cn("space-y-1 border-t border-border-subtle pt-3 transition-opacity duration-300", (!titles.data || at !== first) && "opacity-50")} style={{ minHeight: `calc(${lines + (taken > lines ? 1 : 0)} * 1.25rem + 0.5rem)` }}>
      {(titles.data ?? []).slice(0, lines).map((paper, i) => (
        <li key={i} className="flex min-w-0 animate-in fade-in text-xs duration-300">
          <span className="truncate text-muted-foreground">{paper.year ? t("papers.titleYear", { title: paper.title, year: String(paper.year) }) : paper.title}</span>
        </li>
      ))}
      {titles.data && taken > titles.data.length ? <li className="text-xs text-muted-foreground">{t("papers.andMore", { count: taken - Math.min(lines, titles.data.length) })}</li> : null}
    </ul>
  );
}

const LEFT_PAGE = 8;

/**
 * The records a source held that the screening already had, a page at a time: each with the source whose record
 * stands for it, which opens that paper once the screening is running.
 */
function Merged({ jobId, sourceId, total, open, sources }: { jobId: Id<"screeningJobs">; sourceId: Id<"screeningSources">; total: number; /** The running screening, whose papers open. */ open: string | null; sources: Source[] }) {
  const t = useTranslations("screening.form");
  const rows = useCursorPage(api.screening.view.merged, inWorkspace(usePageWorkspace(), { jobId, sourceId }), LEFT_PAGE);
  return (
    <div className="space-y-2">
      {/* The list holds its rows' height from the first frame: how many there are is known before they are read. */}
      {rows.isLoading ? <ListRowsSkeleton rows={Math.min(total, LEFT_PAGE)} height={45} icon={false} label={t("papers.loadingList")} className="[&>div]:px-0" /> : (
      <ul className={cn("divide-y divide-border-subtle transition-opacity", rows.isStale && "pointer-events-none opacity-60")} style={{ minHeight: Math.min(total, LEFT_PAGE) * 45 }}>
        {rows.items.map((row) => {
          // The source that brought the paper this record is the same as: another one, or this one where it lists the paper more than once.
          const from = row.paper?.sourceId === sourceId ? t("papers.mergedSame") : row.paper ? t("papers.mergedFrom", { source: sources.find((one) => one.id === row.paper!.sourceId)?.name ?? t("papers.mergedElsewhere") }) : t("papers.mergedGone");
          return (
            <li key={row.id} className="flex min-h-11 items-center gap-x-3 gap-y-1 py-1.5 max-sm:flex-wrap">
              <p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere] max-sm:basis-full">{row.name}</p>
              {row.paper && open ? <LinkChip href={papersHref(open, { paper: row.paper.id })} className="max-w-64 shrink-0 self-start"><span className="truncate">{from}</span></LinkChip> : <Chip className="max-w-64 shrink-0 self-start"><span className="truncate">{from}</span></Chip>}
            </li>
          );
        })}
      </ul>
      )}
      {/* Its pager is there from the first frame where the count says there is more than a page. */}
      {rows.hasPages || (rows.isLoading && total > LEFT_PAGE) ? <CommandCenterPagination className="pt-1" currentPage={rows.page} itemLabel={t("papers.pagerMerged")} steps={{ canPrevious: rows.canPrevious, canNext: rows.canNext, onPrevious: rows.previous, onNext: rows.next, offset: rows.offset, shown: rows.isLoading ? Math.min(total, LEFT_PAGE) : rows.items.length, total, pageCount: Math.ceil(total / LEFT_PAGE) }} /> : null}
    </div>
  );
}
/** What one of a running screening's sources held and didn't take, a page at a time, each with why. */
function LeftOut({ jobId, sourceId, total }: { jobId: Id<"screeningJobs">; sourceId: Id<"screeningSources">; total: number }) {
  const t = useTranslations("screening.form");
  const words = useWords();
  const rows = useCursorPage(api.screening.view.leftOut, inWorkspace(usePageWorkspace(), { jobId, sourceId }), LEFT_PAGE);
  return (
    <div className="space-y-2">
      {/* The list holds its rows' height from the first frame: how many there are is known before they are read. */}
      {rows.isLoading ? <ListRowsSkeleton rows={Math.min(total, LEFT_PAGE)} height={45} icon={false} label={t("papers.loadingList")} className="[&>div]:px-0" /> : (
      <ul className={cn("divide-y divide-border-subtle transition-opacity", rows.isStale && "pointer-events-none opacity-60")} style={{ minHeight: Math.min(total, LEFT_PAGE) * 45 }}>
        {rows.items.map((row) => (
          <li key={row.id} className="flex min-h-11 items-center gap-x-3 gap-y-1 py-1.5 max-sm:flex-wrap">
            {/* A title is read in full here: this list is where someone finds out what was left out. */}
            <p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere] max-sm:basis-full">{row.name}</p>
            <StateChip tone="warning" icon={FileX} className="shrink-0 self-start">{words.t(`leftWhy.${row.why}`)}</StateChip>
          </li>
        ))}
      </ul>
      )}
      {rows.hasPages || (rows.isLoading && total > LEFT_PAGE) ? <CommandCenterPagination className="pt-1" currentPage={rows.page} itemLabel={t("papers.pagerLeftOut")} steps={{ canPrevious: rows.canPrevious, canNext: rows.canNext, onPrevious: rows.previous, onNext: rows.next, offset: rows.offset, shown: rows.isLoading ? Math.min(total, LEFT_PAGE) : rows.items.length, total, pageCount: Math.ceil(total / LEFT_PAGE) }} /> : null}
    </div>
  );
}
