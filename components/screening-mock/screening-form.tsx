"use client";

// A screening's form: where its papers come from, the criteria, who reads them, how a paper is
// decided and where the included ones go. A new screening starts from it, and a running or finished
// one is changed with the same form, which says what each change will do before it is saved.

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useConvex } from "convex/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import useSWR from "swr";
import { GitCompare, AiIcon, Ban, Check, ChevronDown, ChevronRight, CircleHelp, Clock, Coins, Copy, ExternalLink, FileX, Folder, FolderPlus, Highlighter, ListChecks, Lock, Minus, MoreHorizontal, PenLine, Plus, RefreshCw, Search, Trash2, TriangleAlert, Undo2, UserPlus, X, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { ListEmpty, ListLoading } from "@/components/evidence-libraries/list-controls";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { AnimatedNumber, Chip, Meter, SOURCE_ICON } from "@/components/screening/parts";
import { PaperScope, PickMark } from "@/components/screening/source-row";
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
import { useCurrentWorkspace, WorkspaceTag } from "@/components/workspaces/parts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useGenerateScreeningCriteria } from "@/lib/ai/client/router";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useSearchList } from "@/lib/research/search-list";
import { useSearchHistoryStore } from "@/lib/store";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import type { SearchResult } from "@/lib/types/search.types";
import { cn } from "@/lib/utils";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace as usePageWorkspace, useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { LEFT_WHY, leftOf, leftTotal, personIn, listed, num, PERSON_SAYS, SETTLE_LABEL, foundTotal, grown, hash, readersOf, firstName, plural, EVERY_LABEL, GROWS, PERIOD, SHORT_NAME_LENGTH, baseTotal, day, growing, activeReviewers, defaultRule, defaultScoring, invitedReviewer, modelKey, modelReviewer, modelsOf, paperTotal, peopleOf, personReviewer, shortOf, taken, type Criterion, type Person, type Reviewer, type Screening, type Source, lookOf, includedIn, inQuotes, inOrder, standsTo } from "./data";
import { useSharing } from "./dialogs";
import { useKept } from "./drafts";
import { EffectList, JumpLink, NO_PREVIEW, criterionName, effectItems, landOn, movesText, scoringChanged, type EffectLine, type EffectSection, type Move, type Preview } from "./effects";
import { collectionName } from "./form-data";
import { SCREENINGS_CRUMB, overviewHref, papersHref } from "./links";
import { OfferRow } from "./sources";
import { youFirst, EmptyNote, ActionBar, BELOW_HEADER, DIVIDED_ROW, Help, kindIcon, LinkChip, Named, Panel, ReviewerMark, ReviewerName, Section, StateChip, StickyColumn, RuleExamples, TONE, MODELS_SAY, INLINE_LINK } from "./parts";
import { credits, paperCredits, perPaper, useOpenScreening } from "./store";
import { AddModel, AddPerson, ConfirmChange } from "./team";
import { useFrame } from "./workspace";
import { ScrollArea } from "@/components/ui/scroll-area";

// The whole library and its collections are one place to a person, so they share a tab.
type Kind = "search" | "collection" | "screening";
const KINDS: Array<{ id: Kind; label: string; icon: AppIcon; find?: string }> = [
  { id: "search", label: "Search", icon: SOURCE_ICON.search },
  { id: "collection", label: "Library", icon: SOURCE_ICON.saved, find: "Find a collection" },
  { id: "screening", label: "Screening", icon: SOURCE_ICON.screening },
];
const OFFER_PAGE = 5;
/** Collections one page of the places included papers can go holds. */
const DESTINATION_PAGE = 6;
/** Something a tab offers to add: what the server reads it from, the name its list gave it, and how many papers that list counted. `ref` tells two apart where they share a name. */
type Offer = { ref: string; name: string; detail: string; total: number; set: NonNullable<Source["set"]>; filters?: string[]; questions?: string[] };
/** A list read a page at a time, as its pager needs it. */
type Pager = { page: number; canPrevious: boolean; canNext: boolean; hasPages: boolean; previous: () => void; next: () => void; offset: number; items: unknown[]; isStale: boolean };

/** What a screening is set up as: a change here is a change to its settings, which a vote is not. */
const SETTINGS = ["name", "question", "sources", "criteria", "reviewers", "rule", "scoring", "destination", "living"] as const;
const settingOf = (screening: Screening, field: (typeof SETTINGS)[number]) =>
  JSON.stringify(
    field === "living" ? screening.living?.every
    : field === "reviewers" ? activeReviewers(screening).map((one) => [one.kind === "model" && one.model ? modelKey(one.model) : one.id, one.discarded ?? null])
    : field === "sources" ? screening.sources.map((source) => [source.id, source.scope, source.scope === "range" ? source.range : null])
    : screening[field],
  );
const settingsOf = (screening: Screening) => SETTINGS.map((field) => settingOf(screening, field)).join();

/** A criterion as the server takes it: one the form made has no key there yet. */
const criterionOf = (screening: Screening) => (criterion: Criterion) => {
  const [yes, no, unclear] = screening.scoring.points[criterion.key] ?? [1, 0, 0];
  return { ...(criterion.key.startsWith("new:") ? {} : { key: criterion.key }), text: criterion.text, short: criterion.short, must: criterion.must, ...(criterion.note?.trim() ? { note: criterion.note.trim() } : {}), terms: criterion.terms, points: { yes, no, unclear } };
};
const ruleOf = (screening: Screening, members: Reviewer[]) => ({ each: screening.rule.each === "all" ? ("all" as const) : Number(screening.rule.each), settle: screening.rule.settle, blind: screening.rule.blind, ...(members.some((one) => one.id === screening.rule.resolver) ? { resolver: screening.rule.resolver as Id<"users"> } : {}) });
const sourceOf = (source: Source) => ({ set: source.set as never, name: source.name, ...(source.detail ? { detail: source.detail } : {}), ...(source.scope === "range" ? { first: source.range[0], last: source.range[1] } : {}) });
const saveToOf = (screening: Screening) =>
  screening.destination.kind === "none" ? { kind: "none" as const }
  : screening.destination.kind === "collection" && screening.destination.collection ? { kind: "collection" as const, collectionId: screening.destination.collection as Id<"collections"> }
  : { kind: "new" as const, name: screening.destination.name.trim() || includedIn(screening.name) };
/** The members of the workspace among a screening's people: someone from outside joins by sharing, once it is there to share. */
const membersOf = (screening: Screening) => activeReviewers(screening).filter((one) => one.kind === "person" && !one.guest && !one.email);
const modelOf = (reviewer: Reviewer) => ({ model: reviewer.model!.id, ...(reviewer.model!.effort ? { effort: reviewer.model!.effort } : {}) });

/** A new screening as the server starts it. */
function setupOf(draft: Screening) {
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
    saveTo: saveToOf(draft),
    ...(draft.destination.prune ? { prune: true } : {}),
    ...(draft.living ? { living: draft.living.every } : {}),
  };
}

/**
 * What a save changes on a running screening, as the server takes it: only the parts the form changed. The preview
 * of what it does and the save itself are given the same one, so they never differ.
 */
function changeOf(saved: Screening, draft: Screening, recheck: boolean) {
  const differs = (field: (typeof SETTINGS)[number]) => settingOf(saved, field) !== settingOf(draft, field);
  const [was, is] = [activeReviewers(saved), activeReviewers(draft)];
  const on = (list: Reviewer[], one: Reviewer) => list.some((other) => other.id === one.id);
  const joining = is.filter((one) => !on(was, one));
  const leaving = was.filter((one) => !on(is, one) && one.row);
  const ranged = draft.sources.filter((source) => { const before = saved.sources.find((one) => one.id === source.id); return before && (before.scope !== source.scope || before.range.join() !== source.range.join()); });
  return {
    ...(differs("name") ? { name: draft.name } : {}),
    ...(differs("question") ? { question: draft.question } : {}),
    ...(differs("criteria") || differs("scoring") ? { criteria: draft.criteria.map(criterionOf(draft)), stars: draft.scoring.stars } : {}),
    ...(differs("rule") ? { rule: ruleOf(draft, membersOf(draft)) } : {}),
    ...(differs("living") ? { living: draft.living?.every ?? null } : {}),
    ...(differs("destination") ? { saveTo: saveToOf(draft), prune: draft.destination.prune } : {}),
    ...(draft.sources.some((source) => !saved.sources.some((one) => one.id === source.id)) ? { addSources: draft.sources.filter((source) => !saved.sources.some((one) => one.id === source.id)).map(sourceOf) } : {}),
    ...(saved.sources.some((source) => !draft.sources.some((one) => one.id === source.id)) ? { removeSources: saved.sources.filter((source) => !draft.sources.some((one) => one.id === source.id)).map((source) => source.id as Id<"screeningSources">) } : {}),
    ...(ranged.length ? { ranges: ranged.map((source) => ({ sourceId: source.id as Id<"screeningSources">, ...(source.scope === "range" ? { first: source.range[0], last: source.range[1] } : {}) })) } : {}),
    ...(joining.some((one) => one.kind === "person" && !one.guest && !one.email) ? { addPeople: joining.filter((one) => one.kind === "person" && !one.guest && !one.email).map((one) => one.id as Id<"users">) } : {}),
    ...(joining.some((one) => one.kind === "model") ? { addModels: joining.filter((one) => one.kind === "model").map(modelOf) } : {}),
    ...(leaving.length ? { remove: leaving.map((one) => ({ reviewerId: one.row!, ...(draft.reviewers.find((now) => now.id === one.id)?.discarded && !one.discarded ? { discard: true } : {}) })) } : {}),
    ...(recheck ? { recheck: true } : {}),
  };
}

/** Where a source can be read as it stands, in a new tab: a search runs again, a collection opens where it lives, a screening opens its included papers. A file or pasted DOIs have nowhere to open. */
function sourceLink(source: Pick<Source, "set">): { href: string; where: string } | null {
  const set = source.set;
  if (!set) return null;
  if (set.kind === "search") return { href: `/results/${encodeURIComponent(set.searchId)}`, where: "in the search" };
  if (set.kind === "saved") return { href: "/library", where: "in your library" };
  if (set.kind === "collection") return { href: `/library?col=${set.collectionId}`, where: "in the collection" };
  if (set.kind === "screening") return { href: papersHref(set.jobId, { result: "include" }), where: "in the screening" };
  if (set.kind === "zotero") return { href: "https://www.zotero.org/mylibrary", where: "in Zotero" };
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
function changesOf(before: Screening, after: Screening): Edit[] {
  const parts: Edit[] = [];
  const push = (text: string, section: EffectSection) => parts.push({ text, section });
  // One or two by name, more as a count.
  const named = (list: string[], one: string, many: string) => (list.length > 2 ? `${list.length} ${many}` : list.length === 2 ? `${list[0]} and ${list[1]}` : (list[0] ?? one));
  const gone = <T extends { id?: string; key?: string }>(a: T[], b: T[]) => a.filter((x) => !b.some((y) => (y.id ?? y.key) === (x.id ?? x.key)));
  if (before.name !== after.name) push(`Renamed it to ${inQuotes(after.name.trim() || "Untitled screening")}`, "name");
  if (before.question !== after.question) push("Changed the research question", "name");
  const [newSources, oldSources] = [gone(after.sources, before.sources), gone(before.sources, after.sources)];
  if (newSources.length) push(`Added ${named(newSources.map((source) => source.name), "a source", "sources")}`, "papers");
  if (oldSources.length) push(`Removed ${named(oldSources.map((source) => source.name), "a source", "sources")}`, "papers");
  const ranged = before.sources.filter((source) => { const now = after.sources.find((one) => one.id === source.id); return now && taken(now) !== taken(source); });
  if (ranged.length) push(`Changed which papers ${named(ranged.map((source) => source.name), "a source", "sources")} ${ranged.length === 1 ? "brings" : "bring"}`, "papers");
  if (Boolean(before.living) !== Boolean(after.living)) push(after.living ? "Made it a living screening" : "Stopped checking for new papers", "new-papers");
  else if (before.living?.every !== after.living?.every) push("Changed how often it checks for new papers", "new-papers");
  const quoted = (list: Criterion[]) => list.map(criterionName);
  const [newCriteria, oldCriteria] = [gone(after.criteria, before.criteria), gone(before.criteria, after.criteria)];
  if (newCriteria.length) push(`Added ${named(quoted(newCriteria), "a criterion", "criteria")}`, "criteria");
  if (oldCriteria.length) push(`Removed ${named(quoted(oldCriteria), "a criterion", "criteria")}`, "criteria");
  const reworded = after.criteria.filter((criterion) => { const was = before.criteria.find((one) => one.key === criterion.key); return was && (was.must !== criterion.must || was.text !== criterion.text); });
  if (reworded.length) push(`Changed ${named(quoted(reworded), "a criterion", "criteria")}`, "criteria");
  const guided = after.criteria.filter((criterion) => { const was = before.criteria.find((one) => one.key === criterion.key); return was && (was.note ?? "") !== (criterion.note ?? ""); });
  if (guided.length) push(`Changed the guidance on ${named(quoted(guided), "a criterion", "criteria")}`, "criteria");
  // A short name that only followed its reworded question is part of that change, not one of its own.
  const own = (criterion: Criterion) => criterion.short === shortOf(criterion.text);
  const renamed = after.criteria.flatMap((criterion) => { const was = before.criteria.find((one) => one.key === criterion.key); return was && was.short !== criterion.short && !(own(was) && own(criterion)) ? [`${inQuotes(was.short)} to ${inQuotes(criterion.short)}`] : []; });
  if (renamed.length) push(`Renamed ${named(renamed, "a criterion", "criteria")}`, "criteria");
  if (scoringChanged(before, after)) push("Changed the scoring", "criteria");
  const [was, is] = [activeReviewers(before), activeReviewers(after)];
  if (gone(is, was).length) push(`Added ${named(gone(is, was).map((reviewer) => reviewer.name), "a reviewer", "reviewers")}`, "reviewers");
  if (gone(was, is).length) push(`Removed ${named(gone(was, is).map((reviewer) => reviewer.name), "a reviewer", "reviewers")}`, "reviewers");
  if (JSON.stringify(before.rule) !== JSON.stringify(after.rule)) push("Changed how a paper is decided", "decided");
  if (JSON.stringify(before.destination) !== JSON.stringify(after.destination)) {
    const renamed = before.destination.kind === "new" && after.destination.kind === "new" && !after.destination.collection;
    push(collectionName(before) === collectionName(after) ? "Changed where included papers go" : renamed ? `Renamed its collection to ${inQuotes(collectionName(after) ?? "")}` : `Included papers go to ${collectionName(after) ?? "no collection"}`, "goes-to");
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
  const field = useId();
  return (
    <div className={cn(SHORT_NAME, "flex items-center gap-2")}>
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground @3xl/criteria:hidden"><label htmlFor={field}>Short name</label>{/* The other rows keep the "?"'s room, so every field starts in line. */ help ?? <span aria-hidden className="size-5 shrink-0" />}</span>
      <Input
        id={field}
        value={typing ?? criterion.short}
        maxLength={SHORT_NAME_LENGTH}
        placeholder={shortOf(criterion.text)}
        aria-label={`Short name of criterion ${n}`}
        onChange={(event) => { setTyping(event.target.value); onChange(event.target.value.trim() || shortOf(criterion.text)); }}
        onBlur={() => setTyping(null)}
        className="h-8 min-w-0 flex-1 px-2 text-sm"
      />
    </div>
  );
}

export function ScreeningForm({ id }: { id?: string }) {
  const router = useWorkspaceRouter();
  const convex = useConvex();
  const workspaceId = usePageWorkspace();
  const here = useCurrentWorkspace();
  const [from] = useQueryState("from");
  // "Screen all" on a results page opens the form with that search picked and its questions as criteria.
  const [fromSearch] = useQueryState("search");
  // An open screening's settings sit in its frame, which has read it. A new one has no frame.
  const frame = useFrame();
  const saved = id ? frame?.open.screening : undefined;
  const open = id ? frame?.open : undefined;
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
    if (!copied) return start;
    const mine = (one: Reviewer) => one.kind === "model" || !one.guest;
    return { ...start, name: `${copied.name}, again`, question: copied.question, sources: copied.sources.filter((source) => source.set).map((source) => ({ ...source, id: `new:${source.id}`, read: undefined, updates: undefined, scope: "all" as const, range: [1, Math.max(1, source.total)] as [number, number], duplicates: 0, addedAt: Date.now() })), criteria: copied.criteria, reviewers: activeReviewers(copied).filter(mine).map(({ row: _row, tally: _tally, ...one }) => ({ ...one, id: one.kind === "model" && one.model ? modelKey(one.model) : one.id })), rule: copied.rule, scoring: copied.scoring, destination: { ...copied.destination, name: "" } };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one blank form for each person and each screening it is copied from
  }, [setup?.me.id, copied?.id]);
  const origin = saved ?? made;
  // What isn't saved yet is kept with the tab, so leaving the page and coming back loses nothing.
  const key = id ?? `new:${from ?? ""}:${fromSearch ?? ""}`;
  const kept = useKept((store) => store.drafts[key]);
  const keep = useKept((store) => store.draft);
  const draft = kept ?? origin;
  // What the last save did, shown under Changes until the next edit.
  const [lastSave, setLastSave] = useState<{ edits: Edit[]; lines: EffectLine[]; moves: Move[] } | null>(null);
  const [discarding, setDiscarding] = useState<Edit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const setDraft = (next: Screening | ((now: Screening) => Screening)) => {
    if (!origin) return;
    setLastSave(null);
    // An edit taken back leaves nothing unsaved: a draft that says what is saved is no draft.
    keep(key, (now) => {
      const made = typeof next === "function" ? next(now ?? origin) : next;
      return saved && settingsOf(saved) === settingsOf(made) ? undefined : made;
    });
  };
  // A link to a part of the form lands on it with a short tint, so the eye finds where it landed. The window's address and its hash changes are the outside system.
  useEffect(() => {
    const target = () => (window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null);
    const tint = () => landOn(target());
    tint();
    window.addEventListener("hashchange", tint);
    return () => window.removeEventListener("hashchange", tint);
  }, []);
  const [kind, setKind] = useState<Kind>("search");
  const [find, setFind] = useState("");
  const [recheck, setRecheck] = useState(false);
  // The source whose row is open, and on which part: the papers taken from it, or what it held and left out.
  const [openSource, setOpenSource] = useState<{ id: string; part: "papers" | "left" } | null>(null);
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [scoring, setScoring] = useState(false);

  // What can be added, a page of each at a time. Every kind is read up front, so switching between them moves nothing.
  const words = useDebouncedValue(find.trim(), 300);
  const searches = useSearchList({ sort: "recent", pageSize: OFFER_PAGE, text: kind === "search" ? words : "" });
  const picked = useSearchHistoryStore((state) => (fromSearch ? state.searchHistory.find((item) => item.id === fromSearch) : undefined));
  const collections = useCursorPage(api.library.collections.listCollections, inWorkspace(workspaceId, {}), OFFER_PAGE);
  const savedCount = useProtectedQuery(api.library.queries.getLibraryCount, inWorkspace(workspaceId, {})).data;
  const screenings = useCursorPage(api.screening.view.list, inWorkspace(workspaceId, { show: "all" as const, sort: "newest" as const, ...(kind === "screening" && words ? { text: words } : {}) }), OFFER_PAGE);
  const destinations = useCursorPage(api.library.collections.listCollections, inWorkspace(workspaceId, {}), DESTINATION_PAGE);
  const create = useWorkspaceAction(api.screening.screenings.create);
  const saveChange = useWorkspaceMutation(api.screening.settings.save);
  const previewChange = useWorkspaceAction(api.screening.effects.preview);
  const { execute: writeQuestions } = useGenerateScreeningCriteria();
  const share = useSharing((saved?.id ?? "") as Id<"screeningJobs">);
  const give = useWorkspaceMutation(api.sharing.guests.add);
  const invite = useWorkspaceAction(api.sharing.invitations.invite);

  // What a save would do to a running screening, counted by the server for the change as it stands: the lines and the moves both read it.
  const change = saved && draft ? changeOf(saved, draft, recheck) : null;
  const changing = change && Object.keys(change).length > 0 ? JSON.stringify(change) : null;
  const counted = useSWR(saved && changing && workspaceId ? ["screening-preview", saved.id, changing] : null, () => previewChange({ jobId: saved!.id, change: change! }), { revalidateOnFocus: false, keepPreviousData: true });
  const preview: Preview = (changing ? counted.data : undefined) ?? NO_PREVIEW;
  // While the server counts a change, what it would do isn't known: the save waits for it.
  const counting = Boolean(changing) && (counted.isLoading || counted.isValidating) && !counted.error;

  // A new form waits for whoever makes it, and a screening that is gone, or not shared with the person, is said by the frame its settings open in.
  if (!draft || !origin || (id && !saved)) return id ? null : <ListLoading label="Loading the form" />;

  // Its workspace's members change it. The frame has no Settings tab for anyone else, and the address alone says why.
  if (saved && !open?.canChange) {
    return (
      <ListEmpty icon={Lock} action={<Button asChild variant="outline" size="sm"><NextLink href={overviewHref(saved.id)}>Go to the Overview<ChevronRight /></NextLink></Button>}>
        Only members of {saved.workspace.name} can change these settings
      </ListEmpty>
    );
  }

  const fresh = !saved;
  // A new screening is made in the workspace you are in.
  const workspace = saved ? saved.workspace : { name: here?.name ?? "this workspace" };
  // The credits its models are paid from: its own workspace's.
  const wallet = open?.wallet ?? setup?.credits ?? 0;
  // The workspace's models read so many papers at once: a screening started while another's are reading waits its turn.
  const ahead_ = fresh ? setup?.reading : undefined;
  const set = (patch: Partial<Screening>) => setDraft((d) => ({ ...d, ...patch }));
  const people = peopleOf(draft);
  // Someone invited by email reads papers once they have joined.
  const { people: joined, each } = readersOf(draft);
  const models = modelsOf(draft);
  const found = foundTotal(draft.sources);
  const papers = paperTotal(draft.sources);
  // What each person reads. A new screening shares all of it out evenly. A running one says what a save would leave each person with: settled papers take nobody new, so the loads can differ.
  const shareSays = (() => {
    if (!joined.length) return undefined;
    if (fresh && joined.length === 1) return `${joined[0]!.id === me ? "You read" : `${firstName(joined[0]!.name)} reads`} every paper`;
    if (fresh) return `About ${num(Math.ceil((papers * each) / joined.length))} papers for each person`;
    const loads = preview.loads ?? (() => { const dealt = joined.map((person) => person.tally?.dealt ?? 0); return { least: Math.min(...dealt), most: Math.max(...dealt) }; })();
    return loads.most - loads.least <= 2 ? `About ${num(loads.most)} papers for each person` : `${num(loads.least)} to ${num(loads.most)} papers for each person`;
  })();
  // The papers each model has still to read: all of them for a new screening, and for a running one the ones still open that it hasn't got to.
  const ahead = (model: Reviewer) => (fresh ? papers : (preview.models[model.id]?.ahead ?? preview.joining[model.id]?.reads ?? model.tally?.waiting ?? 0));
  const due = (model: Reviewer) => paperCredits(model.model!) * ahead(model);
  // What a save has each model read at once, and pay for: a criterion added to a running screening is answered on the open papers it has read, and a check of the settled papers opens some it had passed over.
  const added = Boolean(saved && draft.criteria.some((criterion) => !saved.criteria.some((one) => one.key === criterion.key)));
  const atOnce = (model: Reviewer) => (saved ? (preview.models[model.id]?.atOnce ?? 0) * paperCredits(model.model!) : 0);
  const reread = models.reduce((sum, model) => sum + atOnce(model), 0);
  // How many settled papers the change would move if they were checked again. They keep their result unless that is asked for.
  const again = saved ? preview.again : 0;
  const cost = models.reduce((sum, model) => sum + due(model), 0) + reread;
  const perNew = models.reduce((sum, model) => sum + paperCredits(model.model!), 0);
  // What keeps its models from reading now: a model added here starts once that is over, and the line says so.
  const heldNow = open?.modelsNow ?? null;
  const lines = saved && changing ? effectItems(saved, draft, preview, { me, wallet, waiting: heldNow === "waiting" }) : [];
  const moves = saved && changing ? preview.moves : [];
  // A model answers criteria: with none it would include every paper it reads.
  const needsCriteria = models.length > 0 && draft.criteria.length === 0;
  const lastCheck = open?.latest ?? null;
  // What its models have cost so far.
  const spentSoFar = saved ? saved.reviewers.reduce((sum, reviewer) => sum + (reviewer.tally?.spent ?? 0), 0) : 0;
  const edits = saved ? changesOf(saved, draft) : [];
  const dirty = edits.length > 0;
  // Paused models read nothing until someone resumes them: their rows and the cost say so.
  const paused = Boolean(saved?.paused && !saved.finishedAt && models.length);
  const unsaved = `${edits.length} unsaved ${edits.length === 1 ? "change" : "changes"}`;
  const moved = moves.reduce((sum, move) => sum + move.count, 0);
  // Beside a part's title while it holds an edit that isn't saved.
  const changed = (...sections: EffectSection[]) => (edits.some((edit) => sections.includes(edit.section)) ? <StateChip tone="warning" icon={PenLine} className="ms-1.5 h-5 px-1.5">Changed</StateChip> : null);
  // A criterion whose question was deleted asks nothing, and leaves its short name no words to fall back to.
  const unasked = draft.criteria.some((criterion) => !criterion.text.trim()) ? { text: "Write a question for the empty criterion", section: "criteria" as const, focus: "#criteria textarea[aria-invalid=true]" } : null;
  // What it has to be able to pay for now: all its reading to start, and for a running screening only what the save itself has the models read. What is left to read is paid for as it is read, and stops where the credits do.
  const owed = saved ? reread : cost;
  // What its plan lets one screening hold: papers, and models reading them.
  const overPapers = setup?.limits.papers !== undefined && setup.limits.papers !== null && papers > setup.limits.papers ? setup.limits.papers : null;
  const overModels = setup && models.length > setup.limits.models ? setup.limits.models : null;
  // What neither starting nor saving can do yet, and the control that fixes it: the reason opens its section and puts the cursor there.
  const lacking: Block | null = unasked ?? (needsCriteria ? { text: models.length > 1 ? "Add a criterion for the models" : "Add a criterion for the model", section: "criteria", focus: "#new-criterion" } : overPapers !== null ? { text: `Your plan screens up to ${num(overPapers)} papers at once`, section: "papers" } : overModels !== null ? { text: `A screening runs up to ${overModels} models`, section: "reviewers" } : owed > wallet && fresh ? { text: `${credits(owed - wallet)} credits short` } : null);
  const holdUp = saved ? lacking : null;
  // How many votes each reviewer has cast: what a row's chips open.
  const votesOf = (reviewer: Reviewer) => reviewer.tally?.cast ?? 0;
  const wasOn = (reviewer: Reviewer) => Boolean(saved?.reviewers.some((one) => one.id === reviewer.id && !one.left));
  // The papers a model got to and couldn't read: it has read everything else.
  const unreadBy = (reviewer: Reviewer) => reviewer.tally?.failed ?? 0;
  const unreadText = (count: number) => `${num(count)} couldn't be read`;
  // Why it can't start yet: it needs papers and a reviewer first.
  const stop: Block | null = !papers
    ? { text: "Add papers to start", section: "papers", focus: "#add-papers [role=tab][data-state=active]" }
    : !activeReviewers(draft).length
      ? { text: "Add a reviewer to start", section: "reviewers", focus: "#add-person" }
      : lacking;

  // A source is what the server reads it from (`set`), under the name its list gave it. What it holds is what the list counted; what it leaves out and what another source already has are known once it is read.
  const addSource = (offer: Offer) =>
    setDraft((d) => {
      if (d.sources.some((source) => source.ref === offer.ref)) return d;
      return { ...d, sources: [...d.sources, { id: `new:${offer.ref}`, kind: offer.set.kind, name: offer.name, detail: offer.detail, total: offer.total, scope: "all", range: [1, Math.max(1, offer.total)], duplicates: 0, set: offer.set, ref: offer.ref, addedAt: Date.now(), ...(offer.filters ? { filters: offer.filters } : {}), ...(offer.questions?.length ? { questions: offer.questions } : {}) }] };
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
      const criterionKey = `new:${hash(clean)}`;
      return withCriteria(d, [...d.criteria, { key: criterionKey, text: clean, short: more.short ?? shortOf(clean), must: true, terms: more.terms ?? [], addedAt: Date.now() }], { ...d.scoring.points, [criterionKey]: [1, 0, 0] });
    });
  const patchCriterion = (criterionKey: string, patch: Partial<Criterion>) => setDraft((d) => ({ ...d, criteria: d.criteria.map((criterion) => (criterion.key === criterionKey ? { ...criterion, ...patch } : criterion)) }));
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
  const shortNameHelp = <Help title="Short name" facts={<HelpFact>Up to {SHORT_NAME_LENGTH} characters</HelpFact>}>The name a criterion goes by where its question doesn&apos;t fit: table columns, filters, and the reasons papers were excluded. It is the question&apos;s own words until you write one.</Help>;
  const copyable = screenings.items.filter((one) => one.id !== id && one.criteria > 0).slice(0, 8);
  const cantWrite = !draft.question.trim() ? "Write a research question first" : null;
  // A model writes yes-or-no criteria from the research question, each with a short name and the words to mark for whoever votes.
  const writeCriteria = async () => {
    setWriting(true);
    try {
      const written = await writeQuestions({ researchQuestion: draft.question, existingQuestions: draft.criteria.map((criterion) => criterion.text) });
      written.criteria.forEach((one) => addCriterion(one.text, { short: one.short, terms: one.terms }));
      if (!written.criteria.length) toast("It found nothing to add to the criteria here");
    } catch (error) {
      showStyledToast("error", getErrorMessage(error, "The criteria couldn't be written. Try again."));
    } finally {
      setWriting(false);
    }
  };

  const addReviewer = (reviewer: Reviewer) =>
    setDraft((d) => {
      // Someone put back on keeps the votes they cast and their place in the reading. A model whose votes were thrown out starts its reading over.
      const back = d.reviewers.find((one) => one.id === reviewer.id || (one.kind === "model" && reviewer.kind === "model" && one.model && reviewer.model && modelKey(one.model) === modelKey(reviewer.model)));
      const reviewers = back ? d.reviewers.map((one) => (one === back ? { ...one, left: undefined } : one)) : [...d.reviewers, { ...reviewer, addedAt: fresh ? d.createdAt : Date.now() }];
      const here_ = reviewers.filter((one) => !one.left && one.kind === "person" && !one.email).length;
      return {
        ...d,
        reviewers,
        // A reviewer is no longer someone it is only shared with to look at.
        viewers: d.viewers?.filter((one) => one.id !== reviewer.id),
        // Two people on every paper is how a review is usually screened: a new screening takes that up when its second person is added.
        ...(fresh && reviewer.kind === "person" && !reviewer.email && here_ === 2 && d.rule.each === "1" ? { rule: { ...d.rule, each: "2" as const } } : {}),
      };
    });
  // On a running screening a removed reviewer, source or criterion stays in its list until the save, struck through, with Keep to put it back.
  // On a new one it goes at once, and the toast can put it back where it was.
  const undoable = (what: string, back: () => void) => toast(`Removed ${what}`, { action: { label: "Undo", onClick: back } });
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
    if (!saved?.criteria.some((one) => one.key === criterion.key)) undoable(criterionName(criterion), () => setDraft((d) => withCriteria(d, insertAt(d.criteria, at, criterion), { ...d.scoring.points, [criterion.key]: points })));
  };
  const keepCriterion = (criterion: Criterion) => setDraft((d) => withCriteria(d, inSavedOrder([...d.criteria, criterion], saved?.criteria ?? []), { ...d.scoring.points, [criterion.key]: saved?.scoring.points[criterion.key] ?? [1, 0, 0] }));
  // What each list shows: on a running screening, what saving would remove stays in its place.
  const sourceRows = saved ? inSavedOrder([...draft.sources, ...saved.sources.filter((one) => !draft.sources.some((source) => source.id === one.id))], saved.sources).map((source) => ({ source, gone: !draft.sources.some((one) => one.id === source.id) })) : draft.sources.map((source) => ({ source, gone: false }));
  const criterionRows = saved ? inSavedOrder([...draft.criteria, ...saved.criteria.filter((one) => !draft.criteria.some((criterion) => criterion.key === one.key))], saved.criteria).map((criterion) => ({ criterion, gone: !draft.criteria.some((one) => one.key === criterion.key) })) : draft.criteria.map((criterion) => ({ criterion, gone: false }));
  const reviewerRows = draft.reviewers.filter((reviewer) => !reviewer.left || wasOn(reviewer)).map((reviewer) => ({ reviewer, gone: Boolean(reviewer.left) }));

  const failed = (error: unknown) => showStyledToast("error", getErrorMessage(error, "That didn't work. Try again."));
  const start = async () => {
    if (busy) return;
    setBusy(true);
    const name = draft.name.trim() || draft.sources[0]?.name || "Untitled screening";
    try {
      const { jobId } = await create(setupOf({ ...draft, name }));
      // People from outside the workspace are given it, or invited to it, once it is there to share: to vote, or to look.
      const outside = [...activeReviewers(draft).filter((one) => one.kind === "person" && one.guest).map((one) => ({ one, role: "editor" as const })), ...(draft.viewers ?? []).map((one) => ({ one, role: "viewer" as const }))];
      const sent = await Promise.allSettled(outside.map(({ one, role }) => (one.email ? invite({ kind: "screening", id: jobId, email: one.email, role }) : give({ kind: "screening", id: jobId, personId: one.id as Id<"users">, role }))));
      if (sent.some((one) => one.status === "rejected")) showStyledToast("error", "Some people couldn't be added. Add them again from People.");
      keep(key, () => undefined);
      // The new screening takes the form's place in the history: Back from it returns to the list, not to a form already sent.
      router.replace(overviewHref(jobId));
    } catch (error) {
      failed(error);
      setBusy(false);
    }
  };
  const save = async () => {
    if (!saved || !id || !change || busy || counting) return;
    setBusy(true);
    try {
      // People from outside the workspace join by sharing: a reviewer as a guest who votes.
      const outside = activeReviewers(draft).filter((one) => one.kind === "person" && one.guest && !saved.reviewers.some((was) => was.id === one.id && !was.left));
      await saveChange({ jobId: saved.id, change });
      await Promise.allSettled(outside.map((one) => (one.email ? share.invite(one.email) : share.give(one.id as Id<"users">))));
      // The page stays where it is: Changes keeps what the save did until the next edit.
      setLastSave({ edits, lines, moves });
      setRecheck(false);
      keep(key, () => undefined);
      // What the save did to the papers is said with it, so a count that changed elsewhere is no surprise.
      toast("Changes saved", { description: moves.length ? movesText(moves) : undefined, action: <NextLink data-button href={overviewHref(id)}>Go to the Overview</NextLink> });
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
    toast("Changes discarded", { action: { label: "Undo", onClick: () => keep(key, () => was) } });
  };

  // What each tab offers, a page at a time: the workspace's saved searches, its library and collections, and the included papers of its other screenings.
  const taken_ = (ref: string) => draft.sources.some((source) => source.ref === ref);
  const searchOffer = (search: SearchResult): Offer => ({ ref: `search:${search.id}`, name: search.query, detail: "", total: search.count, set: { kind: "search", searchId: search.id }, questions: search.screeningQuestions.map((one) => one.question) });
  const offered: { rows: Offer[]; pager?: Pager; loading: boolean } =
    kind === "search"
      ? { rows: [...(picked && searches.page === 1 && !words ? [searchOffer(picked)] : []), ...searches.items.filter((search) => search.id !== picked?.id).map(searchOffer)], pager: searches, loading: searches.isLoading }
      : kind === "collection"
        ? { rows: [...(collections.page === 1 ? [{ ref: "saved", name: "All saved papers", detail: "This workspace's library", total: savedCount ?? 0, set: { kind: "saved" as const } }] : []), ...collections.items.map((one) => ({ ref: `collection:${one._id}`, name: one.name, detail: "", total: one.itemCount, set: { kind: "collection" as const, collectionId: one._id } }))], pager: collections, loading: collections.isLoading || savedCount === undefined }
        : { rows: screenings.items.filter((one) => one.id !== id && one.counts.include > 0).map((one) => ({ ref: `screening:${one.id}`, name: includedIn(one.name), detail: one.finishedAt ? "Finished screening" : "Running screening", total: one.counts.include, set: { kind: "screening" as const, jobId: one.id } })), pager: screenings, loading: screenings.isLoading };
  const importable = draft.sources.flatMap((source) => (source.questions ?? []).filter((question) => !draft.criteria.some((criterion) => criterion.text === question)).map((question) => ({ question, source })));
  const importSearches = new Set(importable.map(({ source }) => source.id)).size;
  const suggested = draft.name || draft.sources[0] ? includedIn(draft.name || draft.sources[0]!.name) : "Included papers";
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
    ...(ownCollection ? [<Destination key="own" on={onOwn} onPick={() => set({ destination: { ...ownCollection, prune: draft.destination.prune } })} icon={Folder} name={collectionName(saved!) ?? "Its collection"} facts={<Chip>{plural(open?.counts.include ?? 0, "paper", "papers")}</Chip>} />] : []),
    <Destination key="new" on={onAnother} onPick={() => { if (!onAnother) set({ destination: another }); }} icon={FolderPlus} name="New collection" below={onAnother ? nameField("Collection name", suggested) : null} />,
    ...destinations.items.filter((collection) => collection._id !== ownCollection?.collection).map((collection) => (
      <Destination key={collection._id} on={draft.destination.collection === collection._id} onPick={() => set({ destination: { ...draft.destination, kind: "collection", name: collection.name, collection: collection._id } })} icon={Folder} name={`Add to ${collection.name}`} facts={<Chip>{plural(collection.itemCount, "paper", "papers")}</Chip>} />
    )),
    <Destination key="none" on={draft.destination.kind === "none"} onPick={() => set({ destination: { ...draft.destination, kind: "none", collection: undefined } })} icon={Ban} name="Nowhere" facts={<Chip>Kept in the screening</Chip>} />,
  ];
  const fromCollection = draft.sources.find((source) => source.kind === "collection");

  // The summary beside the form: one line for each part, which opens it.
  const resolver = joined.find((person) => person.id === draft.rule.resolver) ?? joined[0];
  const destinationName = draft.destination.kind === "none" ? "Nowhere" : draft.destination.kind === "new" && !draft.destination.name && !draft.name ? "New collection" : (collectionName(draft) ?? "A collection");
  const musts = draft.criteria.filter((criterion) => criterion.must).length;
  const reviewersNow = inOrder(activeReviewers(draft), me);
  // `unset`: a part left empty that the screening can start without. It gets no tick, which would read as done.
  const summary: Array<{ id: string; label: string; value: string; problem: boolean; unset?: boolean; aside?: ReactNode }> = [
    { id: "papers", label: "Papers", value: papers ? `${plural(papers, "paper", "papers")} from ${plural(draft.sources.length, "source", "sources")}` : "No papers yet", problem: !papers },
    { id: "criteria", label: "Criteria", value: draft.criteria.length ? `${plural(draft.criteria.length, "criterion", "criteria")}, ${plural(musts, "must-have", "must-haves")}` : "No criteria", problem: needsCriteria, unset: !draft.criteria.length },
    {
      id: "reviewers",
      label: "Reviewers",
      value: reviewersNow.length ? [joined.length ? plural(joined.length, "person", "people") : null, people.length > joined.length ? `${people.length - joined.length} invited` : null, models.length ? plural(models.length, "model", "models") : null].filter(Boolean).join(", ") : "Nobody yet",
      problem: !reviewersNow.length,
      aside: reviewersNow.length ? (
        <span aria-hidden className="flex shrink-0 items-center">
          {reviewersNow.slice(0, 4).map((reviewer, i) => <span key={reviewer.id} className={cn("flex", i > 0 && "-ms-1.5")}><ReviewerMark reviewer={reviewer} you={reviewer.id === me} className="size-6 ring-2 ring-card" /></span>)}
          {reviewersNow.length > 4 ? <span className="ms-1.5 text-xs tabular-nums text-muted-foreground">+{reviewersNow.length - 4}</span> : null}
        </span>
      ) : null,
    },
    { id: "decided", label: "How a paper is decided", value: `${SETTLE_LABEL[draft.rule.settle]}${draft.rule.settle === "one" ? "" : `, conflicts to ${!resolver || resolver.id === me ? "you" : firstName(resolver.name)}`}`, problem: false },
    { id: "goes-to", label: "Where included papers go", value: destinationName, problem: false },
  ];

  const body = (
    <>
      {copied ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle bg-inset px-4 py-2.5 text-sm sm:px-6">
          <Copy className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">Filled in from <span className="font-medium">{copied.name}</span></span>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs"><NextLink href={overviewHref(copied.id)}>Open it<ChevronRight /></NextLink></Button>
        </div>
      ) : null}
      {/* Where the summary follows the form instead of standing beside it, its list of the form's parts is a long way down: the parts are one line of links over the form. */}
      <nav aria-label="Go to a part of the form" className="border-b border-border-subtle px-4 py-2.5 sm:px-6 @6xl:hidden">
        <FadeRow scrolls scrollbar="none" className="flex items-center gap-1.5 *:shrink-0">
          {summary.map((line) => (
            <JumpLink key={line.id} to={line.id} className="flex h-7 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-3 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              {line.problem ? <TriangleAlert aria-label="Needed to start" className="size-3.5 shrink-0 ink-warning" /> : null}
              {line.label}
            </JumpLink>
          ))}
        </FadeRow>
      </nav>
      {/* The summary sits beside the form only where that leaves the form's rows room to stay on one line each; below that it follows the form. */}
      <div className="grid @6xl:grid-cols-[minmax(0,1fr)_24rem] @7xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-10 p-4 sm:p-6">
          <section id="name" className={cn("grid gap-4 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]", BELOW_HEADER)}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="screening-name" className="flex h-5 items-center text-xs font-medium text-muted-foreground">Name{changed("name")}</label>
              <Input id="screening-name" value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder={draft.sources[0]?.name ?? "Such as “School meals and learning”"} maxLength={200} className="h-10 text-base font-semibold placeholder:font-normal placeholder:text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex h-5 items-center gap-1">
                <label htmlFor="research-question" className="text-xs font-medium text-muted-foreground">Research question <span className="font-normal">(optional)</span></label>
                <Help title="Research question" facts={<HelpFact>Optional</HelpFact>}>The question your review answers. A model can write yes-or-no criteria from it under Criteria.</Help>
              </span>
              <Textarea id="research-question" rows={1} value={draft.question} onChange={(event) => set({ question: event.target.value })} placeholder="Such as “Do school meals improve learning in primary schools?”" className="min-h-10 resize-none py-2 text-sm field-sizing-content" />
            </div>
          </section>

          <Section
            id="papers"
            title="Papers"
            help={<><Help title="Papers" facts={<><HelpFact>As many sources as you need</HelpFact><HelpFact>Duplicates merged</HelpFact></>}><p>Add every place the papers come from: searches, collections, communities, Zotero, files or DOIs. A paper found in two sources is screened once.</p><p>A screening reads a title and an abstract. A record that Openscholar&apos;s index knows takes both from there.</p><p>What can&apos;t be screened is left out, and its source&apos;s row lists it with the reason: a paper with no abstract, a scan, a record with no title, a DOI that isn&apos;t found.</p></Help>{changed("papers")}</>}
            aside={
              <>
                {/* What the sources held, what of that can't be screened, what two of them both held, and what is left. */}
                <Chip><AnimatedNumber value={found + leftTotal(draft.sources)} /> found</Chip>
                {leftTotal(draft.sources) ? <Chip><AnimatedNumber value={leftTotal(draft.sources)} /> left out</Chip> : null}
                <Chip><AnimatedNumber value={found - papers} /> duplicates merged</Chip>
                {/* A running screening's papers open on its Papers page, under the same name the summary gives them. */}
                {saved ? (
                  <LinkChip href={papersHref(saved.id)} tone="primary"><AnimatedNumber value={papers} /> {papers === 1 ? "paper" : "papers"}</LinkChip>
                ) : (
                  <Chip className="bg-primary/12 font-medium text-primary"><AnimatedNumber value={papers} /> to screen</Chip>
                )}
              </>
            }
          >
            {/* Two columns only where the well beside the sources is wide enough for its seven tabs on one line. */}
            <div className="@container"><div className="grid items-start gap-4 @[88rem]:grid-cols-2 @[88rem]:grid-rows-[auto_1fr]">
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
                        const busy = source.read?.state === "reading" || source.read?.state === "waiting" ? "Reading it" : null;
                        const itemsLabel = leftOut ? `${num(leftOut)} left out` : null;
                        const link = sourceLink(source);
                        // What it held at the start and what its checks found add up to its total. Each says how many of its own another source already had.
                        const grew = grown(source);
                        const grewDoubled = (source.updates ?? []).reduce((sum, update) => sum + update.duplicates, 0);
                        const grewText = `${num(grew)} more since it started${grewDoubled ? `, ${num(grewDoubled)} already in another source` : ""}`;
                        const doubled = Math.min(source.duplicates, taken(source) - grew);
                        // On a running screening the name opens the papers it brought; where it lives opens from the icon beside it.
                        const own = saved?.sources.some((one) => one.id === source.id) ? saved.id : null;
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
                                      <span className="sr-only">(opens in a new tab)</span>
                                    </a>
                                  ) : (
                                    <p className="truncate text-sm font-medium max-sm:line-clamp-2 max-sm:whitespace-normal">{source.name}</p>
                                  )}
                                  {own && link && !gone ? (
                                    <TooltipHint label={`Open ${link.where}`}>
                                      <a href={link.href} target="_blank" rel="noreferrer" aria-label={`Open ${link.where}, in a new tab`} className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"><ExternalLink className="size-3.5" /></a>
                                    </TooltipHint>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {gone ? <StateChip tone="warning" icon={Trash2}>Removed when you save</StateChip> : null}
                                  {/* Its counts take the place the chip holds once the lookup or the count is back, so the row keeps its height. */}
                                  {busy ? <Chip key="busy"><Spinner className="size-3" />{busy}</Chip> : (
                                    <>
                                      <Chip key="count">{source.scope === "all" ? (source.total > baseTotal(source) ? `${num(baseTotal(source))} at the start` : `All ${num(baseTotal(source))}`) : `${num(baseTotal(source))} in the source`}</Chip>
                                      {doubled > 0 && taken(source) ? <Chip>{num(doubled)} already in another source</Chip> : null}
                                      {grew > 0 && own && !gone ? (
                                        <LinkChip href={papersHref(own, { source: source.id, ...((source.updates?.length ?? 0) === 1 ? { added: String(source.updates![0]!.at) } : { sort: "added" }) })} tone="primary" icon={RefreshCw}>{grewText}</LinkChip>
                                      ) : grew > 0 ? (
                                        <StateChip tone="primary" icon={RefreshCw}>{grewText}</StateChip>
                                      ) : draft.living && GROWS.includes(source.kind) ? <Chip icon={RefreshCw}>Checked {EVERY_LABEL[draft.living.every].toLowerCase()}</Chip> : null}
                                      {source.read?.state === "failed" ? <StateChip tone="destructive" icon={TriangleAlert}>{source.read.failure ?? "Couldn't be read"}</StateChip> : null}
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
                              </div>
                              {gone ? (
                                <Button variant="ghost" size="sm" className="h-8 shrink-0 max-sm:ms-auto" onClick={() => keepSource(source)}><Undo2 />Keep</Button>
                              ) : (
                                <>
                                  {baseTotal(source) > 1 ? (
                                    <Button variant="ghost" size="sm" aria-expanded={isOpen} className="h-8 shrink-0 text-xs text-muted-foreground max-sm:ms-auto" onClick={() => setOpenSource(isOpen ? null : { id: source.id, part: "papers" })}>
                                      {source.scope === "range" ? `Papers ${num(source.range[0])} to ${num(source.range[1])}` : "Choose papers"}<ChevronDown className={cn("transition-transform duration-200", isOpen && "rotate-180")} />
                                    </Button>
                                  ) : null}
                                  <TooltipHint label={`Remove ${source.name}`}>
                                    <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={`Remove ${source.name}`} onClick={() => removeSource(source)}><Trash2 /></Button>
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
                                      <LeftOut jobId={saved!.id} sourceId={source.id as Id<"screeningSources">} total={leftOut} />
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
                                      label={`Papers of ${source.name}`}
                                      summary={<p className="text-xs text-muted-foreground">Every one of its {num(baseTotal(source))} papers.</p>}
                                    />
                                    {link && taken(source) ? (
                                      <p className="border-t border-border-subtle pt-3 text-xs">
                                        <a href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">See all {num(taken(source))} {link.where}<ExternalLink aria-hidden className="size-3" /></a>
                                      </p>
                                    ) : null}
                                    {/* A range of a Zotero source is counted in the order its papers were added there, which holds from one read to the next. */}
                                    {source.kind === "zotero" && source.scope === "range" ? <Chip icon={Clock}>Oldest added to Zotero first</Chip> : null}
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
                  <EmptyNote>No papers yet</EmptyNote>
                )}
                </AutoHeight>
              </div>

              {/* What can be added sits in a well of its own, under its own title: it never looks like what is already in. */}
              <Panel className="@container min-w-0 space-y-3 @[88rem]:col-start-2 @[88rem]:row-span-2 @[88rem]:row-start-1">
                <h3 className="text-sm font-semibold">Add papers from</h3>
                <Tabs value={kind} onValueChange={(next) => { setKind(next as Kind); setFind(""); }} className="gap-3">
                  <ScrollArea axis="x" shades className="rounded-[1.375rem] bg-card ring-1 ring-border-subtle">
                  <TabsList id="add-papers" aria-label="Add papers from" className="h-auto w-max justify-start gap-1 bg-transparent p-1 group-data-[orientation=horizontal]/tabs:h-auto">
                    {KINDS.map((one) => (
                      <TabsTrigger key={one.id} value={one.id} className="h-8 flex-none rounded-full px-3 text-xs text-muted-foreground data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:ring-1 data-[state=active]:ring-primary/40 dark:data-[state=active]:bg-primary/15 dark:data-[state=active]:text-primary">
                        <one.icon className="size-3.5 @max-[43rem]:hidden" />{one.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  </ScrollArea>
                  <TabsContent value={kind}>
                    <div className="space-y-2">
                      {/* A search is found by its words and a screening by its name. The library's collections are few enough to page through. */}
                      {kind !== "collection" ? (
                        <div className="relative">
                          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input value={find} onChange={(event) => setFind(event.target.value)} placeholder={KINDS.find((one) => one.id === kind)!.find ?? `Find a ${KINDS.find((one) => one.id === kind)!.label.toLowerCase()}`} aria-label="Find a source" className="h-8 rounded-full bg-card ps-8 text-sm" />
                        </div>
                      ) : null}
                      {/* The list keeps a page's height from the first frame, so what loads, and a short last page, move nothing under it. */}
                      <div className={cn("divide-y divide-border-subtle transition-opacity", offered.pager?.isStale && "pointer-events-none opacity-60")} style={{ minHeight: OFFER_PAGE * 57 }}>
                        {offered.rows.map((offer) => <OfferRow key={offer.ref} offer={offer} icon={kindIcon(offer.set.kind)} added={taken_(offer.ref)} onAdd={() => pick(offer)} />)}
                        {!offered.rows.length && !offered.loading ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{words ? "Nothing by that name." : kind === "screening" ? "No other screening has included a paper yet." : kind === "search" ? "No saved searches yet." : "Nothing here yet."}</p> : null}
                      </div>
                      {offered.pager?.hasPages ? <CommandCenterPagination className="pt-1" currentPage={offered.pager.page} itemLabel="sources" steps={{ canPrevious: offered.pager.canPrevious, canNext: offered.pager.canNext, onPrevious: offered.pager.previous, onNext: offered.pager.next, offset: offered.pager.offset, shown: offered.pager.items.length }} /> : null}
                    </div>
                  </TabsContent>
                </Tabs>
              </Panel>

              {/* A living screening: its sources are checked again on a schedule, and only what is new is screened. */}
              <div id="new-papers" className={cn(LIST, BELOW_HEADER, "min-w-0 bg-card @[88rem]:col-start-1")}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <p className="flex min-w-48 flex-1 items-center gap-1 text-sm font-medium">
                    Living screening
                    <Help title="Living screening" facts={<><HelpFact>Uploaded files and pasted DOIs never gain papers</HelpFact><HelpFact>Reviewers are told by email</HelpFact><HelpFact icon={Coins}>Models charge for each new paper</HelpFact></>}>Openscholar checks the screening&apos;s searches, collections and communities for new papers on the schedule you pick. Only papers that are new are added and go to reviewers.</Help>
                    {changed("new-papers")}
                  </p>
                  <Segmented
                    label="Check for new papers"
                    value={draft.living?.every ?? "off"}
                    onChange={(next) => set({ living: next === "off" ? undefined : { every: next, next: Date.now() + PERIOD[next] } })}
                    options={[{ id: "off" as const, label: "Off" }, ...(["day", "week", "month"] as const).map((id) => ({ id, label: EVERY_LABEL[id] }))]}
                  />
                </div>
                {draft.living ? (
                  growing(draft).length ? (
                    <div className="flex flex-wrap gap-1.5 bg-inset px-4 py-2.5">
                      <Chip icon={RefreshCw}>{growing(draft).length === draft.sources.length ? (draft.sources.length === 1 ? "Checks its source" : `Checks its ${draft.sources.length} sources`) : `Checks ${growing(draft).length} of its ${draft.sources.length} sources`}</Chip>
                      <Chip icon={Clock}>{saved?.living ? `Next check ${day(draft.living.next)}` : fresh ? `First check ${day(draft.living.next)}` : "First check as soon as this is saved"}</Chip>
                      {models.length ? <Chip icon={Coins}>{credits(perNew)} credits a new paper</Chip> : null}
                    </div>
                  ) : (
                    <p className="bg-warning/10 px-4 py-2.5 text-sm ink-warning">{draft.sources.length ? "None of these sources gains papers. Add a search, a collection or a community to check." : "Add a search, a collection or a community to check."}</p>
                  )
                ) : null}
              </div>
            </div></div>
          </Section>

          <Section
            id="criteria"
            className="@container/criteria"
            title="Criteria"
            help={<><Help title="Must-have and nice to have" facts={<><HelpFact>People vote directly</HelpFact><HelpFact>Answers decide models&apos; votes</HelpFact></>}>Write each criterion as a yes-or-no question. A model answers each one yes, no or unclear. A no on a must-have criterion makes its vote exclude, and an unclear makes it maybe. A nice-to-have criterion never excludes a paper. Guidance under a question says what counts: a reviewer opens it with &quot;Guidance&quot; under the question on Screen, and a model reads it with the question. The words you mark for a criterion are shown marked in each abstract while a person votes.</Help>{changed("criteria")}</>}
            aside={
              <span className="flex items-center gap-1">
                <span className="flex flex-wrap items-center justify-end gap-1 @max-[40rem]/criteria:hidden">
                  {importable.length ? (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => importable.forEach(({ question }) => addCriterion(question))}>
                      <ListChecks />Add {plural(importable.length, "question", "questions")} from your {importSearches === 1 ? "search" : "searches"}
                    </Button>
                  ) : null}
                  {copyable.length ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 text-xs"><Copy />Copy from a screening<ChevronDown /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-80">
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Adds its criteria to the ones here, with their points</DropdownMenuLabel>
                        {copyable.map((one) => (
                          <DropdownMenuItem key={one.id} onSelect={() => copyCriteria(one)}>
                            <span className="min-w-0 flex-1 truncate">{one.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{plural(one.criteria, "criterion", "criteria")}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                  <TooltipHint label={writing ? undefined : (cantWrite ?? undefined)}>
                    <span tabIndex={cantWrite && !writing ? 0 : -1} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={writing || Boolean(cantWrite)} onClick={writeCriteria}><AiIcon working={writing} />Write criteria from the question</Button>
                    </span>
                  </TooltipHint>
                </span>
                {/* Where the section's line is too short for them beside its title, the three are one menu: none wraps onto a line of its own. */}
                <DropdownMenu>
                  <TooltipHint label="More">
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8 text-muted-foreground @[40rem]/criteria:hidden" aria-label="Criteria actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
                  </TooltipHint>
                  <DropdownMenuContent align="end" className="w-72">
                    {importable.length ? <DropdownMenuItem onSelect={() => importable.forEach(({ question }) => addCriterion(question))}><ListChecks />Add {plural(importable.length, "question", "questions")} from your {importSearches === 1 ? "search" : "searches"}</DropdownMenuItem> : null}
                    {/* Why it can't be pressed goes under the label, and the icon stays on the label's line. */}
                    <DropdownMenuItem disabled={writing || Boolean(cantWrite)} onSelect={writeCriteria} className="items-start"><span className="flex h-5 shrink-0 items-center"><AiIcon working={writing} /></span><span className="min-w-0 flex-1">Write criteria from the question{cantWrite ? <span className="block text-xs text-muted-foreground">{cantWrite}</span> : null}</span></DropdownMenuItem>
                    {copyable.length ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Copy criteria from a screening</DropdownMenuLabel>
                        {copyable.map((one) => (
                          <DropdownMenuItem key={one.id} onSelect={() => copyCriteria(one)}>
                            <span className="min-w-0 flex-1 truncate">{one.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{one.criteria}</span>
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
                  <span className="min-w-0 flex-1 px-1">Question and guidance</span>
                  <span className={cn(SHORT_NAME, "flex items-center gap-1")}>Short name{shortNameHelp}</span>
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
                      <span className="mt-2 w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                      {gone ? (
                        <>
                          <p className="min-w-0 flex-1 px-1 py-1.5 text-sm text-muted-foreground line-through @max-3xl/criteria:basis-[calc(100%-1.75rem)]">{criterion.text}</p>
                          <StateChip tone="warning" icon={Trash2} className="@max-3xl/criteria:ms-5">Removed when you save</StateChip>
                          <Button variant="ghost" size="sm" className="h-8 shrink-0" onClick={() => keepCriterion(criterion)}><Undo2 />Keep</Button>
                        </>
                      ) : (
                        <>
                          {/* The short name follows the question's words until someone has written one. */}
                          <div className="min-w-0 flex-1 @max-3xl/criteria:basis-[calc(100%-1.75rem)]">
                            <Textarea rows={1} value={criterion.text} onChange={(event) => patchCriterion(criterion.key, { text: event.target.value, short: criterion.short === shortOf(criterion.text) ? shortOf(event.target.value) : criterion.short })} aria-label={`Criterion ${i + 1}`} aria-invalid={!criterion.text.trim() || undefined} placeholder="Write a yes or no question" className="min-h-8 w-full resize-none border-transparent bg-transparent px-1 py-1.5 text-sm shadow-none field-sizing-content hover:border-border-subtle" />
                            {/* What counts and what doesn't. A reviewer opens it with "Guidance" under the question on Screen, and a model is given it with the question. */}
                            <div className="flex items-start gap-1 ps-1 text-muted-foreground">
                              <CircleHelp aria-hidden className="mt-1 size-3.5 shrink-0" />
                              <Textarea rows={1} value={criterion.note ?? ""} onChange={(event) => patchCriterion(criterion.key, { note: event.target.value || undefined })} aria-label={`Guidance for criterion ${i + 1}`} placeholder="Add guidance on what counts and what doesn't" className="min-h-0 min-w-0 flex-1 resize-none border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground shadow-none field-sizing-content placeholder-shown:border-dashed placeholder-shown:border-border hover:border-border-subtle" />
                            </div>
                            {/* The words a person sees marked in each abstract while they vote on this criterion. */}
                            <MarkedWords criterion={criterion} n={i + 1} onChange={(terms) => patchCriterion(criterion.key, { terms })} />
                          </div>
                          <ShortName criterion={criterion} n={i + 1} help={criterion.key === criterionRows.find((row) => !row.gone)?.criterion.key ? shortNameHelp : undefined} onChange={(short) => patchCriterion(criterion.key, { short })} />
                          <span className={ROW_END}>
                            <Segmented label={`Criterion ${i + 1} is`} value={criterion.must ? "must" : "nice"} onChange={(next) => patchCriterion(criterion.key, { must: next === "must" })} options={[{ id: "must", label: "Must-have" }, { id: "nice", label: "Nice to have" }]} />
                            <TooltipHint label={`Remove ${criterionName(criterion)}`}>
                              <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={`Remove ${criterionName(criterion)}`} onClick={() => removeCriterion(criterion)}><Trash2 /></Button>
                            </TooltipHint>
                          </span>
                        </>
                      )}
                    </div>
                  </motion.div>
                ))}
                {/* The line a list with nothing in it shows grows in as its last row shrinks away, as a row does. */}
                {!criterionRows.length ? <motion.div key="none" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", DIVIDED_ROW)}><p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">{writing ? <><AiIcon working className="size-4" />Writing criteria from the question</> : "No criteria yet"}</p></motion.div> : null}
              </AnimatePresence>
              <form className="flex items-center gap-2 px-4 py-2.5" onSubmit={(event) => { event.preventDefault(); addCriterion(text); setText(""); }}>
                <Input id="new-criterion" value={text} onChange={(event) => setText(event.target.value)} placeholder="A yes or no question" aria-label="New criterion" className="h-9 flex-1" />
                <Button type="submit" variant="outline" size="sm" className="h-9" disabled={!text.trim()}><Plus />Add</Button>
              </form>
              <div>
                <div className="flex items-center gap-1 px-4 py-2">
                  <button type="button" aria-expanded={scoring} aria-controls="scoring" onClick={() => setScoring(!scoring)} className="-ms-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50">
                    Scoring
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", scoring && "rotate-180")} />
                  </button>
                  <Help title="Scoring" facts={<><HelpFact>Yes, no and unclear each score points</HelpFact><HelpFact>Five star levels</HelpFact></>}>Points rank the included papers and set the stars they are saved with. They never change a vote.</Help>
                </div>
                <AnimatePresence initial={false}>
                  {scoring ? (
                    <motion.div id="scoring" key="scoring" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                      <div className="space-y-4 px-4 pb-4">
                        {draft.criteria.length ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-end gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <span />
                              <span className="col-span-3 border-b border-border-subtle pb-1 text-center">Points for each answer</span>
                              <span>Criterion</span><span className="text-center">Yes</span><span className="text-center">No</span><span className="text-center">Unclear</span>
                            </div>
                            {draft.criteria.map((criterion) => (
                              <div key={criterion.key} className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-center gap-2">
                                <span className="flex min-w-0 items-center gap-2 text-sm"><span className="min-w-0">{criterion.text}</span>{criterion.must ? <Chip className="shrink-0">Must-have</Chip> : null}</span>
                                {[0, 1, 2].map((slot) => (
                                  <Input key={slot} type="number" value={draft.scoring.points[criterion.key]?.[slot] ?? 0} onChange={(event) => set({ scoring: { ...draft.scoring, points: { ...draft.scoring.points, [criterion.key]: (draft.scoring.points[criterion.key] ?? [1, 0, 0]).map((points, at) => (at === slot ? Number(event.target.value) : points)) as [number, number, number] } } })} aria-label={`Points for ${["yes", "no", "unclear"][slot]}, ${criterionName(criterion)}`} className="h-8 px-1 text-center text-sm tabular-nums" />
                                ))}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Points each star begins at">
                          <span>Stars begin at</span>
                          {draft.scoring.stars.map((points, star) => <Input key={star} type="number" value={points} onChange={(event) => set({ scoring: { ...draft.scoring, stars: draft.scoring.stars.map((now, at) => (at === star ? Number(event.target.value) : now)) } })} aria-label={`Points for ${star + 1} ${star === 0 ? "star" : "stars"}`} className="h-8 w-12 px-1 text-center text-sm tabular-nums" />)}
                          <span className="text-xs text-muted-foreground">points, one to five stars</span>
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
            title="Reviewers"
            help={<><Help title="Reviewers" facts={<><HelpFact>People are free</HelpFact><HelpFact icon={Coins}>Models cost credits</HelpFact></>}>Each reviewer votes include, maybe or exclude on the papers they get. A person reads the title and abstract and votes. A model answers every criterion on every paper it reads, and its answers make its vote.</Help>{changed("reviewers")}</>}
            aside={<Chip>{listed([joined.length ? plural(joined.length, "person", "people") : "", people.length > joined.length ? `${people.length - joined.length} invited` : "", models.length ? plural(models.length, "model", "models") : ""].filter(Boolean)) || "Nobody yet"}</Chip>}
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
                      detail={reviewer.kind === "model" ? "AI model" : reviewer.email ? (!saved ? PERSON_SAYS.toInviteAtStart : !wasOn(reviewer) ? PERSON_SAYS.toInvite : PERSON_SAYS.invited) : reviewer.id === draft.rule.resolver && draft.rule.settle !== "one" ? PERSON_SAYS.settles : standsTo(reviewer)}
                      chips={
                        gone ? (
                          <>
                            <StateChip tone="warning" icon={Trash2}>Removed when you save</StateChip>
                            {votes ? <Chip>{plural(votes, "vote keeps", "votes keep")} counting</Chip> : null}
                          </>
                        ) : (
                          <>
                            {reviewer.model ? (
                              <>
                                {paused ? <StateChip tone="warning" icon={MODELS_SAY.paused.icon}>{MODELS_SAY.paused.row}</StateChip> : null}
                                <Chip icon={Coins}>{perPaper(reviewer.model)}</Chip>
                                {due(reviewer) ? (
                                  <Chip icon={Coins}>{credits(due(reviewer))} credits for {plural(left, "paper", "papers")}</Chip>
                                ) : null}
                                {/* A paper it couldn't read shows beside what it still has to read: one never hides the other. */}
                                {saved && unreadBy(reviewer) ? (
                                  <LinkChip href={papersHref(saved.id, { reviewer: reviewer.id, voted: "failed" })} tone="destructive" icon={TriangleAlert}>{unreadText(unreadBy(reviewer))}</LinkChip>
                                ) : !due(reviewer) && !fresh && papers ? <Chip icon={Check}>All read</Chip> : null}
                              </>
                            ) : null}
                            {votes && saved ? <LinkChip href={papersHref(saved.id, { reviewer: reviewer.id })}>{plural(votes, "vote", "votes")}</LinkChip> : null}
                          </>
                        )
                      }
                      onRemove={() => removeReviewer(reviewer)}
                      onKeep={() => keepReviewer(reviewer)}
                    />
                  );
                })}
                {!reviewerRows.length ? <motion.div key="none" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", DIVIDED_ROW)}><p className="px-4 py-4 text-sm text-muted-foreground">No reviewers yet</p></motion.div> : null}
              </AnimatePresence>
              <div className="grid gap-2 px-4 py-2.5 sm:grid-cols-2">
                <AddPerson exclude={people.map((person) => person.id)} onPick={(pick) => addReviewer("person" in pick ? personReviewer(pick.person, Date.now()) : invitedReviewer(pick.email, Date.now()))}>
                  <Button id="add-person" variant="outline" size="sm" className="w-full"><UserPlus />Add a person</Button>
                </AddPerson>
                <AddModel exclude={models.map((model) => model.model!.id)} onPick={(model) => addReviewer(modelReviewer(model, Date.now()))}>
                  <Button variant="outline" size="sm" className="w-full"><AiIcon />Add a model</Button>
                </AddModel>
              </div>
            </div>
          </Section>

          <Section
            id="decided"
            title="How a paper is decided"
            help={<><Help title="How a paper is decided" facts={<><HelpFact icon={Check}><Named name="Votes agree">Settled</Named></HelpFact><HelpFact icon={GitCompare}><Named name="Votes split">In conflict</Named></HelpFact></>}>Every vote on a paper goes into this rule. When the votes agree as the rule asks, the paper is settled. When they don&apos;t, it is in conflict, and one person settles it.</Help>{changed("decided")}</>}
          >
            <div className={cn(LIST, "bg-card")}>
              <RuleRow name="People on each paper" help={<Help title="People on each paper" facts={<><HelpFact>Models read every open paper</HelpFact><HelpFact>Everyone includes whoever joins later</HelpFact></>}>Every model reads every paper that is open when it joins. This sets how many people vote on each one. The papers are shared out so each person reads about the same number. A number stays that number when the team grows. Everyone means every person on the screening, then and later.</Help>} detail={shareSays}>
                {joined.length ? (
                  // Every number up to the team's size, then Everyone, which is its own choice: it goes on meaning everyone when someone joins, where a number stays that number. One person alone can choose it too, for whoever joins later.
                  <Segmented label="People on each paper" value={draft.rule.each !== "all" && Number(draft.rule.each) > joined.length ? (String(joined.length) as Screening["rule"]["each"]) : draft.rule.each} onChange={(next) => set({ rule: { ...draft.rule, each: next } })} options={[...Array.from({ length: joined.length }, (_, k) => ({ id: String(k + 1) as Screening["rule"]["each"], label: String(k + 1) })), { id: "all" as const, label: "Everyone" }]} />
                ) : <span className="text-sm text-muted-foreground">Add a person to choose</span>}
              </RuleRow>
              <RuleRow name="A paper is settled when" help={<Help title="Settling a paper">Every reviewer given a paper has one vote, a model as much as a person. {SETTLE_LABEL.all}: any split is a conflict. {SETTLE_LABEL.most}: more than half on one side settles it, and with no such majority it is a conflict. {SETTLE_LABEL.one}: the first vote settles it, so there is never a conflict.</Help>}>
                <Segmented label="A paper is settled when" value={draft.rule.settle} onChange={(next) => set({ rule: { ...draft.rule, settle: next } })} options={(["all", "most", "one"] as const).map((id) => ({ id, label: SETTLE_LABEL[id] }))} />
              </RuleRow>
              <RuleRow name="Conflicts are settled by" help={<Help title="Conflicts">This person sees every vote on the paper, and their decision is its result.</Help>}>
                {draft.rule.settle === "one" ? (
                  <Chip icon={Check}>No conflicts to settle under this rule</Chip>
                ) : joined.length ? (
                  <Select value={joined.some((person) => person.id === draft.rule.resolver) ? draft.rule.resolver : joined[0]!.id} onValueChange={(next) => set({ rule: { ...draft.rule, resolver: next } })}>
                    <SelectTrigger aria-label="Who settles a conflict" className="h-9 w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {joined.map((person) => <SelectItem key={person.id} value={person.id}><span className="flex items-center gap-2"><ReviewerMark reviewer={person} className="size-5" /><ReviewerName reviewer={person} you={person.id === me} /></span></SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : <Settler person={personIn(draft, draft.createdBy)} you={draft.createdBy === me} />}
              </RuleRow>
              <RuleRow name="Reviewers see the other votes" help={<Help title="Seeing other votes">After they vote keeps a reviewer from being swayed: each sees the other votes on a paper once they have voted on it, or once it is settled. Anyone who doesn&apos;t vote on a paper sees its votes at any time.</Help>}>
                <Segmented label="Reviewers see the other votes" value={draft.rule.blind} onChange={(next) => set({ rule: { ...draft.rule, blind: next } })} options={[{ id: "after" as const, label: "After they vote" }, { id: "always" as const, label: "At any time" }]} />
              </RuleRow>
              {/* What the rule does, on three made-up papers. */}
              <div className="space-y-2 bg-inset px-4 py-3">
                {/* The examples show as many votes as a paper gets here. With nobody on it yet there are none to show. */}
                {models.length + each ? (
                  <>
                    <p className="text-xs text-muted-foreground">With {plural(models.length + each, "vote", "votes")} on a paper, for example</p>
                    <RuleExamples rule={draft.rule} people={joined.length} models={models.length} />
                  </>
                ) : <p className="text-xs text-muted-foreground">Add a reviewer to see how a paper is settled.</p>}
              </div>
            </div>
            {draft.rule.settle === "one" && models.length ? <p className="rounded-2xl bg-warning/10 px-4 py-2.5 text-sm ink-warning">A model&apos;s vote can settle a paper before any person votes.</p> : null}
          </Section>

          <Section
            id="goes-to"
            title="Where included papers go"
            help={<><Help title="Where included papers go">Papers whose result is Included are added to the collection you pick, in your library or in a community, with the stars from Scoring. Nowhere keeps them in the screening only.</Help>{changed("goes-to")}</>}
          >
            <div className={cn(LIST, "bg-card")} role="radiogroup" aria-label="Where included papers go">
              {places}
            </div>
            {fromCollection ? (
              <label className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-card px-4 py-3">
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="block truncate text-sm font-medium">Remove excluded papers from {fromCollection.name}</span>
                  <span className="flex flex-wrap gap-1.5"><Chip icon={X}>Excluded leave</Chip><Chip>Maybe and in conflict stay</Chip></span>
                </span>
                <Switch checked={draft.destination.prune} onCheckedChange={(prune) => set({ destination: { ...draft.destination, prune } })} aria-label={`Remove excluded papers from ${fromCollection.name}`} />
              </label>
            ) : null}
          </Section>
        </div>

        {/* What it comes to: a well beside the form, in view while the form scrolls. */}
        <aside id="summary" aria-label="Summary" className={cn("min-w-0 border-border-subtle bg-inset/60 @max-6xl:border-t @6xl:border-s", BELOW_HEADER)}>
          <StickyColumn clear={fresh || dirty ? "5rem" : "1rem"} className="space-y-6 p-4 sm:p-6">
            {/* What saving will do, before it is done, and after it what the save did, until the next edit. Each line opens the part of the form it is about. */}
            {!fresh ? (
              <Section
                id="changes"
                title="Changes"
                help={
                  <Help title="Changing a running screening" side="left" facts={<><HelpFact icon={Check}>Votes already cast are kept</HelpFact><HelpFact>Removed reviewers stay on record</HelpFact></>}>
                    You can change anything here while the screening runs and after it is finished. Nothing is saved until you choose Save changes, and this block shows what saving will do first.
                  </Help>
                }
                aside={<>{dirty ? <StateChip tone="warning" icon={PenLine}>{edits.length} unsaved</StateChip> : lastSave ? <Chip icon={Check}>Saved just now</Chip> : null}<PastChanges /></>}
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
                      <p className="text-xs font-medium text-muted-foreground">{dirty ? "What saving does" : "What the save did"}</p>
                      <EffectList lines={dirty ? lines : lastSave!.lines} moves={dirty ? moves : lastSave!.moves} screening={saved?.id} jump done={!dirty} />
                      {/* A change applies to the papers still open. Checking the settled ones again is asked for here, where the change would give some of them another result. */}
                      {dirty && (again > 0 || recheck) ? (
                        <label className="flex items-start gap-3 rounded-xl border border-border-subtle bg-card p-2.5 text-sm">
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">Check the settled papers again</span>
                            <span className="block text-xs text-muted-foreground">{recheck ? "Every settled paper is checked under the new settings. The ones listed above get another result." : `${num(again)} settled ${again === 1 ? "paper" : "papers"} would get another result under the new settings. ${again === 1 ? "It keeps its" : "They keep their"} result unless you turn this on.`}</span>
                          </span>
                          <Switch checked={recheck} onCheckedChange={setRecheck} aria-label="Check the settled papers again" />
                        </label>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No unsaved changes</p>
                )}
              </Section>
            ) : null}
            {saved?.checking ? (
              <div className="flex items-center gap-2.5 rounded-2xl bg-card px-3 py-2.5 text-sm">
                <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
                <span className="min-w-0 flex-1">Checking for new papers</span>
                <Chip className="tabular-nums">{saved.checking.done} of {plural(saved.checking.of, "source", "sources")} checked</Chip>
              </div>
            ) : lastSave && lastCheck && lastCheck.at > saved!.createdAt ? (
              <div className="flex items-center gap-2.5 rounded-2xl bg-primary/8 px-3 py-2.5 text-sm">
                <RefreshCw className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">{lastCheck.added ? `The last check added ${plural(lastCheck.added, "new paper", "new papers")}` : "The last check found nothing new"}</span>
                {lastCheck.added ? <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs"><NextLink href={papersHref(saved!.id, { added: lastCheck.id })}>See the {plural(lastCheck.added, "paper", "papers")}<ChevronRight /></NextLink></Button> : null}
              </div>
            ) : null}

            {/* One line for each part of the form: each opens its part, and one that stops the start says so. */}
            <nav aria-label="Parts of the form" className={cn(LIST, "bg-card")}>
              {summary.map((line) => (
                <JumpLink key={line.id} to={line.id} className="flex items-center gap-3 px-3.5 py-2.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
                  {line.problem ? <TriangleAlert aria-label="Needed to start" className="mt-0.5 size-4 shrink-0 self-start ink-warning" /> : line.unset ? <Minus aria-hidden className="mt-0.5 size-4 shrink-0 self-start text-muted-foreground opacity-60" /> : <Check aria-hidden className="mt-0.5 size-4 shrink-0 self-start text-muted-foreground" />}
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
              title="Cost"
              help={
                <>
                  <Help title="Models and credits" side="left" facts={<><HelpFact>People are free</HelpFact>{setup ? <HelpFact>{setup.limits.atOnce} papers at once</HelpFact> : null}</>}>
                    <p>Each model&apos;s cost is its credits for one paper times the papers to screen. The workspace&apos;s plan lets models read {setup?.limits.atOnce ?? "so many"} papers at once, so a screening started while another&apos;s models are reading waits its turn. People can vote from the start.</p>
                    {models.length && draft.living ? <p>A living screening also pays for each new paper a check finds.</p> : null}
                  </Help>
                  {paused ? <StateChip tone="warning" icon={MODELS_SAY.paused.icon} className="ms-1.5 h-5 px-1.5">{MODELS_SAY.paused.row}</StateChip> : null}
                </>
              }
            >
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">People</span><span className="text-muted-foreground">Free</span></div>
                {models.map((model) => (
                  // The row opens the model's row under Reviewers, where a paper it couldn't read opens on the Papers page.
                  <JumpLink key={model.id} to={`reviewer-${model.id}`} block="center" className="-mx-1.5 flex min-h-7 items-center gap-2 rounded-md px-1.5 py-0.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
                    <ReviewerMark reviewer={model} className="size-5" />
                    <span className="min-w-0 truncate">{model.name}</span>
                    {!fresh && unreadBy(model) ? <StateChip tone="destructive" icon={TriangleAlert} className="h-5 px-1.5">{unreadText(unreadBy(model))}</StateChip> : !due(model) && !fresh ? <Chip icon={Check} className="h-5 px-1.5">All read</Chip> : null}
                    <span className="ms-auto shrink-0 text-end tabular-nums">{due(model) ? `${credits(due(model))} credits` : fresh ? <span className="text-muted-foreground">No papers yet</span> : null}</span>
                  </JumpLink>
                ))}
                {reread ? <div className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1">{added ? `Answering the new ${draft.criteria.filter((criterion) => !saved?.criteria.some((one) => one.key === criterion.key)).length === 1 ? "criterion" : "criteria"} on papers already read` : "Reading the papers this opens again"}</span><span className="shrink-0 tabular-nums">{credits(reread)} credits</span></div> : null}
                <div className="flex items-center gap-2 border-t border-border-subtle pt-2.5 text-sm font-semibold"><Coins className="size-4 text-primary" /><span className="flex-1">{fresh ? "Total, at most" : paused ? "Still to pay once resumed" : "Still to pay"}</span><span className="shrink-0 text-end tabular-nums">{cost || fresh ? `${credits(cost)} credits` : "Nothing"}</span></div>
                <div role="img" aria-label={cost > wallet ? `${credits(cost - wallet)} credits more than the workspace has` : `Share of the workspace's credits: ${Math.round((cost / Math.max(wallet, 1)) * 100)}%`}>
                  <Meter value={cost} max={Math.max(wallet, 1)} fill={cost > wallet ? "bg-warning" : "bg-primary"} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {cost && cost <= wallet ? <span className="text-xs tabular-nums text-muted-foreground">{cost / Math.max(wallet, 1) < 0.01 ? "Under 1%" : `${Math.round((cost / Math.max(wallet, 1)) * 100)}%`} of</span> : null}
                  <WorkspaceTag size="sm" workspace={saved ? lookOf(saved.workspace) : (here ?? { kind: "personal", name: workspace.name })}>{credits(wallet)} in {workspace.name}</WorkspaceTag>
                  {cost > wallet ? <StateChip tone="warning" icon={Coins}>{credits(cost - wallet)} credits short</StateChip> : cost ? <Chip>{credits(wallet - cost)} left after</Chip> : null}
                  {spentSoFar ? <Chip>{credits(spentSoFar)} spent so far</Chip> : null}
                  {/* In the same run of chips, so the column stays short enough to stay in view. */}
                  {models.length && draft.living ? (
                    <Chip icon={RefreshCw}>{credits(perNew)} credits a new paper{lastCheck ? `, ${credits(lastCheck.added * perNew)} for the last ${lastCheck.added}` : ""}</Chip>
                  ) : null}
                </div>
                {ahead_ && models.length ? <LinkChip href={overviewHref(ahead_.id)} icon={MODELS_SAY.waiting.icon} className="w-fit max-w-full [&>span]:shrink">{MODELS_SAY.waiting.says} {ahead_.name}</LinkChip> : null}
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
              <span className="text-sm"><span className="text-lg font-semibold tabular-nums"><AnimatedNumber value={papers} /></span> <span className="text-muted-foreground">{papers === 1 ? "paper" : "papers"} to screen</span></span>
              <span className="text-sm">{models.length ? <><span className="text-muted-foreground">Total, at most</span> <span className="font-semibold tabular-nums">{credits(cost)} credits</span></> : <span className="text-muted-foreground">People only, no credits</span>}</span>
            </div>
            <div className="ms-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
              {stop ? <Blocker block={stop} /> : null}
              {stop && cost > wallet ? <Button asChild variant="outline"><NextLink href="/settings/billing"><Coins />Add credits</NextLink></Button> : null}
              <Button disabled={Boolean(stop)} onClick={start}><ListChecks />Start screening</Button>
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
              {moved ? <StateChip tone="warning">{plural(moved, "paper changes", "papers change")} result</StateChip> : null}
              <Button asChild variant="ghost" size="sm" className="h-8"><JumpLink to="changes" find={() => document.getElementById("summary")}>Review</JumpLink></Button>
            </span>
            {holdUp ? <Blocker block={holdUp} /> : null}
            <div className="ms-auto flex items-center gap-2">
              <Button variant="ghost" onClick={() => setDiscarding(edits)}>Discard</Button>
              <Button disabled={Boolean(holdUp)} onClick={save}><Check />Save changes</Button>
            </div>
          </div>
        </ActionBar>
      ) : null}
      <ConfirmChange open={discarding !== null} title={`Discard ${discarding?.length ?? 0} unsaved ${discarding?.length === 1 ? "change" : "changes"}?`} confirm="Discard" cancel="Keep editing" variant="destructive" onClose={() => setDiscarding(null)} onConfirm={discard}>
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
            title="New screening"
            trail={[SCREENINGS_CRUMB]}
            titleAside={<Help title="Screening" side="bottom" facts={<><HelpFact>Title and abstract only</HelpFact><HelpFact>People and AI models</HelpFact></>}>Your reviewers vote include, maybe or exclude on each paper&apos;s title and abstract. A rule you choose turns the votes into a result, and a paper the votes split on goes to one person.</Help>}
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
  // Removed here and not saved yet: the chip beside the name says so, and the name carries no "Taken off" of its own.
  const name = <ReviewerName reviewer={gone ? { ...reviewer, left: undefined } : reviewer} you={you} className={cn("text-sm font-medium", gone && "text-muted-foreground line-through")} />;
  return (
    <motion.div id={`reviewer-${reviewer.id}`} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", BELOW_HEADER, DIVIDED_ROW)}>
      <div className={cn("flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition-colors", gone && TONE.warning.panel)}>
        <ReviewerMark reviewer={reviewer} className="size-9 self-start" />
        <div className="min-w-0 flex-1">
          {href && !gone ? <NextLink href={href} className="flex w-fit max-w-full rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">{name}</NextLink> : name}
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
        {/* On a phone the chips take a line of their own under the name. */}
        {chips ? <span className="flex flex-wrap items-center justify-end gap-1.5 max-sm:order-last max-sm:basis-full max-sm:justify-start max-sm:ps-12">{chips}</span> : null}
        {gone ? (
          <Button variant="ghost" size="sm" className="h-8" onClick={onKeep}><Undo2 />Keep</Button>
        ) : (
          <TooltipHint label={`Remove ${reviewer.name}`}><Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Remove ${reviewer.name}`} onClick={onRemove}><Trash2 /></Button></TooltipHint>
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
  return <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={frame?.openActivity}>Activity</Button>;
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
  const read = (text: string) => [...new Set(text.split(",").map((term) => term.trim()).filter(Boolean))].slice(0, MAX_TERMS);
  return (
    <div className="flex items-start gap-1 ps-1 text-muted-foreground">
      <Highlighter aria-hidden className="mt-1 size-3.5 shrink-0" />
      <Textarea rows={1} value={typing ?? criterion.terms.join(", ")} onChange={(event) => { setTyping(event.target.value); onChange(read(event.target.value)); }} onBlur={() => setTyping(null)} aria-label={`Words to mark for criterion ${n}`} placeholder="Add words to mark in the abstract, with commas between them" className="min-h-0 min-w-0 flex-1 resize-none border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground shadow-none field-sizing-content placeholder-shown:border-dashed placeholder-shown:border-border hover:border-border-subtle" />
    </div>
  );
}

/** Rows one page of what a source left out holds. */
const LEFT_PAGE = 8;
/** What one of a running screening's sources held and didn't take, a page at a time, each with why. */
function LeftOut({ jobId, sourceId, total }: { jobId: Id<"screeningJobs">; sourceId: Id<"screeningSources">; total: number }) {
  const rows = useCursorPage(api.screening.view.leftOut, inWorkspace(usePageWorkspace(), { jobId, sourceId }), LEFT_PAGE);
  return (
    <div className="space-y-2">
      {/* The list holds its rows' height from the first frame: how many there are is known before they are read. */}
      <ul className={cn("divide-y divide-border-subtle transition-opacity", rows.isStale && "pointer-events-none opacity-60")} style={{ minHeight: Math.min(total, LEFT_PAGE) * 45 }}>
        {rows.items.map((row) => (
          <li key={row.id} className="flex min-h-11 items-center gap-x-3 gap-y-1 py-1.5 max-sm:flex-wrap">
            <p className="min-w-0 flex-1 truncate text-sm max-sm:basis-full">{row.name}</p>
            <StateChip tone="warning" icon={FileX}>{LEFT_WHY[row.why]}</StateChip>
          </li>
        ))}
      </ul>
      {rows.hasPages ? <CommandCenterPagination className="pt-1" currentPage={rows.page} itemLabel="left out" steps={{ canPrevious: rows.canPrevious, canNext: rows.canNext, onPrevious: rows.previous, onNext: rows.next, offset: rows.offset, shown: rows.items.length, total }} /> : null}
    </div>
  );
}
