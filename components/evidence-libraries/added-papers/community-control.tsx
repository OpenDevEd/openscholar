"use client";

import { useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { EvidenceLibrariesIcon, Globe, ReviewQueueIcon, Search, CheckCircle2 } from "@/components/icons";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RoleLabel } from "@/components/ui/identity";
import { TooltipHint } from "@/components/ui/tooltip";
import { PageStepper } from "@/components/shared/page-stepper";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { cn } from "@/lib/utils";
import { normalDoi } from "@/lib/papers/paper-ref";
import type { WorkInput } from "@/lib/library/trim-paper-data";
import { communityPapers, useAddedPapers, type AddedState, type FoundPaper } from "@/lib/evidence-libraries/added-papers-mock";
import { CommunityIcon, fromOverview, ROLE_KINDS, type Community } from "../your-communities";
import { StatusChip } from "../configuration/status-chip";
import { PublishChoice, publishes } from "./publish-choice";

/** Communities each list shows at a time. */
const PER_PAGE = 5;
/** A row's height, which every row keeps, so a short page doesn't move what's below. */
const ROW = "h-12";

type Card = FunctionReturnType<typeof api.evidenceLibraries.directory.directory>["page"][number];
type Chosen = Community & { canPublish: boolean };

const fromCard = (card: Card): Community => ({
  id: card._id,
  name: card.name,
  role: "viewer",
  faviconUrl: card.faviconUrl,
  address: card.address.replace(/^https?:\/\//, ""),
  owner: { name: card.owner.name ?? "", imageUrl: card.owner.imageUrl, kind: card.owner.kind, workspaceId: card.owner.workspaceId },
});

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

const ROLE_WORD = { owner: "Owner", editor: "Editor", creator: "Creator", viewer: "Viewer" } as const;

/**
 * Add to community, beside Save and the collections folder: puts the paper on a community of yours or a public
 * one. Owners and editors publish it or send it to the review queue; everyone else sends it to the queue.
 */
export function CommunityControl({ paper }: { paper: WorkInput }) {
  const { isSignedIn } = useAuth();
  const { openSignIn } = useClerk();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const byCommunity = useAddedPapers((state) => state.byCommunity);
  const found = foundOf(paper);
  // Read with the button, not the popover, so the lists are there when it opens. Every card asks the same, which
  // Convex answers once.
  const search = query.trim();
  const yours = useCursorPage(api.evidenceLibraries.queries.listLibraries, isSignedIn ? (search ? { search } : {}) : "skip", PER_PAGE);
  const listed = useCursorPage(api.evidenceLibraries.directory.directory, { sort: "name", ...(search ? { search } : {}) }, PER_PAGE, { open: true });
  // ponytail: the mock reads your first 100 communities to tell yours from the public list; the real directory row
  // carries your role on it, for any number.
  const all = useCursorPage(api.evidenceLibraries.queries.listLibraries, isSignedIn ? {} : "skip", 100);
  const roles = new Set<string>(all.items.map((library) => library._id));
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
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <TooltipHint label="Add to community">
        <PopoverTrigger asChild>{button}</PopoverTrigger>
      </TooltipHint>
      <PopoverContent align="start" className="flex max-h-[min(30rem,var(--radix-popover-content-available-height))] w-80 flex-col p-2">
        <CommunitiesPanel paper={found} query={query} onQuery={setQuery} yours={yours} listed={listed} roles={roles} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

type Mine = ReturnType<typeof useCursorPage<typeof api.evidenceLibraries.queries.listLibraries>>;
type Listed = ReturnType<typeof useCursorPage<typeof api.evidenceLibraries.directory.directory>>;

function CommunitiesPanel({ paper, query, onQuery, yours, listed, roles, onDone }: {
  paper: FoundPaper;
  /** Every community you have a role on, by ID, so a public one of yours is never offered as a stranger's. */
  roles: ReadonlySet<string>;
  query: string;
  onQuery: (query: string) => void;
  yours: Mine;
  listed: Listed;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<Chosen | null>(null);
  const [sending, setSending] = useState<"publish" | "queue" | null>(null);
  const byCommunity = useAddedPapers((state) => state.byCommunity);
  const add = useAddedPapers((state) => state.add);
  const search = query.trim();
  const mine = yours.items.map(fromOverview).filter((community) => !community.draft);
  const others = listed.items.filter((card) => !roles.has(card._id)).map(fromCard);
  const stateIn = (communityId: string): AddedState | undefined =>
    byCommunity[communityId] ? communityPapers(byCommunity, communityId).find((row) => row.key === paper.key)?.state : undefined;

  const send = (publish: boolean) => {
    if (!picked) return;
    setSending(publish ? "publish" : "queue");
    // MOCK: the real call goes to new-el, as every other way of adding a paper does.
    window.setTimeout(() => {
      add(picked.id, [paper], publish);
      toast.success(publish ? `Published to ${picked.name}` : `Sent to ${picked.name}'s review queue`, { description: paper.title });
      setSending(null);
      setPicked(null);
      onDone();
    }, 600);
  };

  const row = (community: Community, canPublish: boolean, sub: React.ReactNode) => {
    const state = stateIn(community.id);
    const selected = picked?.id === community.id;
    return (
      <li key={community.id}>
        <button
          type="button"
          aria-pressed={selected}
          disabled={state !== undefined}
          onClick={() => setPicked(selected ? null : { ...community, canPublish })}
          className={cn(
            ROW,
            "flex w-full items-center gap-3 rounded-lg px-2 text-start transition-colors hover:bg-muted disabled:pointer-events-none",
            selected && "bg-primary/10 hover:bg-primary/15",
          )}
        >
          <CommunityIcon community={community} fadeIn />
          <span className="flex min-w-0 flex-1 flex-col">
            <TooltipHint label={community.name} onlyWhenClipped>
              <span className="truncate text-sm font-medium">{community.name}</span>
            </TooltipHint>
            <span className="flex min-w-0 items-center text-xs text-muted-foreground">{sub}</span>
          </span>
          {state === "queued" ? (
            <StatusChip tone="running" icon={ReviewQueueIcon}>In queue</StatusChip>
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

  return (
    <>
      <div className="flex items-center gap-2 px-2 pt-1 pb-2">
        <p className="flex-1 text-sm font-medium">Add to community</p>
      </div>
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
      <AutoHeight className="min-h-0 overflow-y-auto">
        <div className="space-y-1">
          {yours.items.length || yours.hasPages ? (
            <>
              <p className="fade-enter px-2 pb-0.5 pt-2 text-xs font-medium text-muted-foreground">Yours</p>
              <ul className={cn("fade-enter space-y-0.5", yours.isStale && "opacity-60")} inert={yours.isStale || undefined}>
                {mine.map((community) =>
                  row(
                    community,
                    publishes(community.role),
                    <RoleLabel role={ROLE_KINDS[community.role]} className="min-w-0 shrink">
                      <span className="truncate">{ROLE_WORD[community.role]}</span>
                    </RoleLabel>,
                  ),
                )}
              </ul>
              {yours.hasPages ? (
                <PageStepper className="px-1" page={yours.page} canPrevious={yours.canPrevious} canNext={yours.canNext} onPrevious={yours.previous} onNext={yours.next} />
              ) : null}
            </>
          ) : null}
          {listed.items.length || listed.hasPages ? (
            <>
              <p className="fade-enter px-2 pb-0.5 pt-2 text-xs font-medium text-muted-foreground">Public</p>
              <ul className={cn("fade-enter space-y-0.5", listed.isStale && "opacity-60")} inert={listed.isStale || undefined}>
                {others.map((community) =>
                  row(
                    community,
                    false,
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Globe className="size-3.5 shrink-0" />
                      <span className="truncate">{community.owner.name || community.address}</span>
                    </span>,
                  ),
                )}
              </ul>
              {listed.hasPages ? (
                <PageStepper className="px-1" page={listed.page} canPrevious={listed.canPrevious} canNext={listed.canNext} onPrevious={listed.previous} onNext={listed.next} />
              ) : null}
            </>
          ) : null}
          {yours.isLoading || listed.isLoading ? (
            <div className="flex h-24 items-center justify-center"><Spinner /></div>
          ) : !mine.length && !others.length ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{search ? "No communities match" : "No communities yet"}</p>
          ) : null}
        </div>
      </AutoHeight>
    </>
  );
}
