"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { FileText, SearchX } from "@/components/icons";
import { AutoHeight } from "@/components/ui/auto-height";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { cn } from "@/lib/utils";
import { LIST_FILTER, ListEmpty, ListLoading } from "./list-controls";

const PER_PAGE = 6;
const SORTS = ["newest", "name", "records"] as const;
type Sort = (typeof SORTS)[number];
type Card = FunctionReturnType<typeof api.evidenceLibraries.directory.listPublic>["page"][number];

/** Every public community, as cards, a page at a time, sorted and searched on the server (#1090). */
export function PublicCommunities({ search, workspaceId }: { search: string; workspaceId?: Id<"workspaces"> }) {
  const t = useTranslations("libraryList.directory");
  const [sort, setSort] = useState<Sort>("newest");
  const read = useCursorPage(api.evidenceLibraries.directory.listPublic, workspaceId ? { workspaceId, sort, ...(search ? { search } : {}) } : "skip", PER_PAGE);
  return (
    <section aria-labelledby="public-communities" className="@container/public flex min-w-0 flex-col p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="public-communities" className="text-base font-semibold">{t("title")}</h2>
        <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
          <SelectTrigger size="sm" aria-label={t("sortLabel")} className={cn("w-36", LIST_FILTER)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SORTS.map((key) => <SelectItem key={key} value={key}>{t(`sort.${key}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {/* The cards arrive after the page: the grid slides to their height instead of moving what's below in one frame. */}
      <AutoHeight>
        {read.isLoading ? <ListLoading label={t("loading")} /> : read.items.length ? (
          // A full page's height while there are pages, so a short last page keeps the pager where it was.
          <ul
            className={cn("grid content-start gap-4 @xl/public:grid-cols-2 @4xl/public:grid-cols-3", read.hasPages && "min-h-[calc(6*var(--card-h)+5rem)] @xl/public:min-h-[calc(3*var(--card-h)+2rem)] @4xl/public:min-h-[calc(2*var(--card-h)+1rem)]", read.isStale && "opacity-60")}
            inert={read.isStale || undefined}
            style={{ "--card-h": "16.5rem" } as React.CSSProperties}
          >
            {read.items.map((community) => <CommunityCard key={community._id} community={community} />)}
          </ul>
        ) : (
          <ListEmpty icon={SearchX}>{search ? t("noMatches") : t("none")}</ListEmpty>
        )}
        {read.hasPages && (
          <CommandCenterPagination
            className="mt-4"
            currentPage={read.page}
            itemLabel="communities"
            steps={{ canPrevious: read.canPrevious, canNext: read.canNext, onPrevious: read.previous, onNext: read.next, offset: read.offset, shown: read.items.length }}
          />
        )}
      </AutoHeight>
    </section>
  );
}

/** One public community: its colour with its icon blurred across it, the icon itself, then what it holds. Opens its public site. */
function CommunityCard({ community }: { community: Card }) {
  const t = useTranslations("libraryList.directory");
  const format = useFormatter();
  // A community with no colour or icon of its own shows Openscholar's, as its site does.
  const accent = community.accentColor ?? "var(--primary)";
  const icon = community.faviconUrl ?? "/icon.svg";
  return (
    <li className="h-(--card-h)">
      <a
        href={community.address}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex h-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-background outline-offset-2 transition-[border-color,translate] duration-200 hover:-translate-y-0.5 hover:border-border focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <div aria-hidden className="relative h-20 shrink-0 overflow-hidden" style={{ backgroundColor: accent }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- owner-hosted image, any domain */}
          <img src={icon} alt="" className="absolute -inset-4 size-[calc(100%+2rem)] object-cover opacity-90 blur-xl saturate-150" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- owner-hosted image, any domain */}
          <img src={icon} alt="" className="relative -mt-7 mb-2 size-14 rounded-xl bg-background object-cover ring-4 ring-background" />
          <h3 className="truncate text-sm font-semibold group-hover:underline">{community.name}</h3>
          {community.tagline ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{community.tagline}</p> : null}
          <div className="mt-auto flex flex-col gap-1.5 pt-3 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <IdentityAvatar name={community.owner.name ?? ""} imageUrl={community.owner.imageUrl} kind={community.owner.kind} className={community.owner.kind === "organization" ? "size-4 rounded-sm" : "size-4"} />
              <span className="truncate">{community.owner.name ?? t("unnamedOwner")}</span>
            </span>
            {community.records !== null ? (
              <span className="flex items-center gap-1 tabular-nums">
                <FileText className="size-3.5" />
                {t("records", { count: community.records, shown: format.number(community.records) })}
              </span>
            ) : null}
          </div>
        </div>
      </a>
    </li>
  );
}
