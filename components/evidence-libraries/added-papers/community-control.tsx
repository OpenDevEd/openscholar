"use client";

import { useState, type ReactNode, type UIEvent } from "react";
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
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import { normalDoi } from "@/lib/papers/paper-ref";
import type { WorkInput } from "@/lib/library/trim-paper-data";
import { communityPapers, useAddedPapers, type AddedState, type FoundPaper } from "@/lib/evidence-libraries/added-papers-mock";
import { CommunityIcon, fromOverview, ROLE_KINDS, type Community } from "../your-communities";
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
  const [size, setSize] = useState(STEP);
  const byCommunity = useAddedPapers((state) => state.byCommunity);
  const found = foundOf(paper);
  const search = useDebouncedValue(query.trim(), 300);
  // Read with the button, not the popover, so the list is there when it opens. Every card asks the same, which
  // Convex answers once.
  const yours = useCursorPage(api.evidenceLibraries.queries.listLibraries, isSignedIn ? (search ? { search } : {}) : "skip", size);
  const listed = useCursorPage(api.evidenceLibraries.directory.directory, { sort: "name", ...(search ? { search } : {}) }, size, { open: true });
  // ponytail: the mock reads your first 100 communities to tell yours from the public ones and to know your role on a
  // recent one; the real directory row carries your role, for any number.
  const all = useCursorPage(api.evidenceLibraries.queries.listLibraries, isSignedIn ? {} : "skip", 100);
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
    >
      <EvidenceLibrariesIcon className={isIn ? "text-primary" : "text-muted-foreground"} />
    </Button>
  );
  if (!isSignedIn) return <TooltipHint label="Add to community">{button}</TooltipHint>;
  const roles = new Map(all.items.map((library) => [library._id as string, library.role]));
  // The communities you sent papers to lately, each once, most recent first.
  const recent = submissions
    .map(({ community }) => community)
    .filter((community, index, list) => list.findIndex((other) => other.id === community.id) === index)
    .slice(0, RECENT)
    .map((community): Community => ({ ...community, role: roles.get(community.id) ?? "viewer" }));
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setSize(STEP);
        }
      }}
    >
      <TooltipHint label="Add to community">
        <PopoverTrigger asChild>{button}</PopoverTrigger>
      </TooltipHint>
      <PopoverContent align="start" className="flex max-h-[min(30rem,var(--radix-popover-content-available-height))] w-80 flex-col p-2">
        <CommunitiesPanel
          paper={found}
          query={query}
          onQuery={(next) => {
            setQuery(next);
            setSize(STEP);
          }}
          searching={search.length > 0}
          recent={search ? [] : recent}
          mine={yours.items.map(fromOverview).filter((community) => !community.draft)}
          others={listed.items.filter((card) => !roles.has(card._id)).map(fromCard)}
          loading={yours.isLoading || listed.isLoading}
          // Dimmed for a new search; reading further down leaves what is shown as it is.
          stale={(yours.isStale || listed.isStale) && size === STEP}
          onScroll={(event) => {
            const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
            if (scrollHeight - scrollTop - clientHeight >= LOAD_AHEAD_PX) return;
            if ((yours.hasPages || listed.hasPages) && !yours.isStale && !listed.isStale) setSize(size + STEP);
          }}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function CommunitiesPanel({ paper, query, onQuery, searching, recent, mine, others, loading, stale, onScroll, onDone }: {
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
  onScroll: (event: UIEvent<HTMLElement>) => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<Community | null>(null);
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
      setSending(null);
      setPicked(null);
      onDone();
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
            <TooltipHint label={community.name} onlyWhenClipped>
              <span className="truncate text-sm font-medium">{community.name}</span>
            </TooltipHint>
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
          <div className="fade-enter space-y-2 px-2 pb-2 pt-1.5">
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
          <div className={cn("fade-enter max-h-[20rem] space-y-1 overflow-y-auto", stale && "opacity-60")} inert={stale || undefined} onScroll={onScroll}>
            {section("Recent", recent)}
            {section("Your communities", yours)}
            {section("Public communities", publicOnes)}
          </div>
        )}
      </AutoHeight>
    </>
  );
}
