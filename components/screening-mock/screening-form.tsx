"use client";

// A screening's form: where its papers come from, the criteria, who reads them, how a paper is
// decided and where the included ones go. A new screening starts from it, and a running or finished
// one is changed with the same form, which says what each change will do before it is saved.

import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { AiIcon, Ban, Check, ChevronDown, Clock, Coins, Copy, Eye, FileText, FileX, Folder, FolderPlus, Gauge, Globe, Hash, Link2, ListChecks, Lock, PenLine, Plus, Search, Trash2, Undo2, Upload, UserPlus, X, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { ListEmpty } from "@/components/evidence-libraries/list-controls";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { AnimatedNumber, Chip, Meter, SOURCE_ICON } from "@/components/screening/parts";
import { PaperScope, PickMark } from "@/components/screening/source-row";
import { EASE, NodeCard } from "@/components/settings/model-map";
import { LIST, Segmented, Zone, pagerOf } from "@/components/settings/parts";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { YouTag } from "@/components/ui/identity";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { DEFAULT_RULE, HOME, NOW, accessOf, themeFor, workspaceOf, activeReviewers, ago, defaultScoring, invitedReviewer, modelReviewer, modelsOf, paperTotal, papersOf, peopleOf, personOf, personReviewer, shortOf, taken, type Criterion, type Reviewer, type Screening, type Source, type SourceKind } from "./data";
import { EffectList, effectLines, effectMoves, movesText } from "./effects";
import { COLLECTIONS, COMMUNITIES, COMMUNITY_COLLECTIONS, OFFERS, PDF_FILES, REFERENCE_FILES, WRITTEN, type CommunityRow, type Offer } from "./form-data";
import { MockStates } from "./mock-states";
import { CriterionText, ReviewerMark, ReviewerStack, RuleExamples } from "./parts";
import { credits, isReading, paperCredits, useMock } from "./store";
import { AddModel, AddPerson } from "./team";

type Kind = Exclude<SourceKind, "pdf">;
const KINDS: Array<{ id: Kind; label: string; icon: AppIcon }> = [
  { id: "search", label: "Search", icon: SOURCE_ICON.search },
  { id: "collection", label: "Collection", icon: SOURCE_ICON.collection },
  { id: "saved", label: "Saved", icon: SOURCE_ICON.saved },
  { id: "screening", label: "Screening", icon: SOURCE_ICON.screening },
  { id: "evidenceLibrary", label: "Community", icon: SOURCE_ICON.evidenceLibrary },
  { id: "zotero", label: "Zotero", icon: SOURCE_ICON.zotero },
  { id: "upload", label: "Upload", icon: Upload },
  { id: "dois", label: "DOIs", icon: Hash },
];
const iconOf = (kind: SourceKind): AppIcon => (kind === "upload" || kind === "pdf" ? FileText : kind === "dois" ? Hash : SOURCE_ICON[kind]);
const OFFER_PAGE = 5;
const DEST_PAGE = 5;
const hashOf = (text: string) => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);

/** A screening nobody has started: the person making it as its one reviewer, the usual rule, and nothing else yet. */
function blank(me: string): Screening {
  const person = personOf(me)!;
  return {
    id: "",
    name: "",
    createdBy: me,
    createdAt: NOW,
    question: "",
    fullText: true,
    sources: [],
    criteria: [],
    reviewers: [personReviewer(person, NOW)],
    rule: { ...DEFAULT_RULE, each: "1", resolver: me },
    scoring: defaultScoring([]),
    destination: { kind: "new", name: "", prune: false },
    seed: 20,
    reached: { abstract: {}, fullText: {} },
    cast: { abstract: {}, fullText: {} },
    resolved: { abstract: {}, fullText: {} },
    fullTexts: {},
    changes: [],
  };
}

/** What a save changed, in a few words, for the screening's activity. */
function describe(before: Screening, after: Screening) {
  const parts: string[] = [];
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const added = <T extends { id?: string; key?: string }>(a: T[], b: T[]) => b.filter((x) => !a.some((y) => (y.id ?? y.key) === (x.id ?? x.key))).length;
  if (before.name !== after.name) parts.push("Renamed it");
  if (added(before.sources, after.sources)) parts.push(`Added ${n(added(before.sources, after.sources), "source", "sources")}`);
  if (added(after.sources, before.sources)) parts.push(`Removed ${n(added(after.sources, before.sources), "source", "sources")}`);
  if (before.sources.some((source) => { const now = after.sources.find((one) => one.id === source.id); return now && taken(now) !== taken(source); })) parts.push("Changed which papers a source brings");
  if (added(before.criteria, after.criteria)) parts.push(`Added ${n(added(before.criteria, after.criteria), "criterion", "criteria")}`);
  if (added(after.criteria, before.criteria)) parts.push(`Removed ${n(added(after.criteria, before.criteria), "criterion", "criteria")}`);
  if (before.criteria.some((criterion) => { const now = after.criteria.find((one) => one.key === criterion.key); return now && (now.must !== criterion.must || now.text !== criterion.text); })) parts.push("Changed a criterion");
  const [was, is] = [activeReviewers(before), activeReviewers(after)];
  if (added(was, is)) parts.push(`Added ${n(added(was, is), "reviewer", "reviewers")}`);
  if (added(is, was)) parts.push(`Took off ${n(added(is, was), "reviewer", "reviewers")}`);
  if (JSON.stringify(before.rule) !== JSON.stringify(after.rule)) parts.push("Changed how a paper is decided");
  if (before.fullText !== after.fullText) parts.push(after.fullText ? "Added the full-text stage" : "Took off the full-text stage");
  if (before.question !== after.question) parts.push("Changed the research question");
  // Points that come and go with a criterion are that criterion's change, not a change to the scoring.
  if (JSON.stringify(before.scoring.stars) !== JSON.stringify(after.scoring.stars) || before.criteria.some((criterion) => after.criteria.some((one) => one.key === criterion.key) && JSON.stringify(before.scoring.points[criterion.key]) !== JSON.stringify(after.scoring.points[criterion.key]))) parts.push("Changed the scoring");
  if (JSON.stringify(before.destination) !== JSON.stringify(after.destination)) parts.push("Changed where included papers go");
  return parts.join(", ").replace(/, ([A-Z])/g, (_, letter: string) => `, ${letter.toLowerCase()}`);
}

export function ScreeningForm({ id }: { id?: string }) {
  const store = useMock();
  const router = useRouter();
  const [from] = useQueryState("from");
  const saved = id ? store.screenings.find((one) => one.id === id) : undefined;
  const copied = !id && from ? store.screenings.find((one) => one.id === from) : undefined;
  // What the form starts from: the saved screening, a copy of another to run again, or nothing yet.
  const [made] = useState<Screening>(() => (copied ? { ...blank(store.viewer), name: `${copied.name}, again`, question: copied.question, fullText: copied.fullText, sources: copied.sources, criteria: copied.criteria, theme: copied.theme, reviewers: activeReviewers(copied), rule: copied.rule, scoring: copied.scoring, destination: { ...copied.destination, name: "" } } : blank(store.viewer)));
  const origin = saved ?? made;
  // What isn't saved yet is kept by the mock's store, so leaving the page and coming back loses nothing.
  const key = id ?? `new:${from ?? ""}`;
  const draft = store.drafts[key] ?? origin;
  const setDraft = (next: Screening | ((now: Screening) => Screening)) => store.draft(key, (now) => (typeof next === "function" ? next(now ?? origin) : next));
  const [kind, setKind] = useState<Kind>("search");
  const [find, setFind] = useState("");
  const [offerPage, setOfferPage] = useState(1);
  const [openSource, setOpenSource] = useState<string | null>(null);
  const [reading, setReading] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [dois, setDois] = useState("");
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
  const [destPage, setDestPage] = useState(1);
  const files = useRef<HTMLInputElement>(null);
  const question = useRef<HTMLTextAreaElement>(null);
  // The last source or criterion removed, so it can be put back.
  const [removed, setRemoved] = useState<{ what: string; zone: "papers" | "criteria"; back: Screening } | null>(null);

  if (id && (!saved || !accessOf(saved, store.viewer))) {
    return (
      <PageWrapper>
        <LibraryPageShell icon={ListChecks} title="Screening" backHref="/screening/mock" backLabel="All screenings">
          <ListEmpty icon={X}>This screening was deleted, or isn&apos;t shared with you</ListEmpty>
        </LibraryPageShell>
        <MockStates />
      </PageWrapper>
    );
  }

  const fresh = !saved;
  // Its workspace's members change it. Someone it is shared with from outside reads its settings.
  const locked = Boolean(saved && !accessOf(saved, store.viewer)?.member);
  const workspace = saved ? workspaceOf(saved) : HOME;
  // The credits its models are paid from: its own workspace's.
  const wallet = workspace === HOME ? store.wallet : workspace.credits;
  // The workspace's models read so many papers at once: a screening started while another's are reading waits its turn.
  const busy = fresh ? store.screenings.find(isReading) : undefined;
  const set = (patch: Partial<Screening>) => setDraft((d) => ({ ...d, ...patch }));
  const people = peopleOf(draft);
  // Someone invited by email reads papers once they have joined.
  const joined = people.filter((person) => !person.email);
  const models = modelsOf(draft);
  const found = draft.sources.reduce((sum, source) => sum + taken(source), 0);
  const papers = paperTotal(draft.sources);
  const each = draft.rule.each === "all" ? joined.length : Math.min(Number(draft.rule.each), joined.length);
  const cost = models.reduce((sum, model) => sum + paperCredits(model.model!, "abstract") * papers, 0);
  const lines = saved ? effectLines(saved, draft) : [];
  const moves = saved ? effectMoves(saved, draft) : [];
  // A model answers criteria: with none it would include every paper it reads.
  const needsCriteria = models.length > 0 && draft.criteria.length === 0;
  const dirty = saved ? describe(saved, draft) !== "" : false;
  const stop = !papers ? "Add papers to start" : !activeReviewers(draft).length ? "Add a reviewer to start" : needsCriteria ? "Add a criterion for the model" : cost > wallet ? `${credits(cost - wallet)} credits short` : null;

  const addSource = (kind: SourceKind, name: string, detail: string, total: number, facts?: string[]) =>
    setDraft((d) => {
      if (d.sources.some((source) => source.kind === kind && source.name === name)) return d;
      const duplicates = d.sources.length && total > 3 ? Math.min(total - 1, Math.round(total * 0.07) + (hashOf(name) % 4)) : 0;
      const slot = Math.max(-1, ...d.sources.map((source) => source.slot)) + 1;
      return { ...d, sources: [...d.sources, { id: `src-${slot}-${hashOf(name) % 1000}`, slot, kind, name, detail, total, scope: "all", range: [1, Math.max(1, total)], duplicates, addedAt: Date.now(), ...(facts ? { facts } : {}) }] };
    });
  const patchSource = (sourceId: string, patch: Partial<Source> | ((source: Source) => Partial<Source>)) =>
    setDraft((d) => ({ ...d, sources: d.sources.map((source) => (source.id === sourceId ? { ...source, ...(typeof patch === "function" ? patch(source) : patch) } : source)) }));
  // Files are read one at a time: a reference file becomes a source of its own, PDFs join one source between them.
  const take = (list: FileList | File[]) => {
    const all = [...list];
    const bad = all.filter((file) => !REFERENCE_FILES.test(file.name) && !PDF_FILES.test(file.name)).map((file) => file.name);
    if (bad.length) setRejected((names) => [...new Set([...names, ...bad])]);
    const references = all.filter((file) => REFERENCE_FILES.test(file.name));
    const pdfs = all.filter((file) => PDF_FILES.test(file.name));
    const names = [...references.map((file) => file.name), ...(pdfs.length ? [`${pdfs.length} ${pdfs.length === 1 ? "PDF" : "PDFs"}`] : [])];
    if (!names.length) return;
    setReading((now) => [...now, ...names]);
    setTimeout(() => {
      for (const file of references) {
        const total = 12 + (hashOf(file.name) % 140);
        addSource("upload", file.name, "Reference file", total, [`${total - 2 - (hashOf(file.name) % 5)} found in Openscholar's index`, `${1 + (hashOf(file.name) % 4)} without an abstract`]);
      }
      if (pdfs.length) addSource("pdf", `${pdfs.length} ${pdfs.length === 1 ? "PDF" : "PDFs"}: ${pdfs[0]!.name}${pdfs.length > 1 ? ` and ${pdfs.length - 1} more` : ""}`, "Read from the files", pdfs.length, ["Titles and abstracts read from the files", "Kept as each paper's full text"]);
      setReading((now) => now.filter((name) => !names.includes(name)));
    }, 1100);
  };

  // A criterion decides unless it is marked as nice to have: an inclusion criterion that excludes nothing is a surprise.
  const addCriterion = (words: string, must = true) =>
    setDraft((d) => {
      const clean = words.trim();
      if (!clean || d.criteria.some((criterion) => criterion.text.toLowerCase() === clean.toLowerCase())) return d;
      const key = `c${hashOf(clean)}`;
      return { ...d, criteria: [...d.criteria, { key, text: clean, short: shortOf(clean), must, terms: [], addedAt: Date.now() }], scoring: { ...d.scoring, points: { ...d.scoring.points, [key]: [1, 0, 0] } } };
    });
  const patchCriterion = (key: string, patch: Partial<Criterion>) => setDraft((d) => ({ ...d, criteria: d.criteria.map((criterion) => (criterion.key === key ? { ...criterion, ...patch } : criterion)) }));

  const addReviewer = (reviewer: Reviewer) =>
    setDraft((d) => {
      // Someone taken off and put back counts again from where they were.
      const reviewers = d.reviewers.some((one) => one.id === reviewer.id) ? d.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: undefined } : one)) : [...d.reviewers, { ...reviewer, addedAt: fresh ? d.createdAt : Date.now() }];
      const here = reviewers.filter((one) => !one.left && one.kind === "person" && !one.email).length;
      return {
        ...d,
        reviewers,
        reached: { abstract: { [reviewer.id]: 0, ...d.reached.abstract }, fullText: { [reviewer.id]: 0, ...d.reached.fullText } },
        // Two people on every paper is how a review is usually screened: a new screening takes that up when its second person is added.
        ...(fresh && reviewer.kind === "person" && !reviewer.email && here === 2 && d.rule.each === "1" ? { rule: { ...d.rule, each: "2" as const } } : {}),
      };
    });
  const removeReviewer = (reviewer: Reviewer) =>
    setDraft((d) => {
      const kept = saved?.reviewers.some((one) => one.id === reviewer.id) ? d.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: Date.now() } : one)) : d.reviewers.filter((one) => one.id !== reviewer.id);
      const left = kept.filter((one) => !one.left && one.kind === "person" && !one.email);
      return { ...d, reviewers: kept, rule: { ...d.rule, resolver: left.some((one) => one.id === d.rule.resolver) ? d.rule.resolver : (left[0]?.id ?? d.createdBy) } };
    });

  const start = () => {
    const at = Date.now();
    const newId = `s${at}`;
    const name = draft.name.trim() || draft.sources[0]?.name || "Untitled screening";
    store.add({
      ...draft,
      id: newId,
      name,
      createdAt: at,
      seed: 20 + store.screenings.length,
      theme: draft.theme ?? themeFor(`${name} ${draft.question} ${draft.sources.map((source) => source.name).join(" ")}`),
      reviewers: draft.reviewers.map((reviewer) => ({ ...reviewer, addedAt: at })),
      reached: { abstract: Object.fromEntries(draft.reviewers.map((reviewer) => [reviewer.id, 0])), fullText: Object.fromEntries(draft.reviewers.map((reviewer) => [reviewer.id, 0])) },
      // Papers from a search, a community or a reference manager are fetched once it starts; the rest are to hand.
      ...(draft.sources.some((source) => ["search", "evidenceLibrary", "zotero", "dois"].includes(source.kind)) ? { gathered: 0 } : {}),
      ...(busy && models.length ? { after: busy.id } : {}),
      destination: { ...draft.destination, name: draft.destination.name || `Included in ${name}` },
      changes: [{ at, by: store.viewer, what: "Started the screening", effect: `${papers.toLocaleString("en-GB")} papers from ${draft.sources.length} ${draft.sources.length === 1 ? "source" : "sources"}, ${people.length} ${people.length === 1 ? "person" : "people"} and ${models.length} ${models.length === 1 ? "model" : "models"}` }],
    });
    store.draft(key, () => undefined);
    router.push(`/screening/mock/${newId}`);
  };
  const save = () => {
    if (!saved || !id) return;
    // Models answer a new criterion on the papers they have read, and that reading is paid for.
    const had = new Set(saved.criteria.map((criterion) => criterion.key));
    const again = draft.criteria.some((criterion) => !had.has(criterion.key)) ? models.filter((model) => saved.reviewers.some((one) => one.id === model.id && !one.left)).map((model) => ({ id: model.id, cost: Math.min(saved.reached.abstract[model.id] ?? 0, papers) * paperCredits(model.model!, "abstract") })) : [];
    const reopens = moves.some((move) => move.to === "conflict" || move.to === "waiting") || lines.some((line) => line.includes("join"));
    store.update(
      id,
      (now) => ({
        ...draft,
        reached: { abstract: { ...draft.reached.abstract, ...now.reached.abstract }, fullText: { ...draft.reached.fullText, ...now.reached.fullText } },
        cast: now.cast,
        resolved: now.resolved,
        fullTexts: now.fullTexts,
        fullTextFiles: now.fullTextFiles,
        changes: now.changes,
        spent: { ...now.spent, ...Object.fromEntries(again.map((one) => [one.id, (now.spent?.[one.id] ?? 0) + one.cost])) },
        finishedAt: reopens ? undefined : now.finishedAt,
      }),
      { what: describe(saved, draft), effect: [...lines, movesText(moves)].filter(Boolean).join(". ") || undefined },
    );
    if (again.length) store.set({ wallet: Math.max(0, store.wallet - again.reduce((sum, one) => sum + one.cost, 0)) });
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
    setPasted((rows) => (rows.some((row) => row.name.toLowerCase() === name.toLowerCase()) ? rows : [{ name: name.charAt(0).toUpperCase() + name.slice(1), total: 24 + (hashOf(name) % 160), group: "shared", access: "viewer", pasted: true }, ...rows]));
    setAddress("");
    setAddressProblem(null);
    setGroup("all");
    setOfferPage(1);
  };
  const offers = kind === "upload" || kind === "dois" || kind === "evidenceLibrary" ? [] : OFFERS[kind].filter((offer) => offer.name.toLowerCase().includes(find.trim().toLowerCase()));
  const offerPager = pagerOf(offers.length, OFFER_PAGE, offerPage, setOfferPage);
  const importable = draft.sources.flatMap((source) => (source.kind === "search" ? (OFFERS.search.find((offer) => offer.name === source.name)?.questions ?? []).filter((question) => !draft.criteria.some((criterion) => criterion.text === question)).map((question) => ({ question, source })) : []));
  const collections = where === "community" ? COMMUNITY_COLLECTIONS : COLLECTIONS;
  // Every place the included papers can go, as one list: a new collection first, the ones there are, and nowhere last.
  const places = [
    ...(where === "openscholar"
      ? [
          <Destination key="new" on={draft.destination.kind === "new"} onPick={() => set({ destination: { ...draft.destination, kind: "new", collection: undefined } })} icon={FolderPlus} facts={<Chip>New collection</Chip>}>
            <Input value={draft.destination.name} onChange={(event) => set({ destination: { ...draft.destination, kind: "new", name: event.target.value } })} placeholder={draft.name || draft.sources[0] ? `Included in ${draft.name || draft.sources[0]!.name}` : "Name a new collection"} aria-label="Name of the new collection" className="h-8 border-transparent bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0" />
          </Destination>,
        ]
      : []),
    ...collections.map((collection) => (
      <Destination key={collection.id} on={draft.destination.collection === collection.id} onPick={() => set({ destination: { ...draft.destination, kind: where === "community" ? "community" : "collection", collection: collection.id } })} icon={Folder} name={`Add to ${collection.name}`} facts={<Chip>{collection.papers} papers</Chip>} />
    )),
    <Destination key="none" on={draft.destination.kind === "none"} onPick={() => set({ destination: { ...draft.destination, kind: "none", collection: undefined } })} icon={Ban} name="Nowhere: keep them in the screening" />,
  ];
  const destPager = pagerOf(places.length, DEST_PAGE, destPage, setDestPage);
  const fromCollection = draft.sources.find((source) => source.kind === "collection");
  const doiCount = dois.split(/[\s,;]+/).filter((word) => /^10\.\d{4,}\//.test(word.replace(/^https?:\/\/(dx\.)?doi\.org\//, ""))).length;

  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        <div className={`contents ${AVATARS_FADE_IN}`}>
          <LibraryPageShell
            icon={ListChecks}
            title={fresh ? "New screening" : saved.name}
            titleAside={fresh ? null : <Chip>Settings</Chip>}
            backHref={fresh ? "/screening/mock" : `/screening/mock/${id}`}
            backLabel={fresh ? "All screenings" : "Back to the screening"}
            intro={
              locked ? (
                <div className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-6">
                  <Eye className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 text-muted-foreground">These are {workspace.name}&apos;s settings for this screening. You can read them, and its members change them.</span>
                </div>
              ) : undefined
            }
          >
            <div className="grid @4xl:grid-cols-[minmax(0,1fr)_21rem] @4xl:divide-x @4xl:divide-border-subtle">
              <div className={cn("min-w-0 space-y-8 p-4 sm:p-6", locked && "[&_[data-adds]]:hidden [&_[role=radiogroup]]:opacity-60 [&_[role=switch]]:opacity-60")} inert={locked}>
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">{fresh ? "Decide which papers are in, with your team and any AI models you add as reviewers." : locked ? "What this screening reads, asks and how it decides." : "Everything here can change while the screening runs and after it is finished. Nothing is saved until you say so."}</p>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Name</span>
                    <Input value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder={draft.sources[0]?.name ?? "Such as “School meals and learning”"} maxLength={200} className="h-10 text-base font-semibold" />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">What the review asks</span>
                    <Textarea ref={question} rows={1} value={draft.question} onChange={(event) => set({ question: event.target.value })} placeholder="Such as “Do school meals improve learning in primary schools?”" className="min-h-9 resize-none py-1.5 text-sm field-sizing-content" />
                    <span className="text-xs text-muted-foreground">Optional. Criteria can be written from it.</span>
                  </label>
                </div>

                {/* Papers */}
                <Zone
                  label="Papers"
                  aside={
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      <Chip><AnimatedNumber value={found} /> found</Chip>
                      <Chip><AnimatedNumber value={found - papers} /> duplicates merged</Chip>
                      <Chip className="bg-primary/12 font-medium text-primary"><AnimatedNumber value={papers} /> to screen</Chip>
                    </span>
                  }
                >
                  {draft.sources.length || reading.length ? (
                    <div className={LIST}>
                      <AnimatePresence initial={false}>
                        {draft.sources.map((source) => {
                          const Icon = iconOf(source.kind);
                          const isOpen = openSource === source.id;
                          return (
                            <motion.div key={source.id} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                              <div className="flex min-h-14 items-center gap-x-3 gap-y-1 px-4 py-2.5 max-sm:flex-wrap">
                                <Icon className="mt-0.5 size-4 shrink-0 self-start text-muted-foreground" />
                                <div className="min-w-0 flex-1 space-y-1.5 max-sm:basis-[calc(100%-1.75rem)]">
                                  <p className="truncate text-sm font-medium max-sm:line-clamp-2 max-sm:whitespace-normal">{source.name}</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    <Chip>{source.scope === "all" ? `All ${source.total.toLocaleString("en-GB")}` : `Papers ${source.range[0].toLocaleString("en-GB")} to ${source.range[1].toLocaleString("en-GB")} of ${source.total.toLocaleString("en-GB")}`}</Chip>
                                    {source.filters?.map((filter) => <Chip key={filter}>{filter}</Chip>)}
                                    {source.duplicates && taken(source) ? <Chip>{Math.min(source.duplicates, taken(source))} already in another source</Chip> : null}
                                    {source.facts?.map((fact) => (/without/.test(fact) ? <Chip key={fact} className="bg-warning/12 ink-warning">{fact}</Chip> : <Chip key={fact} icon={Check}>{fact}</Chip>))}
                                  </div>
                                </div>
                                {source.total > 1 ? (
                                  <Button variant="ghost" size="sm" aria-expanded={isOpen} className="h-8 shrink-0 text-xs text-muted-foreground max-sm:ms-auto" onClick={() => setOpenSource(isOpen ? null : source.id)}>
                                    Which papers<ChevronDown className={cn("transition-transform duration-200", isOpen && "rotate-180")} />
                                  </Button>
                                ) : null}
                                <TooltipHint label="Remove this source">
                                  <Button data-adds variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={`Remove ${source.name}`} onClick={() => { setRemoved({ what: source.name, zone: "papers", back: draft }); set({ sources: draft.sources.filter((one) => one.id !== source.id) }); }}><Trash2 /></Button>
                                </TooltipHint>
                              </div>
                              <AnimatePresence initial={false}>
                                {isOpen ? (
                                  <motion.div key="scope" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                                    <div className="space-y-4 pb-4 ps-11 pe-4">
                                      <PaperScope
                                        search={source.kind === "search"}
                                        page={false}
                                        scope={source.scope}
                                        onScope={(scope) => patchSource(source.id, { scope: scope === "all" ? "all" : "range" })}
                                        range={source.range}
                                        onRange={(next) => patchSource(source.id, (now) => ({ range: typeof next === "function" ? next(now.range) : next }))}
                                        total={source.total}
                                        label={`Papers of ${source.name}`}
                                        summary={<p className="text-xs text-muted-foreground">Every one of its {source.total.toLocaleString("en-GB")} papers.</p>}
                                      />
                                      <ul className="space-y-1 border-t border-border-subtle pt-3">
                                        {papersOf({ seed: draft.seed, sources: [{ ...source, duplicates: 0 }] }).slice(0, 3).map((paper) => <li key={paper.id} className="truncate text-xs text-muted-foreground">{paper.title} ({paper.year})</li>)}
                                        {taken(source) > 3 ? <li className="text-xs text-muted-foreground">and {(taken(source) - 3).toLocaleString("en-GB")} more</li> : null}
                                      </ul>
                                    </div>
                                  </motion.div>
                                ) : null}
                              </AnimatePresence>
                            </motion.div>
                          );
                        })}
                        {reading.map((name) => (
                          <motion.div key={`reading:${name}`} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                            <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                              <Spinner className="size-4 shrink-0" />
                              <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
                              <Chip>Reading it</Chip>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No papers yet. Add a search, a collection or your own files below, as many as you need.</p>
                  )}
                  {removed?.zone === "papers" ? (
                    <div className="flex items-center gap-3 rounded-2xl bg-inset px-4 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">Removed “{removed.what}”</span>
                      <Button variant="ghost" size="sm" className="h-7" onClick={() => { setDraft(removed.back); setRemoved(null); }}><Undo2 />Put it back</Button>
                    </div>
                  ) : null}
                  {rejected.length ? (
                    <div className="flex items-start gap-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm">
                      <FileX className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <p className="min-w-0 flex-1">Not read: {rejected.join(", ")}. Reference files are RIS, BibTeX, EndNote, PubMed, Web of Science or CSV, and full texts are PDF.</p>
                      <TooltipHint label="Dismiss"><Button variant="ghost" size="icon" className="-my-1 size-7 shrink-0" aria-label="Dismiss" onClick={() => setRejected([])}><X /></Button></TooltipHint>
                    </div>
                  ) : null}

                  <div data-adds className="space-y-3 pt-2">
                    <div className="-mx-1 overflow-x-auto px-1 py-0.5">
                      <Segmented label="Add papers from" value={kind} onChange={(next) => { setKind(next); setFind(""); setOfferPage(1); }} options={KINDS} />
                    </div>
                    {kind === "upload" ? (
                      <div
                        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(event) => { event.preventDefault(); setDragging(false); take(event.dataTransfer.files); }}
                        className={cn("flex flex-col items-center gap-1.5 rounded-2xl border border-dashed px-6 py-7 text-center transition-colors", dragging ? "border-primary bg-primary/5" : "border-border")}
                      >
                        <p className="text-sm font-medium">Drop reference files or PDFs here</p>
                        <p className="text-xs text-muted-foreground">RIS, BibTeX, EndNote, PubMed, Web of Science, CSV and PDF, any number at once</p>
                        <input ref={files} type="file" multiple accept=".ris,.bib,.enw,.nbib,.xml,.ciw,.csv,.txt,.pdf" className="sr-only" aria-label="Files to upload" onChange={(event) => { if (event.target.files) take(event.target.files); event.target.value = ""; }} />
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => files.current?.click()}><Upload />Choose files</Button>
                      </div>
                    ) : kind === "dois" ? (
                      <div className="space-y-2">
                        <Textarea value={dois} onChange={(event) => setDois(event.target.value)} rows={4} placeholder="Paste DOIs, one a line or separated by commas" aria-label="DOIs" className="text-sm" />
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-muted-foreground">{doiCount ? `${doiCount} ${doiCount === 1 ? "DOI" : "DOIs"} found in what you pasted` : "Each one is looked up in Openscholar's index"}</p>
                          <Button variant="outline" size="sm" disabled={!doiCount} onClick={() => { addSource("dois", `${doiCount} pasted ${doiCount === 1 ? "DOI" : "DOIs"}`, "Looked up in Openscholar's index", doiCount, [`${Math.max(0, doiCount - 1)} found in Openscholar's index`]); setDois(""); }}><Plus />Add {doiCount || ""} {doiCount === 1 ? "paper" : "papers"}</Button>
                        </div>
                      </div>
                    ) : kind === "evidenceLibrary" ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-start gap-2">
                          <Select value={community} onValueChange={(next) => { setCommunity(next); setOfferPage(1); setGroup("all"); }}>
                            <SelectTrigger aria-label="Evidence Community" className="h-9 w-full min-w-0 sm:w-72"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {COMMUNITIES.map((one) => <SelectItem key={one.id} value={one.id}><span className="flex min-w-0 items-center gap-2"><span className="truncate">{one.name}</span><span className="shrink-0 text-xs text-muted-foreground">{one.role}</span></span></SelectItem>)}
                            </SelectContent>
                          </Select>
                          <form className="min-w-0 flex-1 basis-56 space-y-1" onSubmit={(event) => { event.preventDefault(); paste(); }}>
                            <div className="relative">
                              <Link2 className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                              <Input value={address} onChange={(event) => { setAddress(event.target.value); setAddressProblem(null); }} placeholder="Paste a collection's address" aria-label="Paste a collection's address" aria-invalid={Boolean(addressProblem)} className="h-9 ps-8 text-sm" />
                            </div>
                            {/* The problem sits under the field it is about. */}
                            {addressProblem ? <p role="alert" className="px-1 text-xs text-destructive">{addressProblem}</p> : null}
                          </form>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Segmented label="Show" value={group} onChange={(next) => { setGroup(next); setOfferPage(1); }} options={[{ id: "all" as const, label: "All" }, { id: "yours" as const, label: "Yours" }, { id: "shared" as const, label: "Shared with you" }, { id: "library" as const, label: "The community's" }]} />
                          <div className="relative min-w-40 flex-1">
                            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input value={find} onChange={(event) => { setFind(event.target.value); setOfferPage(1); }} placeholder="Find" aria-label="Find a collection" className="h-8 rounded-full ps-8 text-sm" />
                          </div>
                        </div>
                        <div className={LIST} style={{ minHeight: communityPager.pages > 1 ? OFFER_PAGE * 57 : undefined }}>
                          {communityRows.slice((communityPager.page - 1) * OFFER_PAGE, communityPager.page * OFFER_PAGE).map((row) => (
                            <OfferRow
                              key={row.name}
                              offer={{ name: row.name, detail: row.group === "library" && !row.parent ? `${inCommunity.records.toLocaleString("en-GB")} records` : `In ${inCommunity.name}`, total: row.total }}
                              icon={iconOf("evidenceLibrary")}
                              chips={
                                <>
                                  {row.pasted ? <Chip icon={Link2} className="h-5 px-1.5">From a link</Chip> : null}
                                  {row.access ? <Chip icon={row.access === "editor" ? PenLine : Eye} className="h-5 px-1.5">{row.access === "editor" ? "Can edit" : "Can view"}</Chip> : null}
                                  {row.private !== undefined ? <Chip icon={row.private ? Lock : Globe} className="h-5 px-1.5">{row.private ? "Private" : "Public"}</Chip> : null}
                                  {row.parent ? <Chip icon={Folder} className="h-5 px-1.5">In {row.parent}</Chip> : null}
                                </>
                              }
                              added={draft.sources.some((source) => source.kind === "evidenceLibrary" && source.name === row.name)}
                              onAdd={() => { addSource("evidenceLibrary", row.name, `In ${inCommunity.name}`, row.total); setDraft((d) => ({ ...d, sources: d.sources.map((source) => (source.kind === "evidenceLibrary" && source.name === row.name ? { ...source, filters: [inCommunity.name, "As it stands when the screening starts"] } : source)) })); }}
                            />
                          ))}
                          {!communityRows.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{find.trim() ? "Nothing by that name." : group === "yours" ? `You have no collections in ${inCommunity.name}.` : group === "shared" ? `Nobody has shared a collection in ${inCommunity.name} with you.` : `Nothing to read in ${inCommunity.name} yet.`}</p> : null}
                        </div>
                        {communityPager.pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={communityPager.page} totalPages={communityPager.pages} onPageChange={setOfferPage} totalItems={communityRows.length} itemsPerPage={OFFER_PAGE} itemLabel="collections" /> : null}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {OFFERS[kind].length > OFFER_PAGE ? (
                          <div className="relative">
                            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input value={find} onChange={(event) => { setFind(event.target.value); setOfferPage(1); }} placeholder={`Find a ${KINDS.find((one) => one.id === kind)!.label.toLowerCase()}`} aria-label="Find a source" className="h-8 rounded-full ps-8 text-sm" />
                          </div>
                        ) : null}
                        <div className={LIST} style={{ minHeight: offerPager.pages > 1 ? OFFER_PAGE * 57 : undefined }}>
                          {offers.slice((offerPager.page - 1) * OFFER_PAGE, offerPager.page * OFFER_PAGE).map((offer) => <OfferRow key={offer.name} offer={offer} icon={iconOf(kind)} added={draft.sources.some((source) => source.kind === kind && source.name === offer.name)} onAdd={() => { addSource(kind, offer.name, offer.detail, offer.total); if (offer.filters) setDraft((d) => ({ ...d, sources: d.sources.map((source) => (source.kind === kind && source.name === offer.name ? { ...source, filters: offer.filters } : source)) })); }} />)}
                          {!offers.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing by that name.</p> : null}
                        </div>
                        {offerPager.pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={offerPager.page} totalPages={offerPager.pages} onPageChange={setOfferPage} totalItems={offers.length} itemsPerPage={OFFER_PAGE} itemLabel="sources" /> : null}
                      </div>
                    )}
                  </div>
                </Zone>

                {/* Criteria */}
                <Zone
                  label="Criteria"
                  aside={
                    <span data-adds className="flex flex-wrap items-center justify-end gap-1">
                      {importable.length ? (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => importable.forEach(({ question }) => addCriterion(question))}>
                          <ListChecks />Take {importable.length} from a search
                        </Button>
                      ) : null}
                      {store.screenings.some((one) => one.id !== id && one.criteria.length) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 text-xs"><Copy />Copy from a screening</Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-80">
                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Adds its criteria to the ones here, with their points</DropdownMenuLabel>
                            {store.screenings.filter((one) => one.id !== id && one.criteria.length).slice(0, 8).map((one) => (
                              <DropdownMenuItem key={one.id} onSelect={() => setDraft((d) => { const fresh = one.criteria.filter((criterion) => !d.criteria.some((mine) => mine.key === criterion.key || mine.text === criterion.text)); return { ...d, criteria: [...d.criteria, ...fresh.map((criterion) => ({ ...criterion, addedAt: Date.now() }))], scoring: { ...d.scoring, points: { ...Object.fromEntries(fresh.map((criterion) => [criterion.key, one.scoring.points[criterion.key] ?? [1, 0, 0]])), ...d.scoring.points } } }; })}>
                                <span className="min-w-0 flex-1 truncate">{one.name}</span>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{one.criteria.length} criteria</span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                      <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={writing || WRITTEN.every((question) => draft.criteria.some((criterion) => criterion.text === question))} onClick={() => { if (!draft.question.trim()) { question.current?.focus(); return; } setWriting(true); setTimeout(() => { WRITTEN.forEach((written) => addCriterion(written)); setWriting(false); }, 1200); }}>
                        <AiIcon working={writing} />{draft.question.trim() ? "Write them from the research question" : "Write the research question first"}
                      </Button>
                    </span>
                  }
                >
                  <div className={LIST}>
                    <p className="bg-inset px-4 py-2 text-xs text-muted-foreground">A paper that fails a must-have criterion is excluded. A nice-to-have one never excludes it.</p>
                    <AnimatePresence initial={false}>
                      {draft.criteria.map((criterion, i) => (
                        <motion.div key={criterion.key} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                          <div className="flex items-center gap-x-3 gap-y-1 px-4 py-2 max-sm:flex-wrap">
                            <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                            <Textarea rows={1} value={criterion.text} onChange={(event) => patchCriterion(criterion.key, { text: event.target.value, short: criterion.addedAt === 0 ? criterion.short : shortOf(event.target.value) })} aria-label={`Criterion ${i + 1}`} className="min-h-8 min-w-0 flex-1 resize-none border-transparent bg-transparent px-1 py-1.5 text-sm shadow-none field-sizing-content hover:border-border-subtle max-sm:basis-[calc(100%-1.75rem)]" />
                            <Segmented label={`Criterion ${i + 1} is`} className="max-sm:ms-5" value={criterion.must ? "must" : "nice"} onChange={(next) => patchCriterion(criterion.key, { must: next === "must" })} options={[{ id: "must", label: "Must-have" }, { id: "nice", label: "Nice to have" }]} />
                            <TooltipHint label="Remove this criterion">
                              <Button data-adds variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={`Remove criterion ${i + 1}`} onClick={() => { setRemoved({ what: criterion.short, zone: "criteria", back: draft }); set({ criteria: draft.criteria.filter((one) => one.key !== criterion.key) }); }}><Trash2 /></Button>
                            </TooltipHint>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {!draft.criteria.length ? <p className="px-4 py-4 text-sm text-muted-foreground">No criteria yet. Without any, each reviewer decides on what they read, and a model has nothing to answer.</p> : null}
                    <form data-adds className="flex items-center gap-2 px-4 py-2.5" onSubmit={(event) => { event.preventDefault(); addCriterion(text); setText(""); }}>
                      <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a criterion with a yes or no answer" aria-label="New criterion" className="h-9 flex-1" />
                      <Button type="submit" variant="outline" size="sm" className="h-9" disabled={!text.trim()}><Plus />Add</Button>
                    </form>
                    <div>
                      <button type="button" aria-expanded={scoring} onClick={() => setScoring(!scoring)} className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-muted">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">Scoring</span>
                          <span className="block text-xs text-muted-foreground">How a model&apos;s answers become its vote, and the stars a saved paper gets</span>
                        </span>
                        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", scoring && "rotate-180")} />
                      </button>
                      <AnimatePresence initial={false}>
                        {scoring ? (
                          <motion.div key="scoring" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                            <div className="space-y-4 px-4 pb-4">
                              <div className="space-y-2">
                                <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-center gap-2 text-xs text-muted-foreground">
                                  <span>Points for each answer</span><span className="text-center">Yes</span><span className="text-center">No</span><span className="text-center">Unclear</span>
                                </div>
                                {draft.criteria.map((criterion) => (
                                  <div key={criterion.key} className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-center gap-2">
                                    <span className="truncate text-sm"><CriterionText text={criterion.short} must={criterion.must} /></span>
                                    {[0, 1, 2].map((slot) => (
                                      <Input key={slot} type="number" value={draft.scoring.points[criterion.key]?.[slot] ?? 0} onChange={(event) => set({ scoring: { ...draft.scoring, points: { ...draft.scoring.points, [criterion.key]: (draft.scoring.points[criterion.key] ?? [1, 0, 0]).map((points, at) => (at === slot ? Number(event.target.value) : points)) as [number, number, number] } } })} aria-label={`Points for ${["yes", "no", "unclear"][slot]}, ${criterion.short}`} className="h-8 px-1 text-center text-sm tabular-nums" />
                                    ))}
                                  </div>
                                ))}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                                <label className="flex items-center gap-2 text-sm">Stars begin at
                                  {draft.scoring.stars.map((points, star) => <Input key={star} type="number" value={points} onChange={(event) => set({ scoring: { ...draft.scoring, stars: draft.scoring.stars.map((now, at) => (at === star ? Number(event.target.value) : now)) } })} aria-label={`Points for ${star + 1} stars`} className="h-8 w-12 px-1 text-center text-sm tabular-nums" />)}
                                  <span className="text-xs text-muted-foreground">points, one to five stars</span>
                                </label>
                              </div>
                              <p className="text-xs text-muted-foreground">A model votes exclude when a must-have criterion is no, maybe when one is unclear, and include otherwise. People vote directly. Points only rank the included papers and set the stars they are saved with.</p>
                            </div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </div>
                {removed?.zone === "criteria" ? (
                  <div className="flex items-center gap-3 rounded-2xl bg-inset px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">Removed “{removed.what}”</span>
                    <Button variant="ghost" size="sm" className="h-7" onClick={() => { setDraft(removed.back); setRemoved(null); }}><Undo2 />Put it back</Button>
                  </div>
                ) : null}
                </Zone>

                {/* Reviewers */}
                <Zone label="Reviewers" aside={<Chip>{joined.length} {joined.length === 1 ? "person" : "people"}{people.length > joined.length ? `, ${people.length - joined.length} invited` : ""} and {models.length} {models.length === 1 ? "model" : "models"}</Chip>}>
                  <div className="grid gap-4 @2xl:grid-cols-2">
                    <div className={cn(LIST, "self-start")}>
                      <AnimatePresence initial={false}>
                        {people.map((person) => (
                          <ReviewerRow key={person.id} reviewer={person} you={person.id === store.viewer} detail={person.email ? "Invited by email, votes once they join" : person.id === draft.rule.resolver ? "Settles conflicts" : personOf(person.id)?.guest ? "From outside this workspace" : "In this workspace"} onRemove={() => removeReviewer(person)} />
                        ))}
                      </AnimatePresence>
                      {!people.length ? <p className="px-4 py-4 text-sm text-muted-foreground">No person: the models decide between them, and a conflict goes to whoever started the screening.</p> : null}
                      <div data-adds className="px-4 py-2.5">
                        <AddPerson exclude={people.map((person) => person.id)} onPick={(pick) => addReviewer("person" in pick ? personReviewer(pick.person, NOW) : invitedReviewer(pick.email, NOW))}>
                          <Button variant="outline" size="sm" className="w-full"><UserPlus />Add a person</Button>
                        </AddPerson>
                      </div>
                    </div>
                    <div className={cn(LIST, "self-start")}>
                      <AnimatePresence initial={false}>
                        {models.map((model) => (
                          <motion.div key={model.id} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                            <div className="space-y-2 p-2.5">
                              <NodeCard model={model.model!} paidBy="credits" tabIndex={-1} note={<span className="tabular-nums">{credits(paperCredits(model.model!, "abstract"))} credits a paper</span>} />
                              <div className="flex items-center gap-2 ps-1.5">
                                <span className="min-w-0 flex-1 text-xs tabular-nums text-muted-foreground">{credits(paperCredits(model.model!, "abstract") * papers)} credits for these {papers.toLocaleString("en-GB")} papers</span>
                                <TooltipHint label="Take this model off"><Button data-adds variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label={`Take ${model.name} off`} onClick={() => removeReviewer(model)}><Trash2 /></Button></TooltipHint>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                      {!models.length ? <p className="px-4 py-4 text-sm text-muted-foreground">No model: people only, and it costs nothing.</p> : null}
                      <div data-adds className="px-4 py-2.5">
                        <AddModel exclude={models.map((model) => model.model!.id)} onPick={(model) => addReviewer(modelReviewer(model, NOW))}>
                          <Button variant="outline" size="sm" className="w-full"><Plus />Add a model</Button>
                        </AddModel>
                      </div>
                    </div>
                  </div>
                </Zone>

                {/* How a paper is decided */}
                <Zone label="How a paper is decided" className="scroll-mt-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+1rem)]">
                  <div id="decided" className={LIST}>
                    <RuleRow name="Models" detail="Every model reads every paper">
                      {models.length ? <ReviewerStack reviewers={models} max={8} /> : <span className="text-sm text-muted-foreground">None</span>}
                    </RuleRow>
                    <RuleRow name="People on each paper" detail={joined.length ? `About ${Math.ceil((papers * each) / joined.length).toLocaleString("en-GB")} papers for each person` : "Add a person to choose"}>
                      {joined.length === 1 ? (
                        <Chip>{joined[0]!.id === store.viewer ? "You read" : `${joined[0]!.name.split(" ")[0]} reads`} every paper</Chip>
                      ) : joined.length ? (
                        <Segmented label="People on each paper" value={joined.length === 1 || (joined.length === 2 && draft.rule.each === "2") ? "all" : draft.rule.each} onChange={(next) => set({ rule: { ...draft.rule, each: next } })} options={[{ id: "1" as const, label: "One" }, ...(joined.length > 1 ? [{ id: "2" as const, label: "Two" }] : []), { id: "all" as const, label: joined.length > 2 ? `All ${joined.length}` : joined.length === 2 ? "Both" : "The one" }].filter((option, i, all) => all.findIndex((one) => one.label === option.label) === i && !(joined.length === 2 && option.id === "2") && !(joined.length === 1 && option.id === "1"))} />
                      ) : <span className="text-sm text-muted-foreground">None</span>}
                    </RuleRow>
                    <RuleRow name="A paper is settled when" detail={draft.rule.settle === "all" ? "Any disagreement is a conflict" : draft.rule.settle === "most" ? "More than half on one side. An even split is a conflict" : "The first vote in decides, whoever casts it"}>
                      <Segmented label="A paper is settled when" value={draft.rule.settle} onChange={(next) => set({ rule: { ...draft.rule, settle: next } })} options={[{ id: "all" as const, label: "All agree" }, { id: "most" as const, label: "Most agree" }, { id: "one" as const, label: "One has voted" }]} />
                    </RuleRow>
                    <RuleRow name="A conflict goes to" detail="They see every vote, and their decision is the paper's result">
                      {joined.length ? (
                        <Select value={joined.some((person) => person.id === draft.rule.resolver) ? draft.rule.resolver : joined[0]!.id} onValueChange={(next) => set({ rule: { ...draft.rule, resolver: next } })}>
                          <SelectTrigger aria-label="Who settles a conflict" className="h-9 w-56"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {joined.map((person) => <SelectItem key={person.id} value={person.id}><span className="flex items-center gap-2"><ReviewerMark reviewer={person} className="size-5" />{person.name}</span></SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : <span className="flex items-center gap-2 text-sm"><ReviewerMark reviewer={personReviewer(personOf(draft.createdBy)!, 0)} className="size-5" />{personOf(draft.createdBy)?.name}</span>}
                    </RuleRow>
                    <RuleRow name="People see the other votes" detail={draft.rule.blind === "after" ? "Nobody is swayed: a paper's votes show once you have cast yours" : "Everyone sees every vote as it is cast"}>
                      <Segmented label="People see the other votes" value={draft.rule.blind} onChange={(next) => set({ rule: { ...draft.rule, blind: next } })} options={[{ id: "after" as const, label: "After they vote" }, { id: "always" as const, label: "At any time" }]} />
                    </RuleRow>
                    {/* What the rule does, on three made-up papers. */}
                    <div className="space-y-2 bg-inset px-4 py-3">
                      <p className="text-xs text-muted-foreground">With {models.length + each} {models.length + each === 1 ? "vote" : "votes"} on a paper, for example</p>
                      <RuleExamples rule={draft.rule} people={joined.length} models={models.length} />
                    </div>
                  </div>
                  {draft.rule.settle === "one" && models.length ? <p className="rounded-2xl bg-warning/10 px-4 py-2.5 text-sm ink-warning">A model reads faster than any person, so its vote alone will settle most papers.</p> : null}
                </Zone>

                {/* Stages */}
                <Zone label="Stages">
                  <div className={LIST}>
                    <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-sm font-medium">Title and abstract</p>
                        <div className="flex flex-wrap gap-1.5"><Chip>Every paper</Chip><Chip>Every reviewer</Chip></div>
                      </div>
                      <Chip icon={Check}>Always</Chip>
                    </div>
                    <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-sm font-medium">Full text</p>
                        <div className="flex flex-wrap gap-1.5">
                          <Chip>Papers included or left as maybe</Chip>
                          <Chip>Open-access copies are fetched, the rest you add</Chip>
                          {models.length ? <Chip icon={Coins}>About {credits(models.reduce((sum, model) => sum + paperCredits(model.model!, "fullText"), 0))} credits a paper</Chip> : null}
                        </div>
                      </div>
                      <Switch checked={draft.fullText} onCheckedChange={(fullText) => set({ fullText })} aria-label="Screen the kept papers again on their full text" />
                    </label>
                  </div>
                </Zone>

                {/* Where included papers go */}
                <Zone label="Included papers go to" aside={<Segmented label="Where" value={where} onChange={(next) => { setWhere(next); setDestPage(1); set({ destination: { ...draft.destination, kind: next === "community" ? "community" : "new", collection: next === "community" ? COMMUNITY_COLLECTIONS[0]!.id : undefined } }); }} options={[{ id: "openscholar", label: "Your library" }, { id: "community", label: "An Evidence Community" }]} />}>
                  <div id="goes-to" className={cn(LIST, "scroll-mt-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+3rem)]")} role="radiogroup" aria-label="Where included papers go">
                    {places.slice((destPager.page - 1) * DEST_PAGE, destPager.page * DEST_PAGE)}
                  </div>
                  {destPager.pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={destPager.page} totalPages={destPager.pages} onPageChange={setDestPage} totalItems={places.length} itemsPerPage={DEST_PAGE} itemLabel="places" /> : null}
                  {fromCollection ? (
                    <label className="flex items-center gap-3 rounded-2xl border border-border-subtle px-4 py-3">
                      <span className="min-w-0 flex-1 space-y-1.5">
                        <span className="block truncate text-sm font-medium">Remove papers that aren&apos;t included from {fromCollection.name}</span>
                        <span className="flex flex-wrap gap-1.5"><Chip icon={X}>Excluded leave</Chip><Chip>Maybe and in conflict stay</Chip></span>
                      </span>
                      <Switch checked={draft.destination.prune} onCheckedChange={(prune) => set({ destination: { ...draft.destination, prune } })} aria-label={`Remove papers that aren't included from ${fromCollection.name}`} />
                    </label>
                  ) : null}
                </Zone>
              </div>

              {/* What it comes to, in view beside the form. */}
              <aside className="min-w-0 p-4 max-@4xl:border-t max-@4xl:border-border-subtle sm:p-6">
                <div className="space-y-6 @4xl:sticky @4xl:top-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+1.5rem)]">
                  <div>
                    <p className="text-3xl font-semibold tabular-nums tracking-tight"><AnimatedNumber value={papers} /></p>
                    <p className="text-sm text-muted-foreground">{papers === 1 ? "paper" : "papers"} to screen</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Reviewers</p>
                    {activeReviewers(draft).length ? <ReviewerStack reviewers={activeReviewers(draft)} max={9} /> : <p className="text-sm text-muted-foreground">Nobody yet</p>}
                  </div>
                  <div className="space-y-2.5">
                    <p className="text-xs font-medium text-muted-foreground">Cost on title and abstract</p>
                    <div className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">People</span><span className="text-muted-foreground">Free</span></div>
                    {models.map((model) => (
                      <div key={model.id} className="flex items-center gap-2 text-sm">
                        <ReviewerMark reviewer={model} className="size-5" />
                        <span className="min-w-0 flex-1 truncate">{model.name}</span>
                        <span className="tabular-nums">{credits(paperCredits(model.model!, "abstract") * papers)}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 border-t border-border-subtle pt-2.5 text-sm font-semibold"><Coins className="size-4 text-primary" /><span className="flex-1">Up to</span><span className="tabular-nums">{credits(cost)} credits</span></div>
                    <Meter value={cost} max={Math.max(wallet, 1)} fill={cost > wallet ? "bg-destructive" : "bg-primary"} />
                    <div className="flex flex-wrap gap-1.5"><WorkspaceTag size="sm" workspace={{ kind: workspace.kind, name: workspace.name, imageUrl: workspace.imageUrl, colour: workspace.colour, workspaceId: workspace.id }}>{credits(wallet)} in {workspace.name}</WorkspaceTag>{cost > wallet ? <Chip className="bg-destructive/10 text-destructive">{credits(cost - wallet)} short</Chip> : <Chip>{credits(wallet - cost)} left after</Chip>}</div>
                    {models.length && draft.fullText ? (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 text-muted-foreground">Then, for each paper that reaches full text</span>
                        <span className="shrink-0 tabular-nums">{credits(models.reduce((sum, model) => sum + paperCredits(model.model!, "fullText"), 0))}</span>
                      </div>
                    ) : null}
                  </div>
                  {fresh ? (
                    <div className="space-y-2">
                      <Button className="w-full" disabled={Boolean(stop)} onClick={start}>{stop ?? "Start screening"}</Button>
                      {stop && cost > wallet ? <Button variant="outline" size="sm" className="w-full" onClick={() => store.set({ wallet: store.wallet + 20_000 })}>Add 20,000 credits</Button> : null}
                      <div className="flex flex-wrap gap-1.5">{models.length ? <TooltipHint label="The models read 40 papers at once, which is what this workspace's plan allows"><span tabIndex={0} className="flex rounded-md"><Chip icon={Gauge}>40 papers at a time</Chip></span></TooltipHint> : <Chip>No model, nothing to pay</Chip>}{busy && models.length ? <TooltipHint label={`${busy.name}'s models are still reading, and a workspace's models read 40 papers at once. Yours start when they are through; people can vote from the start.`}><span tabIndex={0} className="flex rounded-md"><Chip icon={Clock}>Models start after another screening</Chip></span></TooltipHint> : null}</div>
                    </div>
                  ) : locked ? null : (
                    <div className="space-y-3 rounded-2xl border border-border-subtle p-3">
                      <p className="text-xs font-medium text-muted-foreground">{dirty ? "What saving does" : "Changes"}</p>
                      {dirty ? <EffectList lines={lines} moves={moves} /> : <p className="text-sm text-muted-foreground">Nothing changed yet. Change anything on the left, and what it does shows here before you save.</p>}
                      <div className="flex gap-2">
                        <Button className="flex-1" disabled={!dirty || needsCriteria} onClick={save}>Save changes</Button>
                        <Button variant="ghost" disabled={!dirty} onClick={() => store.draft(key, () => undefined)}>Discard</Button>
                      </div>
                      {needsCriteria ? <p className="text-xs text-destructive">A model answers criteria, and this screening has none. Add one, or take the model off.</p> : null}
                    </div>
                  )}
                  {saved ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Latest changes</p>
                      <ul className="space-y-2">
                        {[...saved.changes].reverse().slice(0, 4).map((change, i) => (
                          <li key={i} className="text-xs"><span className="font-medium">{personOf(change.by)?.name ?? change.by}</span> <span className="text-muted-foreground">{ago(change.at)}</span><span className="block text-muted-foreground">{change.what}</span></li>
                        ))}
                      </ul>
                      <Button asChild variant="ghost" size="sm" className="h-7 px-1.5 text-xs"><NextLink href={`/screening/mock/${id}`}>Back to the screening</NextLink></Button>
                    </div>
                  ) : null}
                </div>
              </aside>
            </div>
          </LibraryPageShell>
        </div>
        <MockStates />
      </PageWrapper>
    </MotionConfig>
  );
}

function OfferRow({ offer, icon: Icon, chips, added, onAdd }: { offer: Offer; icon: AppIcon; /** What else tells this row from the others, after its detail. */ chips?: ReactNode; added: boolean; onAdd: () => void }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 self-start text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{offer.name}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><span className="truncate">{offer.detail}</span>{offer.filters?.map((filter) => <Chip key={filter} className="h-5 px-1.5 @max-2xl:hidden">{filter}</Chip>)}{chips ? <span className="flex shrink-0 items-center gap-1.5 @max-2xl:hidden">{chips}</span> : null}</p>
      </div>
      <Chip>{offer.total.toLocaleString("en-GB")} {offer.total === 1 ? "paper" : "papers"}</Chip>
      <Button variant="outline" size="sm" className="w-24" disabled={added || !offer.total} onClick={onAdd}>{added ? <><Check />Added</> : !offer.total ? "Empty" : <><Plus />Add</>}</Button>
    </div>
  );
}

/** A person on the screening, with what they are to it and the way to take them off. */
function ReviewerRow({ reviewer, you, detail, onRemove }: { reviewer: Reviewer; you: boolean; detail: string; onRemove: () => void }) {
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
      <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
        <ReviewerMark reviewer={reviewer} className="size-9 self-start" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium"><span className="truncate">{reviewer.name}</span>{you ? <YouTag /> : null}</p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
        <TooltipHint label="Take off this screening"><Button data-adds variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Take ${reviewer.name} off`} onClick={onRemove}><Trash2 /></Button></TooltipHint>
      </div>
    </motion.div>
  );
}

/** One choice of the rule: what it is and what it does on the left, the choice on the right. */
function RuleRow({ name, detail, children }: { name: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-48 flex-1">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      {children}
    </div>
  );
}

function Destination({ on, onPick, icon: Icon, name, facts, children }: { on: boolean; onPick: () => void; icon: AppIcon; name?: string; facts?: ReactNode; children?: ReactNode }) {
  return (
    <div role="radio" aria-checked={on} tabIndex={0} onClick={onPick} onKeyDown={(event) => (event.key === " " || event.key === "Enter") && event.target === event.currentTarget && onPick()} className={cn("flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-muted", on && "bg-primary/5")}>
      <Icon className={cn("size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
      <div className="min-w-0 flex-1 text-sm font-medium">{children ?? name}</div>
      {facts}
      <PickMark on={on} />
    </div>
  );
}
