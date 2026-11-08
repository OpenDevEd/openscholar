"use client";

import { useRef, useState, type ReactNode, type UIEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocale } from "next-intl";
import { isRightToLeft } from "@/lib/i18n/locale-map";
import { EASE } from "@/components/settings/model-map";
import { SHEET_SPRING } from "@/lib/motion";
import { useAuth, useClerk } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { CheckCircle2, EvidenceLibrariesIcon, Globe, ReviewQueueIcon, Search, Undo2 } from "@/components/icons";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RoleLabel } from "@/components/ui/identity";
import { TooltipHint } from "@/components/ui/tooltip";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useProtectedPaginatedQuery } from "@/lib/auth/use-auth-query";
import { CommunityCard, type Card } from "../public-communities";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import { normalDoi } from "@/lib/papers/paper-ref";
import type { WorkInput } from "@/lib/library/trim-paper-data";
import { communityPapers, useAddedPapers, type AddedState, type FoundPaper } from "@/lib/evidence-libraries/added-papers-mock";
import { CommunityIcon, fromOverview, ROLE_KINDS, type Community, type Overview } from "../your-communities";
import { StatusChip } from "../configuration/status-chip";
import { PublishChoice, publishes } from "./publish-choice";
import { fromCard, useMySubmissions } from "./use-my-submissions";

/** Communities each list reads at first, and how many more each time the list scrolls near its end. */
const STEP = 20;
/** How close to the bottom of the list, in pixels, the next ones start loading. */
const LOAD_AHEAD_PX = 80;
/** Communities you sent papers to lately, at the top of the list. */
const RECENT = 3;

const ROLE_WORD = { owner: "Owner", editor: "Editor", creator: "Creator", viewer: "Viewer" } as const;

/** The paper as a community takes it: found on OpenAlex, as every search result is. */
function foundOf(paper: WorkInput): FoundPaper {
  const id = paper.id.replace("https://openalex.org/", "");
  const names = (paper.authorships ?? []).flatMap((authorship) => authorship.author?.display_name ?? []);
  return {
    key: id,
    openalexId: id,
    doi: normalDoi(paper.doi),
    title: paper.title || paper.display_name || "Untitled",
    authors: names.length > 3 ? `${names.slice(0, 3).join(", ")} et al.` : names.join(", "),
    year: paper.publication_year ?? null,
    foundBy: "openalex",
  };
}

/**
 * Add to community, beside Save and the collections folder, and built like the collections popover: one list,
 * searched on the server and read further as it scrolls. Communities you sent papers to lately come first, then
 * yours, then every public one. Owners and editors publish the paper or send it to the review queue; on any other
 * community it goes to the queue.
 */
export function CommunityControl({ paper }: { paper: WorkInput }) {
  const { isSignedIn } = useAuth();
  const { openSignIn } = useClerk();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [openedWith, setOpenedWith] = useState<string[] | null>(null);
  const byCommunity = useAddedPapers((state) => state.byCommunity);
  const found = foundOf(paper);
  const search = useDebouncedValue(query.trim(), 300);
  // Read once the pointer reaches the button or it takes focus, so the list is there by the click. Only that card
  // reads: each paginated read is a subscription of its own, and every card reading would ask the server for the
  // same lists once per paper on the page. Scrolling near the end reads the next page onto it.
  const [prepared, setPrepared] = useState(false);
  const reads = isSignedIn && prepared;
  const yours = useHeld(useProtectedPaginatedQuery(api.evidenceLibraries.queries.listLibraries, reads ? (search ? { search } : {}) : "skip", { initialNumItems: STEP }));
  const listed = useHeld(useProtectedPaginatedQuery(api.evidenceLibraries.directory.directory, reads ? { sort: "name", ...(search ? { search } : {}) } : "skip", { initialNumItems: STEP }));
  // ponytail: the mock reads your first 100 communities to tell yours from the public ones and to know your role on a
  // recent one, and the first 100 public cards for the hover card; the real rows carry both, for any number.
  const all = useCursorPage(api.evidenceLibraries.queries.listLibraries, reads ? {} : "skip", 100);
  const cards = useCursorPage(api.evidenceLibraries.directory.directory, reads ? { sort: "name" } : "skip", 100, { open: true });
  const { submissions } = useMySubmissions();
  // MOCK: only what was added in this tab counts, not the sample papers every community starts with.
  const isIn = Object.values(byCommunity).some((papers) => papers.some((row) => row.key === found.key && row.by === "You"));
  const button = (
    <Button
      variant="outline"
      size="sm"
      aria-label="Add to community"
      className="bg-transparent px-2 has-[>svg]:px-2"
      onClick={isSignedIn ? undefined : () => openSignIn()}
      onPointerEnter={() => setPrepared(true)}
      onFocus={() => setPrepared(true)}
    >
      <EvidenceLibrariesIcon className={isIn ? "text-primary" : "text-muted-foreground"} />
    </Button>
  );
  if (!isSignedIn) return <TooltipHint label="Add to community">{button}</TooltipHint>;
  const roles = new Map(all.items.map((library) => [library._id as string, library.role]));
  const cardById = new Map(cards.items.map((card) => [card._id as string, card]));
  // The communities you sent papers to lately, each once, most recent first.
  const latest = submissions
    .map(({ community }) => community)
    .filter((community, index, list) => list.findIndex((other) => other.id === community.id) === index)
    .slice(0, RECENT)
    .map((community): Community => ({ ...community, role: roles.get(community.id) ?? "viewer" }));
  // Kept as they were when the popover opened: a paper sent from it doesn't move its rows.
  const recent = (openedWith ?? latest.map((community) => community.id)).flatMap((id) => latest.find((community) => community.id === id) ?? submissions.find(({ community }) => community.id === id)?.community ?? []).map((community): Community => ({ ...community, role: roles.get(community.id) ?? "viewer" }));
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setOpenedWith(next ? latest.map((community) => community.id) : null);
        if (!next) setQuery("");
      }}
    >
      <TooltipHint label="Add to community">
        <PopoverTrigger asChild>{button}</PopoverTrigger>
      </TooltipHint>
      <PopoverContent align="start" className="relative flex overflow-visible max-h-[min(30rem,var(--radix-popover-content-available-height))] w-80 flex-col p-2">
        <CommunitiesPanel
          paper={found}
          query={query}
          onQuery={setQuery}
          searching={search.length > 0}
          recent={search ? [] : recent}
          mine={yours.items.map(fromOverview).filter((community) => !community.draft)}
          others={listed.items.filter((card) => !roles.has(card._id)).map(fromCard)}
          cardOf={(community) => cardById.get(community.id) ?? overviewCard(all.items.find((library) => library._id === community.id))}
          loading={yours.loading || listed.loading}
          stale={yours.stale || listed.stale}
          onScroll={(event) => {
            const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
            if (scrollHeight - scrollTop - clientHeight >= LOAD_AHEAD_PX) return;
            // Yours first, then the public ones under them.
            (yours.canLoadMore ? yours : listed).loadMore();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function CommunitiesPanel({ paper, query, onQuery, searching, recent, mine, others, cardOf, loading, stale, onScroll }: {
  paper: FoundPaper;
  query: string;
  onQuery: (query: string) => void;
  searching: boolean;
  recent: Community[];
  mine: Community[];
  others: Community[];
  loading: boolean;
  /** A new search or more rows are being read: what's shown stays, dimmed. */
  stale: boolean;
  /** What the hover card shows: its public card, or what's known of one that isn't listed. */
  cardOf: (community: Community) => Card | undefined;
  onScroll: (event: UIEvent<HTMLElement>) => void;
}) {
  const [picked, setPicked] = useState<Community | null>(null);
  const hover = useHoverCard();
  const [sending, setSending] = useState<"publish" | "queue" | null>(null);
  const byCommunity = useAddedPapers((state) => state.byCommunity);
  const add = useAddedPapers((state) => state.add);
  const recentIds = new Set(recent.map((community) => community.id));
  const yours = mine.filter((community) => !recentIds.has(community.id));
  const publicOnes = others.filter((community) => !recentIds.has(community.id));
  const stateIn = (communityId: string): AddedState | undefined =>
    byCommunity[communityId] ? communityPapers(byCommunity, communityId).find((row) => row.key === paper.key)?.state : undefined;

  const send = (publish: boolean) => {
    if (!picked) return;
    setSending(publish ? "publish" : "queue");
    // MOCK: the real call goes to new-el, as every other way of adding a paper does.
    window.setTimeout(() => {
      add(picked.id, [paper], publish, picked);
      toast.success(publish ? `Published to ${picked.name}` : `Sent to ${picked.name}'s review queue`, { description: paper.title });
      // The popover stays open, so the paper can go to another community too.
      setSending(null);
      setPicked(null);
    }, 600);
  };

  const sub = (community: Community): ReactNode =>
    community.role !== "viewer" ? (
      <RoleLabel role={ROLE_KINDS[community.role]} className="min-w-0 shrink">
        <span className="truncate">{ROLE_WORD[community.role]}</span>
      </RoleLabel>
    ) : (
      <span className="flex min-w-0 items-center gap-1.5">
        <Globe className="size-3.5 shrink-0" />
        <span className="truncate">{community.owner.name || community.address}</span>
      </span>
    );

  const row = (community: Community) => {
    const state = stateIn(community.id);
    const selected = picked?.id === community.id;
    const canPublish = publishes(community.role);
    return (
      <li key={community.id}>
        <button
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse") return;
            const popover = event.currentTarget.closest("[data-slot=popover-content]")?.getBoundingClientRect();
            if (!popover) return;
            // Level with the row, kept on screen: a card for a low row rises to fit.
            const row = event.currentTarget.getBoundingClientRect().top - popover.top - 8;
            const room = window.innerHeight - popover.top - CARD_REM * 16 - 16;
            hover.show(cardOf(community), Math.max(-popover.top + 8, Math.min(row, room)));
          }}
          type="button"
          aria-pressed={selected}
          disabled={state !== undefined}
          onClick={() => setPicked(selected ? null : community)}
          className={cn(
            "flex h-12 w-full items-center gap-3 rounded-lg px-2 text-start transition-colors hover:bg-muted disabled:pointer-events-none",
            selected && "bg-primary/10 hover:bg-primary/15",
          )}
        >
          <CommunityIcon community={community} fadeIn />
          <span className="flex min-w-0 flex-1 flex-col">
            {/* No tooltip for a cut-off name: the card beside the popover shows it whole. */}
            <span className="truncate text-sm font-medium">{community.name}</span>
            <span className="flex min-w-0 items-center text-xs text-muted-foreground">{sub(community)}</span>
          </span>
          {state === "queued" ? (
            <StatusChip tone="running" icon={ReviewQueueIcon}>In queue</StatusChip>
          ) : state === "returned" ? (
            <StatusChip tone="warning" icon={Undo2}>Returned</StatusChip>
          ) : state ? (
            <StatusChip tone="success" icon={CheckCircle2}>Added</StatusChip>
          ) : null}
        </button>
        {/* The choice opens under the community picked, where the pointer already is. */}
        {selected ? (
          // Brought into view when it opens under a row at the foot of the list.
          <div ref={(element) => element?.scrollIntoView({ block: "nearest" })} className="fade-enter space-y-2 px-2 pb-2 pt-1.5">
            <p className="text-xs text-muted-foreground">
              {canPublish ? "Publish it now, or let the team review it first." : "The community's team reviews it before it goes live."}
            </p>
            <PublishChoice size="sm" canPublish={canPublish} sending={sending} onSend={send} />
          </div>
        ) : null}
      </li>
    );
  };

  const section = (label: string, communities: Community[]) =>
    communities.length ? (
      <>
        <p className="px-2 pb-0.5 pt-2 text-xs font-medium text-muted-foreground">{label}</p>
        <ul className="space-y-0.5">{communities.map(row)}</ul>
      </>
    ) : null;

  return (
    <>
      {/* Its card to the left of the popover, on a screen wide enough and a pointer that hovers. */}
      <SideCard hover={hover} />
      <p className="px-2 pt-1 pb-2 text-sm font-medium">Add to community</p>
      <div className="relative mb-1">
        <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search communities"
          aria-label="Search communities"
          className="h-8 ps-8 text-sm"
        />
      </div>
      {/* One list, read further as it scrolls, as the collections popover beside it is. */}
      <AutoHeight className="min-h-0">
        {loading ? (
          <div className="flex h-24 items-center justify-center"><Spinner /></div>
        ) : recent.length + yours.length + publicOnes.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{searching ? "No communities match" : "No communities yet"}</p>
        ) : (
          <div className={cn("fade-enter max-h-[20rem] space-y-1 overflow-y-auto", stale && "opacity-60")} inert={stale || undefined} onScroll={onScroll} onPointerLeave={hover.hide}>
            {section("Recent", recent)}
            {section("Your communities", yours)}
            {section("Public communities", publicOnes)}
          </div>
        )}
      </AutoHeight>
    </>
  );
}

/**
 * A paginated read whose last answer stays while the next search is read, so the list isn't emptied between two:
 * none before the first.
 */
function useHeld<T extends { _id: string }>(list: { results: T[]; status: "Deferred" | "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted"; loadMore: (count: number) => void }) {
  const [held, setHeld] = useState<{ ids: string; items: T[] }>();
  const ids = list.status === "LoadingFirstPage" || list.status === "Deferred" ? undefined : list.results.map((row) => row._id).join(",");
  if (ids !== undefined && ids !== held?.ids) setHeld({ ids, items: list.results });
  return {
    items: held?.items ?? [],
    loading: held === undefined,
    stale: held !== undefined && (list.status === "LoadingFirstPage" || list.status === "Deferred"),
    canLoadMore: list.status === "CanLoadMore",
    loadMore: () => {
      if (list.status === "CanLoadMore") list.loadMore(STEP);
    },
  };
}

/** A community of yours that isn't listed publicly, as its card can draw it from what the list knows. */
function overviewCard(library: Overview | undefined): Card | undefined {
  if (!library) return undefined;
  return {
    _id: library._id,
    name: library.name,
    tagline: null,
    accentColor: library.accentColor ?? null,
    faviconUrl: library.faviconUrl ?? null,
    address: library.publicAddress,
    owner: { name: library.organization.name, kind: library.organization.kind, imageUrl: library.organization.imageUrl ?? null, workspaceId: library.workspaceId, colour: null },
    records: null,
    countries: [],
    people: null,
    liveAt: library.lastActivatedAt ?? null,
    publishedAt: library.lastActivatedAt ?? null,
  } as Card;
}

/** How long the pointer rests on a row before its card shows, and how long the card stays once it leaves the list. */
const SHOW_MS = 250;
const HIDE_MS = 80;
const SWITCH_MS = 120;

/**
 * The card beside the popover: shown a moment after the pointer rests on a row, switched at once to the next row's
 * card while it's open, and gone a moment after the pointer leaves the list.
 */
function useHoverCard() {
  const [shown, setShown] = useState<{ card: Card; top: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const later = (next: typeof shown, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(next), ms);
  };
  return {
    shown,
    /** `top`: where the row is, from the popover's top, which the card glides to. */
    show: (card: Card | undefined, top: number) => {
      const next = card ? { card, top } : null;
      // Open, it moves to a row the pointer rests on, not to each one it passes over or scrolls under.
      later(next, shown ? SWITCH_MS : SHOW_MS);
    },
    hide: () => later(null, HIDE_MS),
    /** The pointer reached the card, to follow its link: it stays. */
    keep: () => window.clearTimeout(timer.current),
  };
}

/** The card's height, as the directory draws it. */
const CARD_REM = 17.25;

/**
 * The hovered community's card, coming out from behind the popover's edge on the spring the app's cards and
 * sheets use, gliding to each row the pointer moves to, and going back behind the edge when the pointer leaves.
 */
function SideCard({ hover }: { hover: ReturnType<typeof useHoverCard> }) {
  const reduceMotion = useReducedMotion();
  const rtl = isRightToLeft(useLocale());
  // Towards the popover, where the card comes from and goes back to.
  const tucked = rtl ? -64 : 64;
  return (
    // Clipped at the popover's edge only, so the card seems to slide out from under it.
    <div
      className="pointer-events-none absolute end-full top-0 w-[calc(18rem+0.75rem)] max-lg:hidden [@media(hover:none)]:hidden"
      style={{ clipPath: rtl ? "inset(-100vh -100vw -100vh 0)" : "inset(-100vh 0 -100vh -100vw)" }}
    >
      <AnimatePresence>
        {hover.shown ? (
          <motion.div
            key="card"
            onPointerEnter={hover.keep}
            onPointerLeave={hover.hide}
            className="pointer-events-auto absolute start-0 top-0 w-72 overflow-hidden rounded-xl shadow-[0_24px_64px_-16px_rgb(0_0_0/0.35),0_8px_24px_-12px_rgb(0_0_0/0.2)]"
            style={{ "--card-h": `${CARD_REM}rem`, transformOrigin: rtl ? "0% 30%" : "100% 30%" } as React.CSSProperties}
            initial={reduceMotion ? { opacity: 0, y: hover.shown.top } : { opacity: 0, x: tucked, scale: 0.92, y: hover.shown.top }}
            animate={{ opacity: 1, x: 0, scale: 1, y: hover.shown.top }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: tucked, scale: 0.94, transition: { duration: 0.24, ease: EASE } }}
            transition={SHEET_SPRING}
          >
            {/* Another row's card takes this one's place as the frame glides to its row. */}
            <ul>
              <CommunityCard community={hover.shown.card} />
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
