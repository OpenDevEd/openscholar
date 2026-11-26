"use client";

// A screening's form: where its papers come from, the criteria, who reads them, how a paper is
// decided and where the included ones go. A new screening starts from it, and a running or finished
// one is changed with the same form, which says what each change will do before it is saved.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import { GitCompare, AiIcon, Ban, Check, ChevronDown, ChevronRight, CircleHelp, Clock, Coins, Copy, ExternalLink, Eye, FileX, Folder, FolderPlus, Globe, Hash, Link2, ListChecks, Lock, Minus, MoreHorizontal, PenLine, Plus, RefreshCw, Search, Trash2, TriangleAlert, Undo2, Upload, UserPlus, X, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { ListEmpty } from "@/components/evidence-libraries/list-controls";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { AnimatedNumber, Chip, Meter, SOURCE_ICON } from "@/components/screening/parts";
import { PaperScope, PickMark } from "@/components/screening/source-row";
import { EASE } from "@/components/settings/model-map";
import { LIST, Segmented, pagerOf } from "@/components/settings/parts";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { FadeRow } from "@/components/ui/fade-row";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpFact } from "@/components/ui/help";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { PDF_HOW, PDF_LEFT, paperAt, pdfAdded, pdfStands, type PdfFile, listed, num, PERSON_SAYS, SETTLE_LABEL, foundTotal, grown, hash, readersOf, slug, firstName, plural, DEFAULT_RULE, EVERY_LABEL, GROWS, HOME, NOW, PERIOD, asStarted, projected, readNext, readsAgain, recheckable, SCHEDULE, SHORT_NAME_LENGTH, WORKSPACES, accessOf, baseTotal, day, growing, themeFor, workspaceOf, activeReviewers, defaultScoring, invitedReviewer, modelReviewer, modelsOf, paperTotal, papersOf, peopleOf, personOf, personReviewer, shortOf, standing, taken, type Criterion, type Move, type Reviewer, type Screening, type Source, type SourceKind, lookOf, includedIn, inQuotes, seesVotes, inOrder, standsTo, startedSays } from "./data";
import { ANOTHER_COLLECTION, EffectList, JumpLink, collectionName, criterionName, effectItems, effectMoves, landOn, lineText, movesText, rereads, scoringChanged, type EffectLine, type EffectSection } from "./effects";
import { SCREENINGS_CRUMB, overviewHref, papersHref } from "./links";
import { useWorkspace } from "./workspace";
import { COLLECTIONS, COMMUNITIES, COMMUNITY_COLLECTIONS, OFFERS, PDF_FILES, REFERENCE_FILES, TABLE_FILES, UPLOAD_ACCEPT, UPLOAD_FORMATS, WRITTEN, type CommunityRow, type Offer } from "./form-data";
import { MockStates } from "./mock-states";
import { ColumnMatch, DoiTab, OfferRow, SourceItems, WrongPaper, ZoteroTab, type ItemRow, type PendingTable, type ZoteroPick } from "./sources";
import { NOT_A_DOI, doiOutcome, pdfOutcome, readReferences, readTable, tableCounts, type ColumnKey } from "./upload-read";
import { youFirst, EmptyNote, ActionBar, BELOW_HEADER, DIVIDED_ROW, Help, kindIcon, LinkChip, Named, Panel, ReviewerMark, ReviewerName, Section, StateChip, StickyColumn, RuleExamples, TONE, MODELS_SAY, INLINE_LINK } from "./parts";
import { paid, walletOf, credits, isReading, paperCredits, useMock, toppedUp, spentOf, perPaper, settingsOf, modelsState } from "./store";
import { AddModel, AddPerson, ConfirmChange } from "./team";
import { ScrollArea } from "@/components/ui/scroll-area";

// The whole library and its collections are one place to a person, so they share a tab.
type Kind = Exclude<SourceKind, "pdf" | "saved">;
const KINDS: Array<{ id: Kind; label: string; icon: AppIcon; find?: string }> = [
  { id: "search", label: "Search", icon: SOURCE_ICON.search },
  // A file follows a search: the two ways most people bring papers. On a phone the row shows its first three or four, and someone who came with a file looked for it and didn't find it.
  { id: "upload", label: "Upload", icon: Upload },
  { id: "collection", label: "Library", icon: SOURCE_ICON.saved, find: "Find a collection" },
  { id: "screening", label: "Screening", icon: SOURCE_ICON.screening },
  { id: "evidenceLibrary", label: "Community", icon: SOURCE_ICON.evidenceLibrary },
  { id: "zotero", label: "Zotero", icon: SOURCE_ICON.zotero },
  { id: "dois", label: "DOIs", icon: Hash },
];
const OFFER_PAGE = 5;
/** Why a file became no source: not a kind it reads, nothing in it to read, or a PDF that can't be screened. */
type Refusal = "type" | "empty" | "twice" | keyof typeof PDF_LEFT;
const REFUSALS: Refusal[] = ["type", "empty", "twice", "abstract", "scan", "broken"];
/** A batch of PDFs with the ones another source already holds marked: the last so many of those taken, as the count of duplicates is made up. */
const twinned = (files: PdfFile[], count: number) => { let left = count; return [...files].reverse().map((file) => (left > 0 && pdfAdded(file) ? (left--, { ...file, twin: true }) : file)).reverse(); };
function refusalSays(why: Refusal, names: string[]) {
  const many = names.length > 1;
  const files = listed(names);
  if (why === "type") return `Couldn't read ${files}. It reads ${UPLOAD_FORMATS} files.`;
  if (why === "empty") return `Found no references in ${files}.`;
  if (why === "twice") return `${files} ${many ? "are" : "is"} already in this screening.`;
  if (why === "abstract") return `${files} ${many ? "have" : "has"} no abstract, in the file or in any index, and ${many ? "were" : "was"} left out.`;
  if (why === "scan") return `${files} ${many ? "are scans" : "is a scan"} with no text to read, and ${many ? "were" : "was"} left out.`;
  return `${files} ${many ? "aren't PDFs that open" : "isn't a PDF that opens"}.`;
}
/** What a reference file's records give the screening, with the lookups made up in the shares measured: nine in ten records with a DOI are in the index, a third of the others, and a lookup fills a fifth of the missing abstracts. */
function recordFacts({ records, untitled, noAbstract, withDoi }: { records: number; untitled: number[]; noAbstract: number; withDoi: number }) {
  const matched = Math.min(records, Math.round(withDoi * 0.93 + (records - withDoi) * 0.35));
  const bare = Math.round(noAbstract * 0.8);
  return {
    facts: [...(matched ? [`${num(matched)} found in Openscholar's index`] : []), ...(records - matched ? [`${num(records - matched)} not in the index`] : []), ...(bare ? [`${num(bare)} without an abstract`] : [])],
    left: untitled.map((place) => ({ name: `Record ${num(place)} of the file`, why: "No title" })),
  };
}
/**
 * What happened on a running screening while its settings were open, which a save keeps: the votes, how far each
 * model has read, what was settled, the results held and let go, the papers moved between reviewers, the places of
 * papers that came in, and what was said about a paper. A model the draft starts over, after its votes were thrown
 * out, keeps that fresh start. The preview and the save both read this, so they agree.
 */
const live = (draft: Screening, now: Screening) => {
  const over = draft.reviewers.filter((one) => one.kind === "model" && !one.discarded && now.reviewers.some((was) => was.id === one.id && was.discarded));
  return { reached: { ...draft.reached, ...now.reached, ...Object.fromEntries(over.map((one) => [one.id, draft.reached[one.id] ?? 0])) }, cast: now.cast, resolved: now.resolved, kept: now.kept, placed: now.placed, started: now.started, moved: now.moved, threads: now.threads };
};
const withLive = (draft: Screening, now: Screening): Screening => ({ ...draft, ...live(draft, now) });
const nextSlot = (sources: Source[]) => Math.max(-1, ...sources.map((source) => source.slot)) + 1;
const sourceId = (sources: Source[], name: string) => `src-${nextSlot(sources)}-${hash(name) % 1000}`;

/** Where a source can be read as it stands, in a new tab: a search runs again, a collection opens where it lives, a screening opens its included papers. A file or pasted DOIs have nowhere to open. */
function sourceLink(source: Pick<Source, "kind" | "name" | "detail">, screenings: Screening[]): { href: string; where: string } | null {
  if (source.kind === "search") return { href: `/results?q=${encodeURIComponent(source.name)}`, where: "in the search" };
  if (source.kind === "saved") return { href: "/library", where: "in your library" };
  if (source.kind === "collection") {
    const collection = COLLECTIONS.find((one) => one.name === source.name);
    return { href: collection ? `/library?col=${collection.id}` : "/library", where: "in the collection" };
  }
  if (source.kind === "screening") {
    const screening = screenings.find((one) => source.name === includedIn(one.name));
    return screening ? { href: papersHref(screening.id, { result: "include" }), where: "in the screening" } : null;
  }
  if (source.kind === "evidenceLibrary") {
    const community = COMMUNITIES.find((one) => source.detail === `In ${one.name}`);
    if (!community) return null;
    return { href: source.name.startsWith("Every record in") ? community.address : `${community.address}/collections/${slug(source.name)}`, where: "in the community" };
  }
  if (source.kind === "zotero") return { href: "https://www.zotero.org/mylibrary", where: "in Zotero" };
  return null;
}

/** Stars follow the criteria until someone sets them: a screening with three criteria doesn't give five stars at one point. */
function withCriteria(d: Screening, criteria: Criterion[], points: Screening["scoring"]["points"]): Screening {
  const untouched = JSON.stringify(d.scoring.stars) === JSON.stringify(defaultScoring(d.criteria).stars);
  return { ...d, criteria, scoring: { ...d.scoring, points, ...(untouched ? { stars: defaultScoring(criteria).stars } : {}) } };
}

/** A screening nobody has started: the person making it as its one reviewer, the usual rule, and nothing else yet. */
function blank(me: string): Screening {
  const person = personOf(me)!;
  return {
    id: "",
    name: "",
    createdBy: me,
    createdAt: NOW,
    question: "",
    sources: [],
    criteria: [],
    reviewers: [personReviewer(person, NOW)],
    rule: { ...DEFAULT_RULE, each: "1", resolver: me },
    scoring: defaultScoring([]),
    destination: { kind: "new", name: "", prune: false },
    seed: 20,
    reached: {},
    cast: {},
    resolved: {},
    changes: [],
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
/** What a save changed, in a few words, for the screening's activity. */
const describe = (before: Screening, after: Screening) => changesOf(before, after).map((part) => part.text).join(", ").replace(/, ([A-Z])/g, (_, letter: string) => `, ${letter.toLowerCase()}`);
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
  const store = useMock();
  const router = useRouter();
  const [from] = useQueryState("from");
  const saved = id ? store.screenings.find((one) => one.id === id) : undefined;
  const copied = !id && from ? store.screenings.find((one) => one.id === from) : undefined;
  // What the form starts from: the saved screening, a copy of another to run again, or nothing yet.
  // A copy's sources start over: what they hold now is what the new screening starts with, and nothing has come in since.
  // Built for whoever is looking: the mock restores who that is after the first draw, so it isn't fixed at the first.
  const made = useMemo<Screening>(() =>
    copied
      ? { ...blank(store.viewer), name: `${copied.name}, again`, question: copied.question, sources: copied.sources.map((source) => ({ ...source, id: `src-${source.slot}-${hash(source.name) % 1000}`, updates: undefined, scope: "all" as const, range: [1, Math.max(1, source.total)] as [number, number], addedAt: NOW })), criteria: copied.criteria, theme: copied.theme, reviewers: activeReviewers(copied), rule: copied.rule, scoring: copied.scoring, destination: { ...copied.destination, name: "" } }
      : blank(store.viewer),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one blank form for each person and each screening it is copied from
  [store.viewer, copied?.id]);
  const origin = saved ?? made;
  // What isn't saved yet is kept by the mock's store, so leaving the page and coming back loses nothing.
  const key = id ?? `new:${from ?? ""}`;
  const draft = store.drafts[key] ?? origin;
  // What the last save did, shown under Changes until the next edit.
  const [lastSave, setLastSave] = useState<{ edits: Edit[]; lines: EffectLine[]; moves: Move[] } | null>(null);
  const [discarding, setDiscarding] = useState<Edit[] | null>(null);
  const setDraft = (next: Screening | ((now: Screening) => Screening)) => {
    setLastSave(null);
    // An edit taken back leaves nothing unsaved: a draft that says what is saved is no draft.
    store.draft(key, (now) => {
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
  const [offerPage, setOfferPage] = useState(1);
  // The source whose row is open, and on which part: the papers taken from it, or what it held and left out.
  const [openSource, setOpenSource] = useState<{ id: string; part: "papers" | "left" } | null>(null);
  const [reading, setReading] = useState<string[]>([]);
  // Files that became no source, each with why.
  const [rejected, setRejected] = useState<Array<{ name: string; why: Refusal }>>([]);
  // Tables whose columns someone has to name before they are added.
  const [pending, setPending] = useState<PendingTable[]>([]);
  // Counts up each time the form's changes are thrown away, so a file that was still being read then is dropped.
  const epoch = useRef(0);
  // Zotero sources just added, while their papers' abstracts are counted.
  const [counting, setCounting] = useState<string[]>([]);
  // Sources of pasted DOIs while the DOIs are looked up: the row is there at once, and its counts follow.
  const [looking, setLooking] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  // The Community tab: which community, which of its collections, and ones brought in by their address.
  const [community, setCommunity] = useState(COMMUNITIES[0]!.id);
  const [group, setGroup] = useState<"all" | CommunityRow["group"]>("all");
  const [address, setAddress] = useState("");
  const [addressProblem, setAddressProblem] = useState<string | null>(null);
  const [pasted, setPasted] = useState<CommunityRow[]>([]);
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [where, setWhere] = useState<"openscholar" | "community">(draft.destination.kind === "community" ? "community" : "openscholar");
  const files = useRef<HTMLInputElement>(null);
  // The draft with what happened on the running screening since its settings were opened. Kept from draw to draw, so what it projects is worked out once. It is here, over the returns below, because a hook can't follow a return: someone who opens Settings without the right to change it is shown the lock, and the page then drew fewer hooks than the draw before and fell over.
  const merged = useMemo(() => (saved ? withLive(draft, saved) : draft), [draft, saved]);

  // A screening that is gone, or not shared with the person, is said by the frame its settings open in.
  if (id && (!saved || !accessOf(saved, store.viewer))) return null;

  // Its workspace's members change it. The frame has no Settings tab for anyone else, and the address alone says why.
  if (saved && !accessOf(saved, store.viewer)?.member) {
    return (
      <ListEmpty icon={Lock} action={<Button asChild variant="outline" size="sm"><NextLink href={overviewHref(saved.id)}>Go to the Overview<ChevronRight /></NextLink></Button>}>
        Only members of {workspaceOf(saved).name} can change these settings
      </ListEmpty>
    );
  }

  const fresh = !saved;
  // A new screening is made in the workspace you are in. Someone from outside this one is in their own.
  const outsider = Boolean(personOf(store.viewer)?.guest);
  const workspace = saved ? workspaceOf(saved) : outsider ? WORKSPACES.find((one) => one.id === "theirs")! : HOME;
  // The credits its models are paid from: its own workspace's.
  const purse = saved ?? { workspace: workspace.id };
  const wallet = walletOf(purse, store);
  // The workspace's models read so many papers at once: a screening started while another's are reading waits its turn.
  // Only a screening of the same workspace is ahead of it: each workspace's models take turns among themselves.
  const busy = fresh ? store.screenings.find((one) => isReading(one) && workspaceOf(one) === workspace) : undefined;
  const set = (patch: Partial<Screening>) => setDraft((d) => ({ ...d, ...patch }));
  const people = peopleOf(draft);
  // Someone invited by email reads papers once they have joined.
  const { people: joined, each } = readersOf(draft);
  const models = modelsOf(draft);
  const found = foundTotal(draft.sources);
  const papers = paperTotal(draft.sources);
  // The running screening as a save would leave it: the papers that were settled held as they are, unless the change asks for them to be checked again.
  const held = saved ? projected(saved, merged) : null;
  // What each person reads. A new screening shares all of it out evenly. A running one says what a save would leave each person with: settled papers take nobody new, so the loads can differ.
  const share = (() => {
    if (!joined.length) return undefined;
    if (!held && joined.length === 1) return `${joined[0]!.id === store.viewer ? "You read" : `${firstName(joined[0]!.name)} reads`} every paper`;
    if (!held) return `About ${num(Math.ceil((papers * each) / joined.length))} papers for each person`;
    const state = standing(held);
    const loads = joined.map((person) => state.papers.filter((paper) => state.votes[paper.id]!.some((one) => one.reviewer.id === person.id)).length);
    const [least, most] = [Math.min(...loads), Math.max(...loads)];
    return most - least <= 2 ? `About ${num(most)} papers for each person` : `${num(least)} to ${num(most)} papers for each person`;
  })();
  // The papers each model has still to read: all of them for a new screening, and for a running one the ones still open that it hasn't got to.
  const ahead = (model: Reviewer) => (held ? readNext(held, model, Infinity, () => Infinity).read : papers);
  const due = (model: Reviewer) => paperCredits(model.model!) * ahead(model);
  // What a save has each model read at once, and pay for: a criterion added to a running screening is answered on the open papers it has read, and a check of the settled papers opens some it had passed over.
  const added = Boolean(saved && draft.criteria.some((criterion) => !saved.criteria.some((one) => one.key === criterion.key)));
  const atOnce = (model: Reviewer) => (held && saved ? (added ? rereads(held, model) : readsAgain(saved, held, model)) * paperCredits(model.model!) : 0);
  const reread = models.reduce((sum, model) => sum + atOnce(model), 0);
  // How many settled papers the change would move if they were checked again. They keep their result unless that is asked for.
  const again = saved ? recheckable(saved, merged) : 0;
  const cost = models.reduce((sum, model) => sum + due(model), 0) + reread;
  const perNew = models.reduce((sum, model) => sum + paperCredits(model.model!), 0);
  // What keeps its models from reading now: a model added here starts once that is over, and the line says so.
  const heldNow = saved ? modelsState(merged, store.screenings, store) : null;
  const lines = saved ? effectItems(saved, merged, { me: store.viewer, wallet, waiting: heldNow === "waiting" }) : [];
  const moves = saved ? effectMoves(saved, merged) : [];
  // A model answers criteria: with none it would include every paper it reads.
  const needsCriteria = models.length > 0 && draft.criteria.length === 0;
  const lastCheck = saved?.updates?.findLast((update) => update.added > 0);
  const edits = saved ? changesOf(saved, draft) : [];
  const dirty = edits.length > 0;
  // Paused models read nothing until someone resumes them: their rows and the cost say so.
  const paused = Boolean(saved?.paused && !saved.finishedAt && models.length);
  const unsaved = `${edits.length} unsaved ${edits.length === 1 ? "change" : "changes"}`;
  const moved = moves.reduce((sum, move) => sum + move.papers.length, 0);
  // Beside a part's title while it holds an edit that isn't saved.
  const changed = (...sections: EffectSection[]) => (edits.some((edit) => sections.includes(edit.section)) ? <StateChip tone="warning" icon={PenLine} className="ms-1.5 h-5 px-1.5">Changed</StateChip> : null);
  // A criterion whose question was deleted asks nothing, and leaves its short name no words to fall back to.
  const unasked = draft.criteria.some((criterion) => !criterion.text.trim()) ? { text: "Write a question for the empty criterion", section: "criteria" as const, focus: "#criteria textarea[aria-invalid=true]" } : null;
  // What it has to be able to pay for now: all its reading to start, and for a running screening only what the save itself has the models read. What is left to read is paid for as it is read, and stops where the credits do.
  const owed = saved ? reread : cost;
  // What neither starting nor saving can do yet, and the control that fixes it: the reason opens its section and puts the cursor there.
  const lacking: Block | null = unasked ?? (needsCriteria ? { text: models.length > 1 ? "Add a criterion for the models" : "Add a criterion for the model", section: "criteria", focus: "#new-criterion" } : owed > wallet ? { text: `${credits(owed - wallet)} credits short` } : null);
  // A table that waits for its columns isn't counted yet: starting or saving now would leave it out.
  const waiting: Block | null = pending.length ? { text: "Name the table's columns, or remove it", section: "papers" } : null;
  const holdUp = saved ? (waiting ?? lacking) : null;
  // How many votes each reviewer has cast, and which papers each check added: what a row's chips open.
  const savedState = saved ? standing(saved) : null;
  const votesOf = (reviewer: Reviewer) => (savedState ? savedState.papers.reduce((sum, paper) => sum + (savedState.votes[paper.id]?.some((one) => one.reviewer.id === reviewer.id && one.vote) ? 1 : 0), 0) : 0);
  const wasOn = (reviewer: Reviewer) => Boolean(saved?.reviewers.some((one) => one.id === reviewer.id && !one.left));
  // The papers a model got to and couldn't read: it has read everything else.
  const unreadBy = (reviewer: Reviewer) => (savedState ? savedState.papers.filter((paper) => savedState.votes[paper.id]?.some((one) => one.reviewer.id === reviewer.id && one.failed)) : []);
  const unreadText = (count: number) => `${num(count)} couldn't be read`;
  // Why it can't start yet: it needs papers and a reviewer first.
  const stop: Block | null = waiting
    ? waiting
    : !papers
    ? { text: "Add papers to start", section: "papers", focus: "#add-papers [role=tab][data-state=active]" }
    : !activeReviewers(draft).length
      ? { text: "Add a reviewer to start", section: "reviewers", focus: "#add-person" }
      : lacking;

  const addSource = (kind: SourceKind, name: string, detail: string, total: number, facts?: string[], more?: Partial<Source>) =>
    setDraft((d) => {
      // Two Zotero collections can share a name, and so can two files: what a source reads tells them apart where it says.
      if (d.sources.some((source) => (more?.ref ? source.ref === more.ref : source.kind === kind && source.name === name))) return d;
      const duplicates = d.sources.length && total > 3 ? Math.min(total - 1, Math.round(total * 0.07) + (hash(name) % 4)) : 0;
      const slot = nextSlot(d.sources);
      return { ...d, sources: [...d.sources, { id: sourceId(d.sources, name), slot, kind, name, detail, total, scope: "all", range: [1, Math.max(1, total)], duplicates, addedAt: Date.now(), ...(facts ? { facts } : {}), ...more, ...(more?.files ? { files: twinned(more.files, duplicates) } : {}) }] };
    });
  // A source picked from a list opens to which of its papers are taken, as picking one does on the page this replaces.
  const openAdded = (name: string, total: number) => { if (total > 1) setOpenSource({ id: sourceId(draft.sources, name), part: "papers" }); };
  const patchSource = (id: string, patch: Partial<Source> | ((source: Source) => Partial<Source>)) =>
    setDraft((d) => ({ ...d, sources: d.sources.map((source) => (source.id === id ? { ...source, ...(typeof patch === "function" ? patch(source) : patch) } : source)) }));
  const refuse = (names: string[], why: Refusal) => setRejected((now) => [...now.filter((one) => !names.includes(one.name)), ...names.map((name) => ({ name, why }))]);
  // A file's records as a source: how many the index knows, how many have no abstract, and the ones with no title, which are left out.
  const addRecords = (name: string, detail: string, counts: Parameters<typeof recordFacts>[0], ref: string) => {
    if (!counts.records) return refuse([name], "empty");
    const { facts, left } = recordFacts(counts);
    addSource("upload", name, detail, counts.records, facts, { ref, ...(left.length ? { left } : {}) });
  };
  // What a file holds is counted from the file itself. A reference file becomes a source of its own, a table waits for its columns where it can't name them, and PDFs join one source between them. The same file a second time is turned away.
  const take = async (list: FileList | File[]) => {
    const all = [...list];
    const held = (ref: string) => draft.sources.some((source) => source.ref === ref) || pending.some((one) => one.ref === ref);
    const refOf = (file: File) => `file:${file.name}:${file.size}`;
    const references = all.filter((file) => REFERENCE_FILES.test(file.name) && !held(refOf(file)));
    const pdfs = all.filter((file) => PDF_FILES.test(file.name)).map((file) => file.name);
    const pdfRef = `pdfs:${hash(pdfs.join("|"))}`;
    const other = all.filter((file) => !REFERENCE_FILES.test(file.name) && !PDF_FILES.test(file.name)).map((file) => file.name);
    if (other.length) refuse(other, "type");
    const twice = [...all.filter((file) => REFERENCE_FILES.test(file.name) && held(refOf(file))).map((file) => file.name), ...(pdfs.length && held(pdfRef) ? pdfs : [])];
    if (twice.length) refuse(twice, "twice");
    const batch = pdfs.length && !held(pdfRef) ? pdfs : [];
    const names = [...references.map((file) => file.name), ...(batch.length ? [plural(batch.length, "PDF", "PDFs")] : [])];
    if (!names.length) return;
    setReading((now) => [...now, ...names]);
    const from = epoch.current;
    // The pause stands in for the time a real read takes.
    const [texts] = await Promise.all([Promise.all(references.map((file) => file.text())), new Promise((done) => setTimeout(done, 1100))]);
    setReading((now) => now.filter((name) => !names.includes(name)));
    // The form's changes were thrown away while the files were read: what they held goes with them.
    if (from !== epoch.current) return;
    references.forEach((file, at) => {
      if (!TABLE_FILES.test(file.name)) {
        const read = readReferences(texts[at]!);
        return read ? addRecords(file.name, `${read.format} file`, read, refOf(file)) : refuse([file.name], "empty");
      }
      const table = readTable(texts[at]!);
      if (!table) return refuse([file.name], "empty");
      if (table.ask) return setPending((now) => [...now, { name: file.name, ref: refOf(file), table, picked: table.picked }]);
      addRecords(file.name, "Table", tableCounts(table, table.picked), refOf(file));
    });
    if (batch.length) {
      const read = batch.map((name, place) => pdfOutcome(name, place));
      const taken = read.filter(pdfAdded).length;
      // A batch none of which can be screened is no source: each file is named with why.
      if (taken) addSource("pdf", `${batch[0]}${batch.length > 1 ? ` and ${num(batch.length - 1)} more` : ""}`, batch.length === 1 ? "A PDF" : "PDFs", taken, undefined, { ref: pdfRef, files: read });
      else for (const why of ["abstract", "scan", "broken"] as const) { const files = read.filter((file) => file.how === why).map((file) => file.name); if (files.length) refuse(files, why); }
    }
  };
  // Pasted DOIs are looked up: the ones found are the source, and the rest are listed on its row with why. The source holds what the lookup gives from the start, and its row shows "Looking up" over it for as long as a lookup takes, so nothing arrives later that removing the source or throwing the changes away could miss. When none is found there is no source: what comes back says how many don't exist and how many have no record.
  const lookUp = (dois: string[]) => {
    const outcomes = dois.map((doi) => ({ doi, ...doiOutcome(doi) }));
    const found = outcomes.flatMap((one) => (one.found ? [one] : []));
    const left = outcomes.flatMap((one) => (one.found ? [] : [{ name: one.doi, why: one.why }]));
    if (!found.length) return { none: left.filter((one) => one.why === NOT_A_DOI).length, bare: left.filter((one) => one.why !== NOT_A_DOI).length };
    const name = `${found[0]!.doi}${found.length > 1 ? ` and ${num(found.length - 1)} more` : ""}`;
    const id = sourceId(draft.sources, name);
    const bare = found.filter((one) => !one.abstract).length;
    addSource("dois", name, "Pasted DOIs", found.length, bare ? [`${num(bare)} without an abstract`] : [], { ref: `dois:${hash(dois.join())}`, ...(left.length ? { left } : {}) });
    setLooking((now) => [...now, id]);
    setTimeout(() => setLooking((now) => now.filter((one) => one !== id)), 1100);
    return null;
  };
  // A library or a collection of Zotero's is added at once. How many of its papers lack an abstract is known once they are read: the row shows "Counting abstracts" over the count for that long. A made-up fifth of the missing ones is filled by a lookup.
  const addZotero = (pick: ZoteroPick) => {
    const id = sourceId(draft.sources, pick.name);
    const bare = Math.round(pick.total * (1 - pick.abstracts / 100) * 0.8);
    openAdded(pick.name, pick.total);
    addSource("zotero", pick.name, pick.detail, pick.total, [bare ? `${num(bare)} without an abstract` : "Every paper has an abstract"], { ref: pick.ref, filters: pick.filters });
    setCounting((now) => [...now, id]);
    setTimeout(() => setCounting((now) => now.filter((one) => one !== id)), 1400);
  };
  const pickColumn = (name: string, key: ColumnKey, head: string | undefined) => setPending((now) => now.map((one) => (one.name === name ? { ...one, picked: { ...one.picked, [key]: head }, untitled: false } : one)));
  const addTable = (table: PendingTable) => {
    if (!table.picked.title) return setPending((now) => now.map((one) => (one.ref === table.ref ? { ...one, untitled: true } : one)));
    addRecords(table.name, "Table", tableCounts(table.table, table.picked), table.ref);
    setPending((now) => now.filter((one) => one.ref !== table.ref));
  };
  // A PDF whose match is the wrong paper is read from its own first page, or left out where that page has no abstract. The source's counts follow its files, and a range that reached past them is drawn in.
  const setWrong = (id: string, name: string) =>
    patchSource(id, (now) => {
      const files = now.files!.map((file) => (file.name === name ? { ...file, wrong: !file.wrong } : file));
      const total = files.filter(pdfAdded).length;
      const end = Math.min(now.range[1], total);
      const ranged = now.scope === "range" && now.range[0] <= end;
      return { files, total, duplicates: files.filter((file) => pdfAdded(file) && file.twin).length, scope: ranged ? "range" : "all", range: ranged ? [now.range[0], end] : [1, Math.max(1, total)] };
    });

  // A criterion decides unless it is marked as nice to have: an inclusion criterion that excludes nothing is a surprise.
  const addCriterion = (words: string, short?: string) =>
    setDraft((d) => {
      const clean = words.trim();
      if (!clean || d.criteria.some((criterion) => criterion.text.toLowerCase() === clean.toLowerCase())) return d;
      const key = `c${hash(clean)}`;
      return withCriteria(d, [...d.criteria, { key, text: clean, short: short ?? shortOf(clean), must: true, terms: [], addedAt: Date.now() }], { ...d.scoring.points, [key]: [1, 0, 0] });
    });
  const patchCriterion = (key: string, patch: Partial<Criterion>) => setDraft((d) => ({ ...d, criteria: d.criteria.map((criterion) => (criterion.key === key ? { ...criterion, ...patch } : criterion)) }));
  const copyCriteria = (one: Screening) =>
    setDraft((d) => {
      const fresh = one.criteria.filter((criterion) => !d.criteria.some((mine) => mine.key === criterion.key || mine.text === criterion.text));
      return withCriteria(d, [...d.criteria, ...fresh.map((criterion) => ({ ...criterion, addedAt: Date.now() }))], { ...Object.fromEntries(fresh.map((criterion) => [criterion.key, one.scoring.points[criterion.key] ?? [1, 0, 0]])), ...d.scoring.points });
    });
  const shortNameHelp = <Help title="Short name" facts={<HelpFact>Up to {SHORT_NAME_LENGTH} characters</HelpFact>}>The name a criterion goes by where its question doesn&apos;t fit: table columns, filters, and the reasons papers were excluded. It is the question&apos;s own words until you write one.</Help>;
  const copyable = store.screenings.filter((one) => one.id !== id && one.criteria.length).slice(0, 8);
  const allWritten = WRITTEN.every((written) => draft.criteria.some((criterion) => criterion.text === written.text));
  const cantWrite = !draft.question.trim() ? "Write a research question first" : allWritten ? "Already added" : null;
  const writeCriteria = () => {
    setWriting(true);
    setTimeout(() => {
      WRITTEN.forEach((written) => addCriterion(written.text, written.short));
      setWriting(false);
    }, 1200);
  };

  const addReviewer = (reviewer: Reviewer) =>
    setDraft((d) => {
      // Someone taken off and put back counts again from where they were.
      // Someone put back on keeps the votes they cast and their place in the reading. A model whose votes were thrown out starts its reading over.
      const startsOver = d.reviewers.some((one) => one.id === reviewer.id && one.kind === "model" && one.discarded);
      const reviewers = d.reviewers.some((one) => one.id === reviewer.id) ? d.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: undefined, ...(startsOver ? { discarded: undefined, skips: undefined } : {}) } : one)) : [...d.reviewers, { ...reviewer, addedAt: fresh ? d.createdAt : Date.now() }];
      const here = reviewers.filter((one) => !one.left && one.kind === "person" && !one.email).length;
      return {
        ...d,
        reviewers,
        reached: startsOver ? { ...d.reached, [reviewer.id]: 0 } : { [reviewer.id]: 0, ...d.reached },
        // A reviewer is no longer someone it is only shared with to look at.
        viewers: d.viewers?.filter((one) => one.id !== reviewer.id),
        // Two people on every paper is how a review is usually screened: a new screening takes that up when its second person is added.
        ...(fresh && reviewer.kind === "person" && !reviewer.email && here === 2 && d.rule.each === "1" ? { rule: { ...d.rule, each: "2" as const } } : {}),
      };
    });
  // On a running screening a removed reviewer, source or criterion stays in its list until the save, struck through, with Keep to put it back.
  // On a new one it goes at once, and the toast can put it back where it was.
  const undoable = (what: string, back: () => void) => toast(`Removed ${what}`, { action: { label: "Undo", onClick: back } });
  const removeReviewer = (reviewer: Reviewer) => {
    const at = draft.reviewers.findIndex((one) => one.id === reviewer.id);
    const resolver = draft.rule.resolver;
    setDraft((d) => {
      const kept = saved?.reviewers.some((one) => one.id === reviewer.id) ? d.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: Date.now() } : one)) : d.reviewers.filter((one) => one.id !== reviewer.id);
      const left = kept.filter((one) => !one.left && one.kind === "person" && !one.email);
      return { ...d, reviewers: kept, rule: { ...d.rule, resolver: left.some((one) => one.id === d.rule.resolver) ? d.rule.resolver : (left[0]?.id ?? d.createdBy) } };
    });
    if (!wasOn(reviewer)) undoable(reviewer.name, () => setDraft((d) => ({ ...d, reviewers: insertAt(d.reviewers, at, reviewer), rule: { ...d.rule, resolver } })));
  };
  // A reviewer kept on settles conflicts again if they did before.
  const keepReviewer = (reviewer: Reviewer) => setDraft((d) => ({ ...d, reviewers: d.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: undefined } : one)), rule: saved?.rule.resolver === reviewer.id ? { ...d.rule, resolver: reviewer.id } : d.rule }));
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

  // A file still being read isn't in the screening yet: the click says so and goes to it.
  const stillReading = () => {
    if (!reading.length) return false;
    toast(`Still reading ${listed(reading)}`);
    document.getElementById("papers")?.scrollIntoView({ block: "start", behavior: "smooth" });
    return true;
  };
  const start = () => {
    if (stillReading()) return;
    const at = Date.now();
    const newId = `s${at}`;
    const name = draft.name.trim() || draft.sources[0]?.name || "Untitled screening";
    store.add({
      ...draft,
      id: newId,
      name,
      createdAt: at,
      seed: 20 + store.screenings.length,
      ...(draft.living ? { living: { every: draft.living.every, next: at + PERIOD[draft.living.every] } } : {}),
      ...(outsider ? { workspace: "theirs" } : {}),
      theme: draft.theme ?? themeFor(`${name} ${draft.question} ${draft.sources.map((source) => source.name).join(" ")}`),
      reviewers: draft.reviewers.map((reviewer) => ({ ...reviewer, addedAt: at })),
      reached: Object.fromEntries(draft.reviewers.map((reviewer) => [reviewer.id, 0])),
      // How it starts: papers are first dealt among these people, so many to a paper, under these criteria.
      started: { people: draft.reviewers.filter((reviewer) => reviewer.kind === "person" && !reviewer.email).map((reviewer) => reviewer.id), each: draft.rule.each, criteria: draft.criteria, sources: draft.sources.map(asStarted) },
      // Papers from a search, a community or a reference manager are fetched once it starts; the rest are to hand.
      ...(draft.sources.some((source) => ["search", "evidenceLibrary", "zotero", "dois"].includes(source.kind)) ? { gathered: 0 } : {}),
      ...(busy && models.length ? { after: busy.id } : {}),
      destination: { ...draft.destination, name: draft.destination.name || includedIn(name) },
      changes: [{ at, by: store.viewer, what: "Started the screening", effect: startedSays(papers, draft.sources.length, people.length, models.length) }],
    });
    store.draft(key, () => undefined);
    // The new screening takes the form's place in the history: Back from it returns to the list, not to a form already sent.
    router.replace(overviewHref(newId));
  };
  const save = () => {
    if (!saved || !id || stillReading()) return;
    // What the models read at once is paid for at once.
    const again = models.map((model) => ({ id: model.id, cost: atOnce(model) })).filter((one) => one.cost);
    const reopens = lines.some((line) => line.kind === "reopen");
    store.update(
      id,
      (now) => ({
        ...draft,
        // A second collection started here is the screening's own once saved, under the name it shows.
        ...(draft.destination.collection === ANOTHER_COLLECTION ? { destination: { ...draft.destination, name: collectionName(draft)!, collection: undefined } } : {}),
        ...live(draft, now),
        changes: now.changes,
        // Who it is shared with is set from Share, not here: a draft opened before a change there must not put the old list back.
        viewers: now.viewers,
        spent: { ...now.spent, ...Object.fromEntries(again.map((one) => [one.id, (now.spent?.[one.id] ?? 0) + one.cost])) },
        updates: now.updates,
        // Made living: it checks its sources at once, and is open again.
        ...(draft.living && !saved.living && growing(draft).length ? { checking: { done: 0, of: growing(draft).length, by: SCHEDULE } } : {}),
        finishedAt: reopens || (draft.living && !saved.living) ? undefined : now.finishedAt,
      }),
      // The log is read by everyone: its lines name people, where the preview said "you".
      { what: describe(saved, draft), effect: [...effectItems(saved, merged).map(lineText), movesText(moves)].filter(Boolean).join(". ") || undefined },
    );
    if (again.length) store.set(paid(saved, store, again.reduce((sum, one) => sum + one.cost, 0)));
    // The page stays where it is: Changes keeps what the save did until the next edit.
    setLastSave({ edits, lines, moves });
    // What the save did to the papers is said with it, so a count that changed elsewhere is no surprise.
    toast("Changes saved", { description: moves.length ? movesText(moves) : undefined, action: <NextLink data-button href={overviewHref(id)}>Go to the Overview</NextLink> });
  };
  const discard = () => {
    const was = store.drafts[key];
    epoch.current += 1;
    setPending([]);
    setRejected([]);
    store.draft(key, () => undefined);
    toast("Changes discarded", { action: { label: "Undo", onClick: () => store.draft(key, () => was) } });
  };

  const inCommunity = COMMUNITIES.find((one) => one.id === community)!;
  const communityRows = [...pasted, ...inCommunity.rows].filter((row) => (group === "all" || row.group === group) && row.name.toLowerCase().includes(find.trim().toLowerCase()));
  const communityPager = pagerOf(communityRows.length, OFFER_PAGE, offerPage, setOfferPage);
  // A collection is brought in by its address when it isn't in the list: one of yours elsewhere, or one someone sent you.
  const paste = () => {
    const text = address.trim();
    if (!/^https?:\/\/[^\s/]+\.[^\s/]+/.test(text)) return setAddressProblem("That isn't an address.");
    if (!/openscholar\.ai(\/|$)/.test(text)) return setAddressProblem("Openscholar doesn't run that community.");
    const name = decodeURIComponent(text.replace(/[?#].*$/, "").replace(/\/$/, "").split("/").pop() ?? "").replace(/[-_]+/g, " ").trim();
    if (!name || /openscholar\.ai$/.test(name)) return setAddressProblem("That address is a community, not one of its collections.");
    setPasted((rows) => (rows.some((row) => row.name.toLowerCase() === name.toLowerCase()) ? rows : [{ name: name.charAt(0).toUpperCase() + name.slice(1), total: 24 + (hash(name) % 160), group: "shared", access: "viewer", pasted: true }, ...rows]));
    setAddress("");
    setAddressProblem(null);
    setGroup("all");
    setOfferPage(1);
  };
  // Another screening's included papers are a source: the screenings are the ones this person can open, with what each has included so far and whether it is still running.
  const screeningOffers: Offer[] = kind !== "screening" ? [] : store.screenings.filter((one) => one.id !== draft.id && accessOf(one, store.viewer)).map((one) => ({ name: includedIn(one.name), detail: one.finishedAt ? "Finished screening" : "Running screening", total: standing(one).counts.include })).filter((offer) => offer.total > 0);
  const offered = kind === "upload" || kind === "dois" || kind === "evidenceLibrary" || kind === "zotero" ? [] : kind === "screening" ? screeningOffers : OFFERS[kind];
  const offers = offered.filter((offer) => offer.name.toLowerCase().includes(find.trim().toLowerCase()));
  const offerPager = pagerOf(offers.length, OFFER_PAGE, offerPage, setOfferPage);
  const importable = draft.sources.flatMap((source) => (source.kind === "search" ? (OFFERS.search.find((offer) => offer.name === source.name)?.questions ?? []).filter((question) => !draft.criteria.some((criterion) => criterion.text === question)).map((question) => ({ question, source })) : []));
  const importSearches = new Set(importable.map(({ source }) => source.id)).size;
  const collections = where === "community" ? COMMUNITY_COLLECTIONS : COLLECTIONS;
  const suggested = draft.name || draft.sources[0] ? includedIn(draft.name || draft.sources[0]!.name) : "Included papers";
  // A started screening's own collection already holds what it has included: it is a collection like the others, which can be renamed.
  const ownCollection = saved?.destination.kind === "new" ? saved.destination : null;
  const onOwn = Boolean(ownCollection) && draft.destination.kind === "new" && !draft.destination.collection;
  const toOwn = () => (ownCollection ? { ...ownCollection, prune: draft.destination.prune } : { ...draft.destination, kind: "new" as const, collection: undefined });
  // The name of the collection picked, under its row: the own one is renamed, a new one is named.
  const nameField = (label: string, placeholder: string) => (
    <div className="flex flex-col gap-1.5 px-4 pb-3 ps-11">
      <label htmlFor="collection-name" className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input id="collection-name" value={draft.destination.name} onChange={(event) => set({ destination: { ...draft.destination, name: event.target.value } })} placeholder={placeholder} className="h-9 max-w-md bg-card text-sm" />
    </div>
  );
  const another = { ...draft.destination, kind: "new" as const, name: "", collection: ownCollection ? ANOTHER_COLLECTION : undefined };
  const onAnother = draft.destination.kind === "new" && !onOwn;
  // Every place the included papers can go, all at once: its own collection or a new one first, the ones there are, and nowhere last.
  const places = [
    ...(where === "openscholar"
      ? [
          ...(ownCollection ? [<Destination key="own" on={onOwn} onPick={() => set({ destination: toOwn() })} icon={Folder} name={collectionName(saved!)!} facts={<Chip>{plural(savedState!.counts.include, "paper", "papers")}</Chip>} below={onOwn ? nameField("Name", collectionName(saved!)!) : null} />] : []),
          <Destination key="new" on={onAnother} onPick={() => { if (!onAnother) set({ destination: another }); }} icon={FolderPlus} name="New collection" below={onAnother ? nameField("Collection name", ownCollection ? collectionName({ ...draft, destination: another })! : suggested) : null} />,
        ]
      : []),
    ...collections.map((collection) => (
      <Destination key={collection.id} on={draft.destination.collection === collection.id} onPick={() => set({ destination: { ...draft.destination, kind: where === "community" ? "community" : "collection", collection: collection.id } })} icon={Folder} name={`Add to ${collection.name}`} facts={<Chip>{plural(collection.papers, "paper", "papers")}</Chip>} />
    )),
    <Destination key="none" on={draft.destination.kind === "none"} onPick={() => set({ destination: { ...draft.destination, kind: "none", collection: undefined } })} icon={Ban} name="Nowhere" facts={<Chip>Kept in the screening</Chip>} />,
  ];
  const fromCollection = draft.sources.find((source) => source.kind === "collection");
  // What a source held and left out, or a PDF source's files, as the list in its row shows them.
  const itemsOf = (source: Source, fixed: boolean): ItemRow[] =>
    source.files
      ? source.files.map((file) => {
          const stands = pdfStands(file);
          const taken = pdfAdded(file);
          const matched = file.how === "doi" || file.how === "title";
          return {
            key: file.name,
            name: file.name,
            kind: taken ? "taken" : "left",
            // The paper it was matched to, to check the match against the file's name.
            detail: matched && !file.wrong ? paperAt(draft.seed, source.slot, file.paper, draft.theme ?? "edtech").title : undefined,
            chip: { ...PDF_HOW, ...PDF_LEFT }[stands],
            tone: taken ? ("neutral" as const) : ("warning" as const),
            icon: taken ? Check : FileX,
            // Once a screening has started with the file, its paper may hold votes: the match is changed there, on the paper.
            action: matched && !fixed ? <WrongPaper wrong={Boolean(file.wrong)} name={file.name} onToggle={() => setWrong(source.id, file.name)} /> : undefined,
          };
        })
      : (source.left ?? []).map((one, at) => ({ key: `${at}:${one.name}`, name: one.name, kind: one.why === NOT_A_DOI ? "none" : "bare", chip: one.why, tone: "warning" as const, icon: FileX }));

  // The summary beside the form: one line for each part, which opens it.
  const resolver = joined.find((person) => person.id === draft.rule.resolver) ?? joined[0];
  const destinationName = draft.destination.kind === "none" ? "Nowhere" : draft.destination.kind === "new" && !draft.destination.name && !draft.name ? "New collection" : (collectionName(draft) ?? "A collection");
  const musts = draft.criteria.filter((criterion) => criterion.must).length;
  const reviewersNow = inOrder(activeReviewers(draft), store.viewer);
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
          {reviewersNow.slice(0, 4).map((reviewer, i) => <span key={reviewer.id} className={cn("flex", i > 0 && "-ms-1.5")}><ReviewerMark reviewer={reviewer} you={reviewer.id === store.viewer} className="size-6 ring-2 ring-card" /></span>)}
          {reviewersNow.length > 4 ? <span className="ms-1.5 text-xs tabular-nums text-muted-foreground">+{reviewersNow.length - 4}</span> : null}
        </span>
      ) : null,
    },
    { id: "decided", label: "How a paper is decided", value: `${SETTLE_LABEL[draft.rule.settle]}${draft.rule.settle === "one" ? "" : `, conflicts to ${!resolver || resolver.id === store.viewer ? "you" : firstName(resolver.name)}`}`, problem: false },
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
            help={<><Help title="Papers" facts={<><HelpFact>As many sources as you need</HelpFact><HelpFact>Duplicates merged</HelpFact></>}><p>Add every place the papers come from: searches, collections, communities, Zotero, files or DOIs. A paper found in two sources is screened once.</p><p>A record that Openscholar&apos;s index knows takes its abstract and details from there. One with a title and no abstract is still screened, on its title.</p><p>What can&apos;t be screened is left out, and its source&apos;s row lists it with the reason: a PDF with no abstract, a scan, a record with no title, a DOI that isn&apos;t found.</p></Help>{changed("papers")}</>}
            aside={
              <>
                <Chip><AnimatedNumber value={found} /> found</Chip>
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
                {sourceRows.length || reading.length || pending.length ? (
                  <div className={cn(LIST, "bg-card")}>
                    <AnimatePresence initial={false}>
                      {sourceRows.map(({ source, gone }) => {
                        const Icon = kindIcon(source.kind);
                        const open = openSource?.id === source.id && !gone ? openSource.part : null;
                        const isOpen = open === "papers";
                        // What it held and doesn't take: a PDF source's files that can't be screened, a file's records with no title, the DOIs that weren't found.
                        const leftOut = source.files ? source.files.filter((file) => !pdfAdded(file)).length : (source.left?.length ?? 0);
                        const itemsLabel = source.files ? (leftOut ? `${num(leftOut)} of ${plural(source.files.length, "file", "files")} left out` : plural(source.files.length, "file", "files")) : leftOut ? `${num(leftOut)} left out` : null;
                        const link = sourceLink(source, store.screenings);
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
                                  {/* Until a lookup is back the row says only that: what the source holds isn't known yet, and its counts take this chip's place. */}
                                  {looking.includes(source.id) ? <Chip key="looking"><Spinner className="size-3" />Looking up {plural(source.total + (source.left?.length ?? 0), "DOI", "DOIs")}</Chip> : <Chip key="count">{source.scope === "all" ? (source.total > baseTotal(source) ? `${num(baseTotal(source))} at the start` : `All ${num(baseTotal(source))}`) : `${num(baseTotal(source))} in the source`}</Chip>}
                                  {doubled > 0 && taken(source) && !looking.includes(source.id) ? <Chip>{num(doubled)} already in another source</Chip> : null}
                                  {grew > 0 && own && !gone ? (
                                    <LinkChip href={papersHref(own, { source: source.id, ...((source.updates?.length ?? 0) === 1 ? { added: String(source.updates![0]!.at) } : { sort: "added" }) })} tone="primary" icon={RefreshCw}>{grewText}</LinkChip>
                                  ) : grew > 0 ? (
                                    <StateChip tone="primary" icon={RefreshCw}>{grewText}</StateChip>
                                  ) : draft.living && GROWS.includes(source.kind) ? <Chip icon={RefreshCw}>Checked {EVERY_LABEL[draft.living.every].toLowerCase()}</Chip> : null}
                                  {source.filters?.map((filter) => <Chip key={filter}>{filter}</Chip>)}
                                  {/* What a lookup or a count will say stays under its chip until it is back: the count then takes the place the chip holds, so the row keeps its height. */}
                                  {counting.includes(source.id) ? <Chip key="counting"><Spinner className="size-3" />Counting abstracts</Chip> : looking.includes(source.id) ? null : source.facts?.map((fact) => (/without/.test(fact) ? <Chip key={fact} className="bg-warning/12 ink-warning">{fact}</Chip> : /not in the index/.test(fact) ? <Chip key={fact}>{fact}</Chip> : <Chip key={fact} icon={Check}>{fact}</Chip>))}
                                  {/* What it left out opens from the chip that counts it: the list says why for each. */}
                                  {itemsLabel && !gone && !looking.includes(source.id) ? (
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
                                      {source.files ? (
                                        <SourceItems
                                          key={source.id}
                                          rows={itemsOf(source, Boolean(own))}
                                          label="files"
                                          kinds={[{ id: "taken", label: "Taken" }, { id: "left", label: "Left out" }]}
                                          start={leftOut ? "left" : "all"}
                                          help={<Help title="Files left out" facts={<HelpFact>A wrong match can be set aside before the screening starts</HelpFact>}>A screening reads a title and an abstract. A PDF is taken when its paper is found by the DOI in the file or by its title, or when its first page prints an abstract. It is left out when no abstract is found, when it is a scan with no text, or when it doesn&apos;t open.</Help>}
                                        />
                                      ) : source.kind === "dois" ? (
                                        <SourceItems
                                          key={source.id}
                                          rows={itemsOf(source, true)}
                                          label="DOIs"
                                          kinds={new Set(source.left?.map((one) => one.why)).size > 1 ? [{ id: "none", label: "No such DOI" }, { id: "bare", label: "No record" }] : undefined}
                                          copied={["DOI", "DOIs"]}
                                          help={<Help title="DOIs left out">A DOI is left out when no DOI by that name exists, which is nearly always a typing slip, or when it exists and neither Openscholar&apos;s index nor the registry that issued it holds a title for it.</Help>}
                                        />
                                      ) : (
                                        <SourceItems key={source.id} rows={itemsOf(source, true)} label="records" />
                                      )}
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
                                    <ul className="space-y-1 border-t border-border-subtle pt-3">
                                      {papersOf({ seed: draft.seed, sources: [{ ...source, duplicates: 0 }] }).slice(0, 3).map((paper) => (
                                        <li key={paper.id} className="flex min-w-0 text-xs">
                                          {/* The made-up papers have no page of their own: a search for the title finds the paper. */}
                                          <a href={`/results?q=${encodeURIComponent(paper.title)}`} target="_blank" rel="noreferrer" className="truncate rounded text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">{paper.title} ({paper.year})</a>
                                        </li>
                                      ))}
                                      {taken(source) > 3 ? (
                                        <li className="text-xs">
                                          {link ? (
                                            <a href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">See all {num(taken(source))} {link.where}<ExternalLink aria-hidden className="size-3" /></a>
                                          ) : (
                                            <span className="text-muted-foreground">and {num(taken(source) - 3)} more</span>
                                          )}
                                        </li>
                                      ) : null}
                                    </ul>
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
                      {reading.map((name) => (
                        <motion.div key={`reading:${name}`} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", DIVIDED_ROW)}>
                          <div className="flex min-h-14 items-center gap-3 px-4 py-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06]"><Spinner className="size-4" /></span>
                            <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
                            <Chip>Reading it</Chip>
                          </div>
                        </motion.div>
                      ))}
                      {pending.map((table) => (
                        <motion.div key={`pending:${table.ref}`} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className={cn("overflow-hidden", DIVIDED_ROW)}>
                          <ColumnMatch pending={table} onPick={(key, head) => pickColumn(table.name, key, head)} onAdd={() => addTable(table)} onRemove={() => setPending((now) => now.filter((one) => one.ref !== table.ref))} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                ) : (
                  <EmptyNote>No papers yet</EmptyNote>
                )}
                </AutoHeight>
                {rejected.length ? (
                  <div className="flex items-start gap-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm">
                    <FileX className="mt-0.5 size-4 shrink-0 text-destructive" />
                    {/* One line for each reason, with the files it is about. */}
                    <div className="min-w-0 flex-1 space-y-1">
                      {REFUSALS.flatMap((why) => { const names = rejected.filter((one) => one.why === why).map((one) => one.name); return names.length ? [<p key={why}>{refusalSays(why, names)}</p>] : []; })}
                    </div>
                    <TooltipHint label="Dismiss"><Button variant="ghost" size="icon" className="-my-1 size-7 shrink-0" aria-label="Dismiss" onClick={() => setRejected([])}><X /></Button></TooltipHint>
                  </div>
                ) : null}
              </div>

              {/* What can be added sits in a well of its own, under its own title: it never looks like what is already in. */}
              <Panel className="@container min-w-0 space-y-3 @[88rem]:col-start-2 @[88rem]:row-span-2 @[88rem]:row-start-1">
                <h3 className="text-sm font-semibold">Add papers from</h3>
                <Tabs value={kind} onValueChange={(next) => { setKind(next as Kind); setFind(""); setOfferPage(1); }} className="gap-3">
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
                    {kind === "upload" ? (
                      <div
                        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(event) => { event.preventDefault(); setDragging(false); take(event.dataTransfer.files); }}
                        className={cn("flex flex-col items-center gap-1.5 rounded-2xl border border-dashed bg-card px-6 py-7 text-center transition-colors", dragging ? "border-primary bg-primary/5" : "border-border")}
                      >
                        <p className="text-sm font-medium">Drop reference files or PDFs here</p>
                        <p className="text-xs text-muted-foreground">{UPLOAD_FORMATS}, any number at once</p>
                        <input ref={files} type="file" multiple accept={UPLOAD_ACCEPT} className="sr-only" aria-label="Files to upload" onChange={(event) => { if (event.target.files) take(event.target.files); event.target.value = ""; }} />
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => files.current?.click()}><Upload />Choose files</Button>
                      </div>
                    ) : kind === "dois" ? (
                      <DoiTab onLookUp={lookUp} />
                    ) : kind === "zotero" ? (
                      <ZoteroTab connected={store.zotero !== false} account={store.me.name.toLowerCase().replace(/\s+/g, ".")} onConnect={() => store.set({ zotero: true })} sources={draft.sources} onAdd={addZotero} />
                    ) : kind === "evidenceLibrary" ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-start gap-2">
                          <Select value={community} onValueChange={(next) => { setCommunity(next); setOfferPage(1); setGroup("all"); }}>
                            <SelectTrigger aria-label="Community" className="h-9 w-full min-w-0 bg-card sm:w-auto sm:max-w-md"><SelectValue>{inCommunity.name}</SelectValue></SelectTrigger>
                            <SelectContent>
                              {COMMUNITIES.map((one) => <SelectItem key={one.id} value={one.id}><span className="flex min-w-0 items-center gap-2"><span className="truncate">{one.name}</span><span className="shrink-0 text-xs text-muted-foreground">{one.role}</span></span></SelectItem>)}
                            </SelectContent>
                          </Select>
                          <form className="min-w-0 flex-1 basis-56 space-y-1" onSubmit={(event) => { event.preventDefault(); paste(); }}>
                            <div className="relative">
                              <Link2 className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                              <Input value={address} onChange={(event) => { setAddress(event.target.value); setAddressProblem(null); }} placeholder="Paste a collection's address" aria-label="Paste a collection's address" aria-invalid={Boolean(addressProblem)} className="h-9 bg-card ps-8 text-sm" />
                            </div>
                            {/* The problem sits under the field it is about. */}
                            {addressProblem ? <p role="alert" className="px-1 text-xs text-destructive">{addressProblem}</p> : null}
                          </form>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Segmented label="Show" fill="labels" className="bg-card sm:w-auto" value={group} onChange={(next) => { setGroup(next); setOfferPage(1); }} options={[{ id: "all" as const, label: "All" }, { id: "yours" as const, label: "Yours" }, { id: "shared" as const, label: "Shared with you" }, { id: "library" as const, label: "The community's" }]} />
                          <div className="relative min-w-40 flex-1">
                            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input value={find} onChange={(event) => { setFind(event.target.value); setOfferPage(1); }} placeholder="Find" aria-label="Find a collection" className="h-8 rounded-full bg-card ps-8 text-sm" />
                          </div>
                        </div>
                        <div className="divide-y divide-border-subtle" style={{ minHeight: communityPager.pages > 1 ? OFFER_PAGE * 57 : undefined }}>
                          {communityRows.slice((communityPager.page - 1) * OFFER_PAGE, communityPager.page * OFFER_PAGE).map((row) => (
                            <OfferRow
                              key={row.name}
                              offer={{ name: row.name, detail: row.group === "library" && !row.parent ? `${num(inCommunity.records)} records` : `In ${inCommunity.name}`, total: row.total }}
                              icon={kindIcon("evidenceLibrary")}
                              chips={
                                <>
                                  {row.pasted ? <Chip icon={Link2} className="h-5 px-1.5">From a link</Chip> : null}
                                  {row.access ? <Chip icon={row.access === "editor" ? PenLine : Eye} className="h-5 px-1.5">{row.access === "editor" ? "Can edit" : "Can view"}</Chip> : null}
                                  {row.private !== undefined ? <Chip icon={row.private ? Lock : Globe} className="h-5 px-1.5">{row.private ? "Private" : "Public"}</Chip> : null}
                                  {row.parent ? <Chip icon={Folder} className="h-5 px-1.5">In {row.parent}</Chip> : null}
                                </>
                              }
                              added={draft.sources.some((source) => source.kind === "evidenceLibrary" && source.name === row.name)}
                              onAdd={() => { openAdded(row.name, row.total); addSource("evidenceLibrary", row.name, `In ${inCommunity.name}`, row.total); setDraft((d) => ({ ...d, sources: d.sources.map((source) => (source.kind === "evidenceLibrary" && source.name === row.name ? { ...source, filters: [inCommunity.name, "As the community stood when it was added"] } : source)) })); }}
                            />
                          ))}
                          {!communityRows.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{find.trim() ? "Nothing by that name." : group === "yours" ? `You have no collections in ${inCommunity.name}.` : group === "shared" ? `Nobody has shared a collection in ${inCommunity.name} with you.` : `Nothing to read in ${inCommunity.name} yet.`}</p> : null}
                        </div>
                        {communityPager.pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={communityPager.page} totalPages={communityPager.pages} onPageChange={setOfferPage} totalItems={communityRows.length} itemsPerPage={OFFER_PAGE} itemLabel="collections" /> : null}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {offered.length > OFFER_PAGE ? (
                          <div className="relative">
                            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input value={find} onChange={(event) => { setFind(event.target.value); setOfferPage(1); }} placeholder={KINDS.find((one) => one.id === kind)!.find ?? `Find a ${KINDS.find((one) => one.id === kind)!.label.toLowerCase()}`} aria-label="Find a source" className="h-8 rounded-full bg-card ps-8 text-sm" />
                          </div>
                        ) : null}
                        <div className="divide-y divide-border-subtle" style={{ minHeight: offerPager.pages > 1 ? OFFER_PAGE * 57 : undefined }}>
                          {offers.slice((offerPager.page - 1) * OFFER_PAGE, offerPager.page * OFFER_PAGE).map((offer) => { const as = offer.kind ?? kind; return <OfferRow key={offer.name} offer={offer} icon={kindIcon(as)} added={draft.sources.some((source) => source.kind === as && source.name === offer.name)} onAdd={() => { openAdded(offer.name, offer.total); addSource(as, offer.name, offer.detail, offer.total); if (offer.filters) setDraft((d) => ({ ...d, sources: d.sources.map((source) => (source.kind === as && source.name === offer.name ? { ...source, filters: offer.filters } : source)) })); }} />; })}
                          {!offers.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{find.trim() ? "Nothing by that name." : kind === "screening" ? "No other screening has included a paper yet." : "Nothing here yet."}</p> : null}
                        </div>
                        {offerPager.pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={offerPager.page} totalPages={offerPager.pages} onPageChange={setOfferPage} totalItems={offers.length} itemsPerPage={OFFER_PAGE} itemLabel="sources" /> : null}
                      </div>
                    )}
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
                      <Chip icon={Clock}>{saved?.living ? `Next check ${day(draft.living.next)}` : fresh ? `First check ${day(NOW + PERIOD[draft.living.every])}` : "First check as soon as this is saved"}</Chip>
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
            help={<><Help title="Must-have and nice to have" facts={<><HelpFact>People vote directly</HelpFact><HelpFact>Answers decide models&apos; votes</HelpFact></>}>Write each criterion as a yes-or-no question. A model answers each one yes, no or unclear. A no on a must-have criterion makes its vote exclude, and an unclear makes it maybe. A nice-to-have criterion never excludes a paper. Guidance under a question says what counts: a reviewer opens it with &quot;Guidance&quot; under the question on Screen, and a model reads it with the question.</Help>{changed("criteria")}</>}
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
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{plural(one.criteria.length, "criterion", "criteria")}</span>
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
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{one.criteria.length}</span>
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
                {youFirst(reviewerRows, store.viewer).map(({ reviewer, gone }) => {
                  const votes = wasOn(reviewer) || gone ? votesOf(reviewer) : 0;
                  const left = reviewer.kind === "model" ? ahead(reviewer) : Math.max(0, papers - (wasOn(reviewer) ? Math.min(saved?.reached[reviewer.id] ?? 0, papers) : 0));
                  return (
                    <ReviewerRow
                      key={reviewer.id}
                      reviewer={reviewer}
                      you={reviewer.id === store.viewer}
                      href={saved && (wasOn(reviewer) || gone) ? papersHref(saved.id, { reviewer: reviewer.id }) : undefined}
                      gone={gone}
                      detail={reviewer.kind === "model" ? "AI model" : reviewer.email ? (!saved ? PERSON_SAYS.toInviteAtStart : !wasOn(reviewer) ? PERSON_SAYS.toInvite : PERSON_SAYS.invited) : reviewer.id === draft.rule.resolver && draft.rule.settle !== "one" ? PERSON_SAYS.settles : standsTo(personOf(reviewer.id), workspace, draft.createdBy)}
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
                                {saved && unreadBy(reviewer).length ? (
                                  <LinkChip href={papersHref(saved.id, { reviewer: reviewer.id, voted: "failed", ...(unreadBy(reviewer).length === 1 ? { paper: unreadBy(reviewer)[0]!.id } : {}) })} tone="destructive" icon={TriangleAlert}>{unreadText(unreadBy(reviewer).length)}</LinkChip>
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
                <AddPerson exclude={people.map((person) => person.id)} workspace={workspace} owner={draft.createdBy} onPick={(pick) => addReviewer("person" in pick ? personReviewer(pick.person, NOW) : invitedReviewer(pick.email, NOW))}>
                  <Button id="add-person" variant="outline" size="sm" className="w-full"><UserPlus />Add a person</Button>
                </AddPerson>
                <AddModel exclude={models.map((model) => model.model!.id)} onPick={(model) => addReviewer(modelReviewer(model, NOW))}>
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
              <RuleRow name="People on each paper" help={<Help title="People on each paper" facts={<><HelpFact>Models read every open paper</HelpFact><HelpFact>Everyone includes whoever joins later</HelpFact></>}>Every model reads every paper that is open when it joins. This sets how many people vote on each one. The papers are shared out so each person reads about the same number. A number stays that number when the team grows. Everyone means every person on the screening, then and later.</Help>} detail={share}>
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
                      {joined.map((person) => <SelectItem key={person.id} value={person.id}><span className="flex items-center gap-2"><ReviewerMark reviewer={person} className="size-5" /><ReviewerName reviewer={person} you={person.id === store.viewer} /></span></SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : <span className="flex items-center gap-2 text-sm"><ReviewerMark reviewer={personReviewer(personOf(draft.createdBy)!, 0)} className="size-5" /><ReviewerName reviewer={personReviewer(personOf(draft.createdBy)!, 0)} you={draft.createdBy === store.viewer} /></span>}
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
            aside={<Segmented label="Where included papers go" value={where} onChange={(next) => { setWhere(next); set({ destination: next === "community" ? { ...draft.destination, kind: "community", collection: COMMUNITY_COLLECTIONS[0]!.id } : toOwn() }); }} options={[{ id: "openscholar", label: "Your library" }, { id: "community", label: "A community" }]} />}
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
                      <EffectList lines={dirty ? lines : lastSave!.lines} moves={dirty ? moves : lastSave!.moves} screening={saved?.id} jump done={!dirty} unseen={saved && savedState ? (paper) => !seesVotes(saved, savedState, store.viewer, paper) : undefined} />
                      {/* A change applies to the papers still open. Checking the settled ones again is asked for here, where the change would give some of them another result. */}
                      {dirty && (again > 0 || draft.recheck) ? (
                        <label className="flex items-start gap-3 rounded-xl border border-border-subtle bg-card p-2.5 text-sm">
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">Check the settled papers again</span>
                            <span className="block text-xs text-muted-foreground">{draft.recheck ? "Every settled paper is checked under the new settings. The ones listed above get another result." : `${num(again)} settled ${again === 1 ? "paper" : "papers"} would get another result under the new settings. ${again === 1 ? "It keeps its" : "They keep their"} result unless you turn this on.`}</span>
                          </span>
                          <Switch checked={Boolean(draft.recheck)} onCheckedChange={(on) => set({ recheck: on || undefined })} aria-label="Check the settled papers again" />
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
            ) : saved?.updates?.length && saved.updates.at(-1)!.at > NOW ? (
              <div className="flex items-center gap-2.5 rounded-2xl bg-primary/8 px-3 py-2.5 text-sm">
                <RefreshCw className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">{saved.updates.at(-1)!.added ? `The check added ${plural(saved.updates.at(-1)!.added, "new paper", "new papers")}` : "The check found nothing new"}</span>
                {saved.updates.at(-1)!.added ? <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs"><NextLink href={papersHref(saved.id, { added: String(saved.updates.at(-1)!.at) })}>See the {plural(saved.updates.at(-1)!.added, "paper", "papers")}<ChevronRight /></NextLink></Button> : null}
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
                  <Help title="Models and credits" side="left" facts={<><HelpFact>People are free</HelpFact><HelpFact>40 papers at once</HelpFact></>}>
                    <p>Each model&apos;s cost is its credits for one paper times the papers to screen. The workspace&apos;s plan lets models read 40 papers at once, so a screening started while another&apos;s models are reading waits its turn. People can vote from the start.</p>
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
                    {!fresh && unreadBy(model).length ? <StateChip tone="destructive" icon={TriangleAlert} className="h-5 px-1.5">{unreadText(unreadBy(model).length)}</StateChip> : !due(model) && !fresh ? <Chip icon={Check} className="h-5 px-1.5">All read</Chip> : null}
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
                  <WorkspaceTag size="sm" workspace={lookOf(workspace, saved?.createdBy ?? store.viewer)}>{credits(wallet)} in {workspace.name}</WorkspaceTag>
                  {cost > wallet ? <StateChip tone="warning" icon={Coins}>{credits(cost - wallet)} credits short</StateChip> : cost ? <Chip>{credits(wallet - cost)} left after</Chip> : null}
                  {saved?.spent ? <Chip>{credits(spentOf(saved))} spent so far</Chip> : null}
                  {/* In the same run of chips, so the column stays short enough to stay in view. */}
                  {models.length && draft.living ? (
                    <Chip icon={RefreshCw}>{credits(perNew)} credits a new paper{lastCheck ? `, ${credits(lastCheck.added * perNew)} for the last ${lastCheck.added}` : ""}</Chip>
                  ) : null}
                </div>
                {busy && models.length ? <LinkChip href={overviewHref(busy.id)} icon={MODELS_SAY.waiting.icon} className="w-fit max-w-full [&>span]:shrink">{MODELS_SAY.waiting.says} {busy.name}</LinkChip> : null}
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
              {stop && cost > wallet ? <Button variant="outline" onClick={() => store.set(toppedUp(purse, store))}><Coins />Add credits</Button> : null}
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
        <MockStates />
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
  const { openActivity } = useWorkspace();
  return <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={openActivity}>Activity</Button>;
}
