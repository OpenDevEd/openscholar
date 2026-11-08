"use client";

import { useRef, useState, type ReactNode, type UIEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useLocale, useTranslations } from "next-intl";
import { useAuth, useClerk } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CheckCircle2, EvidenceLibrariesIcon, Globe, ReviewQueueIcon, Search, Undo2 } from "@/components/icons";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RoleLabel } from "@/components/ui/identity";
import { TooltipHint } from "@/components/ui/tooltip";
import { EASE } from "@/components/ui/opening";
import { useProtectedPaginatedQuery, useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { isRightToLeft } from "@/lib/i18n/locale-map";
import type { WorkInput } from "@/lib/library/trim-paper-data";
import { SHEET_SPRING } from "@/lib/motion";
import { normalDoi, openalexWork } from "@/lib/papers/paper-ref";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspaces/url";
import { useWorkspaces } from "@/components/workspaces/parts";
import { CommunityCard } from "../public-communities";
import { StatusChip } from "../configuration/status-chip";
import { CommunityIcon, ROLE_KINDS } from "../your-communities";
import { refusalOr } from "./add-papers-dialog";
import { PublishChoice, publishes } from "./publish-choice";

type Card = FunctionReturnType<typeof api.evidenceLibraries.directory.directory>["page"][number];
type Overview = FunctionReturnType<typeof api.evidenceLibraries.queries.listLibraries>["page"][number];
type Recent = FunctionReturnType<typeof api.evidenceLibraries.submissions.recentCommunities>[number];
type Status = FunctionReturnType<typeof api.evidenceLibraries.submissions.sentTo>[number]["status"];

/** A community a row offers: what it shows, the person's role there, the workspace a paper goes from, and its card. */
type Row = {
  id: Id<"evidenceLibraries">;
  name: string;
  faviconUrl: string | null;
  owner: { name: string; imageUrl: string | null; kind: "person" | "organization"; workspaceId?: string };
  address: string;
  role: "owner" | "editor" | "creator" | "viewer";
  /** Where the person sends from: the workspace they're on its team in; for a public one, wherever they are. */
  workspaceId?: Id<"workspaces">;
  card: Card;
};

/** Communities each list reads at first, and how many more each time the list scrolls near its end. */
const STEP = 20;
/** How close to the bottom of the list, in pixels, the next ones start loading. */
const LOAD_AHEAD_PX = 80;

/**
 * A community of yours, as a row and as the card beside the popover draws one that isn't listed publicly. One shared
 * with the person is reached from their own workspace, `own`; the rest from the workspace they're on its team in.
 */
const fromOverview = (library: Overview, own: Id<"workspaces"> | undefined): Row => ({
  id: library._id,
  name: library.name,
  faviconUrl: library.faviconUrl ?? null,
  owner: { ...library.organization, imageUrl: library.organization.imageUrl ?? null, workspaceId: library.workspaceId },
  address: library.publicAddress,
  role: library.role,
  workspaceId: library.from === "shared" ? own : library.workspaceId,
  card: {
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
  } as Card,
});

/** A public community, with no role of the person's on it. */
const fromCard = (card: Card): Row => ({
  id: card._id,
  name: card.name,
  faviconUrl: card.faviconUrl ?? null,
  owner: { name: card.owner.name ?? "", imageUrl: card.owner.imageUrl ?? null, kind: card.owner.kind, workspaceId: card.owner.workspaceId },
  address: card.address,
  role: "viewer",
  card,
});

/** A community the person sent papers to lately, as Openscholar keeps it. */
const fromRecent = (recent: Recent, yours: Row | undefined): Row => ({
  id: recent.libraryId,
  name: recent.name,
  faviconUrl: recent.faviconUrl,
  owner: recent.owner ?? { name: recent.name, imageUrl: null, kind: "organization" },
  address: recent.address ?? "",
  role: recent.role,
  workspaceId: yours?.workspaceId ?? (recent.role === "viewer" ? undefined : recent.workspaceId),
  card: yours?.card ?? ({
    _id: recent.libraryId,
    name: recent.name,
    tagline: null,
    accentColor: null,
    faviconUrl: recent.faviconUrl,
    address: recent.address ?? "",
    owner: { name: recent.owner?.name ?? null, kind: recent.owner?.kind ?? "organization", imageUrl: recent.owner?.imageUrl ?? null, workspaceId: recent.owner?.workspaceId ?? recent.workspaceId, colour: null },
    records: null,
    countries: [],
    people: null,
    liveAt: null,
    publishedAt: null,
  } as Card),
});

/**
 * Add to community, beside Save and the collections folder, and built like the collections popover: one list,
 * searched on the server and read further as it scrolls. Communities the person sent papers to lately come first,
 * then theirs, then every public one. Owners and editors publish the paper or send it to the review queue; on any
 * other community it goes to the queue. The popover stays open after a send, for the next community.
 */
export function CommunityControl({ paper }: { paper: WorkInput }) {
  const t = useTranslations("addedPapers");
  const { isSignedIn } = useAuth();
  const { openSignIn } = useClerk();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [openedWith, setOpenedWith] = useState<string[] | null>(null);
  const search = useDebouncedValue(query.trim(), 300);
  // Sent by its OpenAlex work, or by its DOI when it has no work, such as a paper only Openscholar's index has.
  const openalexId = openalexWork(paper.id);
  const doi = normalDoi(paper.doi);
  // Read once the pointer reaches the button or it takes focus, so the list is there by the click. Only that card
  // reads: each paginated read is a subscription of its own, and every card reading would ask the server for the
  // same lists once per paper on the page. Scrolling near the end reads the next page onto it.
  const [prepared, setPrepared] = useState(false);
  const reads = Boolean(isSignedIn) && prepared;
  const yours = useHeld(useProtectedPaginatedQuery(api.evidenceLibraries.queries.listLibraries, reads ? (search ? { search } : {}) : "skip", { initialNumItems: STEP }));
  const listed = useHeld(useProtectedPaginatedQuery(api.evidenceLibraries.directory.directory, reads ? { sort: "name", ...(search ? { search } : {}) } : "skip", { initialNumItems: STEP }));
  const recentRead = useProtectedQuery(api.evidenceLibraries.submissions.recentCommunities, reads ? {} : "skip").data;
  const sent = useProtectedQuery(api.evidenceLibraries.submissions.sentTo, reads && openalexId ? { openalexId } : "skip").data;
  const statusIn = new Map((sent ?? []).map((row) => [row.libraryId as string, row.status]));
  const button = (
    <Button
      variant="outline"
      size="sm"
      aria-label={t("addToCommunity")}
      className="bg-transparent px-2 has-[>svg]:px-2"
      onClick={isSignedIn ? undefined : () => openSignIn()}
      onPointerEnter={() => setPrepared(true)}
      onFocus={() => setPrepared(true)}
    >
      <EvidenceLibrariesIcon className={statusIn.size ? "text-primary" : "text-muted-foreground"} />
    </Button>
  );
  if (!isSignedIn || !(openalexId || doi)) return <TooltipHint label={t("addToCommunity")}>{button}</TooltipHint>;
  const own = useWorkspaces().list?.find((row) => row.kind === "personal")?.workspaceId as Id<"workspaces"> | undefined;
  const mine = yours.items.filter((library) => library.status === "active").map((library) => fromOverview(library, own));
  const mineById = new Map(mine.map((row) => [row.id as string, row]));
  const latest = (recentRead ?? []).map((recent) => fromRecent(recent, mineById.get(recent.libraryId)));
  // Kept as they were when the popover opened: a paper sent from it doesn't move its rows.
  const recent = (openedWith ?? latest.map((row) => row.id)).flatMap((id) => latest.find((row) => row.id === id) ?? []);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setOpenedWith(next ? latest.map((row) => row.id) : null);
        if (!next) setQuery("");
      }}
    >
      <TooltipHint label={t("addToCommunity")}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
      </TooltipHint>
      <PopoverContent align="start" className="relative flex max-h-[min(30rem,var(--radix-popover-content-available-height))] w-80 flex-col overflow-visible p-2">
        <CommunitiesPanel
          paper={{ openalexId, doi, title: paper.title || paper.display_name || "" }}
          query={query}
          onQuery={setQuery}
          searching={search.length > 0}
          recent={search ? [] : recent}
          mine={mine}
          others={listed.items.filter((card) => !mineById.has(card._id)).map(fromCard)}
          statusIn={statusIn}
          loading={yours.loading || listed.loading}
          stale={yours.stale || listed.stale}
          onScroll={(event) => {
            const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
            if (scrollHeight - scrollTop - clientHeight >= LOAD_AHEAD_PX) return;
            // Yours first, then the public ones under them.
            (yours.canLoadMore ? yours : listed).loadMore();
          }}
          // A list too short to scroll, such as one whose drafts were left out, reads on from a button instead.
          onMore={yours.canLoadMore || listed.canLoadMore ? () => (yours.canLoadMore ? yours : listed).loadMore() : undefined}
        />
      </PopoverContent>
    </Popover>
  );
}

function CommunitiesPanel({ paper, query, onQuery, searching, recent, mine, others, statusIn, loading, stale, onScroll, onMore }: {
  paper: { openalexId: string | null; doi: string | null; title: string };
  query: string;
  onQuery: (query: string) => void;
  searching: boolean;
  recent: Row[];
  mine: Row[];
  others: Row[];
  /** Where the paper stands in each community the person sent it to. */
  statusIn: ReadonlyMap<string, Status>;
  loading: boolean;
  /** A new search or more rows are being read: what's shown stays, dimmed. */
  stale: boolean;
  onScroll: (event: UIEvent<HTMLElement>) => void;
  /** Reads more communities, while there are more. */
  onMore?: () => void;
}) {
  const t = useTranslations("addedPapers");
  const tl = useTranslations("libraryList");
  const add = useAction(api.evidenceLibraries.assistant.addPapers);
  const here = useWorkspace();
  const [picked, setPicked] = useState<Row | null>(null);
  const hover = useHoverCard();
  const [sending, setSending] = useState<"publish" | "queue" | null>(null);
  const recentIds = new Set(recent.map((row) => row.id as string));
  const yours = mine.filter((row) => !recentIds.has(row.id));
  const publicOnes = others.filter((row) => !recentIds.has(row.id));

  const send = async (publish: boolean) => {
    const workspaceId = picked?.workspaceId ?? here;
    if (!picked || !workspaceId) return;
    setSending(publish ? "publish" : "queue");
    try {
      const [result] = await add({ libraryId: picked.id, workspaceId, publish, requestId: crypto.randomUUID(), papers: [{ openalexId: paper.openalexId, doi: paper.doi }] });
      if (result?.outcome === "added" || result?.outcome === "queued") toast.success(result.outcome === "added" ? t("publishedTo", { community: picked.name }) : t("queuedTo", { community: picked.name }), { description: paper.title });
      else if (result?.outcome === "existing") toast.info(t("alreadyIn", { community: picked.name }));
      else toast.error(t("addFailed"));
      // The popover stays open, so the paper can go to another community too.
      setPicked(null);
    } catch (error) {
      toast.error(refusalOr(error, t("addFailed")));
    } finally {
      setSending(null);
    }
  };

  const sub = (row: Row): ReactNode =>
    row.role !== "viewer" ? (
      <RoleLabel role={ROLE_KINDS[row.role]} className="min-w-0 shrink">
        <span className="truncate">{tl(row.role)}</span>
      </RoleLabel>
    ) : (
      <span className="flex min-w-0 items-center gap-1.5">
        <Globe className="size-3.5 shrink-0" />
        <span className="truncate">{row.owner.name || row.address.replace(/^https?:\/\//, "")}</span>
      </span>
    );

  const line = (row: Row) => {
    const status = statusIn.get(row.id);
    const selected = picked?.id === row.id;
    const canPublish = publishes(row.role);
    // A paper returned or withdrawn can go again; one waiting or live can't.
    const done = status === "queued" || status === "published";
    return (
      <li key={row.id}>
        <button
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse") return;
            const popover = event.currentTarget.closest("[data-slot=popover-content]")?.getBoundingClientRect();
            if (!popover) return;
            // Level with the row, kept on screen: a card for a low row rises to fit.
            const top = event.currentTarget.getBoundingClientRect().top - popover.top - 8;
            const room = window.innerHeight - popover.top - CARD_REM * 16 - 16;
            hover.show(row.card, Math.max(-popover.top + 8, Math.min(top, room)));
          }}
          type="button"
          aria-pressed={selected}
          disabled={done}
          onClick={() => setPicked(selected ? null : row)}
          className={cn(
            "flex h-12 w-full items-center gap-3 rounded-lg px-2 text-start transition-colors hover:bg-muted disabled:pointer-events-none",
            selected && "bg-primary/10 hover:bg-primary/15",
          )}
        >
          <CommunityIcon community={row} fadeIn />
          <span className="flex min-w-0 flex-1 flex-col">
            {/* No tooltip for a cut-off name: the card beside the popover shows it whole. */}
            <span className="truncate text-sm font-medium">{row.name}</span>
            <span className="flex min-w-0 items-center text-xs text-muted-foreground">{sub(row)}</span>
          </span>
          {status === "queued" ? (
            <StatusChip tone="running" icon={ReviewQueueIcon}>{t("inQueueShort")}</StatusChip>
          ) : status === "returned" ? (
            <StatusChip tone="warning" icon={Undo2}>{t("returned")}</StatusChip>
          ) : status === "published" ? (
            <StatusChip tone="success" icon={CheckCircle2}>{t("added")}</StatusChip>
          ) : null}
        </button>
        {/* The choice opens under the community picked, where the pointer already is. */}
        {selected ? (
          // Brought into view when it opens under a row at the foot of the list.
          <div ref={(element) => element?.scrollIntoView({ block: "nearest" })} className="fade-enter space-y-2 px-2 pb-2 pt-1.5">
            <p className="text-xs text-muted-foreground">{canPublish ? t("publishOrReview") : t("reviewFirst")}</p>
            <PublishChoice size="sm" canPublish={canPublish} sending={sending} onSend={(publish) => void send(publish)} />
          </div>
        ) : null}
      </li>
    );
  };

  const section = (label: string, rows: Row[]) =>
    rows.length ? (
      <>
        <p className="px-2 pb-0.5 pt-2 text-xs font-medium text-muted-foreground">{label}</p>
        <ul className="space-y-0.5">{rows.map(line)}</ul>
      </>
    ) : null;

  return (
    <>
      {/* Its card to the left of the popover, on a screen wide enough and a pointer that hovers. */}
      <SideCard hover={hover} />
      <p className="px-2 pb-2 pt-1 text-sm font-medium">{t("addToCommunity")}</p>
      <div className="relative mb-1">
        <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("searchCommunities")} aria-label={t("searchCommunities")} className="h-8 ps-8 text-sm" />
      </div>
      {/* One list, read further as it scrolls, as the collections popover beside it is. */}
      <AutoHeight className="min-h-0">
        {loading ? (
          <div className="flex h-24 items-center justify-center"><Spinner /></div>
        ) : recent.length + yours.length + publicOnes.length === 0 && !onMore ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{searching ? t("noCommunitiesMatch") : t("noCommunities")}</p>
        ) : (
          <div className={cn("fade-enter max-h-[20rem] space-y-1 overflow-y-auto", stale && "opacity-60")} inert={stale || undefined} onScroll={onScroll} onPointerLeave={hover.hide}>
            {section(t("recent"), recent)}
            {section(t("yourCommunities"), yours)}
            {section(t("tabPublic"), publicOnes)}
            {/* The list also reads on as it scrolls; this row reaches the rest when the shown ones don't fill it. */}
            {onMore ? (
              <Button type="button" variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onMore}>
                {t("moreCommunities")}
              </Button>
            ) : null}
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
  const waiting = list.status === "LoadingFirstPage" || list.status === "Deferred";
  // Its rows as they are now: a community that changed, such as one that went live, is taken in too.
  const ids = waiting ? undefined : JSON.stringify(list.results);
  if (ids !== undefined && ids !== held?.ids) setHeld({ ids, items: list.results });
  return {
    items: held?.items ?? [],
    loading: held === undefined,
    stale: held !== undefined && waiting,
    canLoadMore: list.status === "CanLoadMore",
    loadMore: () => {
      if (list.status === "CanLoadMore") list.loadMore(STEP);
    },
  };
}

/** How long the pointer rests on a row before its card shows, and how long the card stays once it leaves the list. */
const SHOW_MS = 250;
const HIDE_MS = 80;
const SWITCH_MS = 120;

/**
 * The card beside the popover: shown a moment after the pointer rests on a row, switched to the next row's card a
 * moment after it rests there while it's open, and gone a moment after the pointer leaves the list.
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
    show: (card: Card, top: number) => later({ card, top }, shown ? SWITCH_MS : SHOW_MS),
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
