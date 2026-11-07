"use client";

import { useState } from "react";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { FileText, SearchX } from "@/components/icons";
import { CountryFlag } from "@/components/ui/country-flag";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LIST_FILTER, ListEmpty } from "./list-controls";
import { PUBLIC_COMMUNITIES, type PublicCommunity } from "./public-communities-mock";

const PER_PAGE = 6;
const SORTS = { newest: "Newest", name: "Name", records: "Most records" } as const;
type Sort = keyof typeof SORTS;

const sorted = (rows: PublicCommunity[], sort: Sort) =>
  [...rows].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "records" ? b.records - a.records : b.liveAt - a.liveAt));

/**
 * MOCK: every public community, as cards, a page at a time. The real list leaves out the ones the
 * person already has in their own column.
 */
export function PublicCommunities({ search }: { search: string }) {
  const [sort, setSort] = useState<Sort>("newest");
  const [page, setPage] = useState(1);
  const needle = search.trim().toLowerCase();
  const rows = sorted(PUBLIC_COMMUNITIES.filter((row) => (!needle || `${row.name} ${row.tagline} ${row.owner.name}`.toLowerCase().includes(needle))), sort);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  // A search that leaves fewer pages keeps the page in range, in place of an empty one.
  const shown = Math.min(page, pages);
  const visible = rows.slice((shown - 1) * PER_PAGE, shown * PER_PAGE);
  return (
    <section aria-labelledby="public-communities" className="@container/public flex min-w-0 flex-col p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="public-communities" className="text-base font-semibold">Public communities</h2>
        <Select value={sort} onValueChange={(value) => { setSort(value as Sort); setPage(1); }}>
          <SelectTrigger size="sm" aria-label="Sort public communities" className={cn("w-36", LIST_FILTER)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {(Object.keys(SORTS) as Sort[]).map((key) => <SelectItem key={key} value={key}>{SORTS[key]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {visible.length ? (
        // Three rows of cards on every page, so a short last page keeps the pager where it was.
        <ul className={cn("grid content-start gap-4 @xl/public:grid-cols-2 @4xl/public:grid-cols-3", pages > 1 && "min-h-[calc(6*var(--card-h)+5rem)] @xl/public:min-h-[calc(3*var(--card-h)+2rem)] @4xl/public:min-h-[calc(2*var(--card-h)+1rem)]")} style={{ "--card-h": "16.5rem" } as React.CSSProperties}>
          {visible.map((community) => <CommunityCard key={community.id} community={community} />)}
        </ul>
      ) : (
        <ListEmpty icon={SearchX}>No public communities match this search</ListEmpty>
      )}
      {pages > 1 && (
        <CommandCenterPagination
          className="mt-auto"
          currentPage={shown}
          totalPages={pages}
          onPageChange={setPage}
          totalItems={rows.length}
          itemsPerPage={PER_PAGE}
          itemLabel="communities"
        />
      )}
    </section>
  );
}

/** One public community: its colour with its icon blurred across it, the icon itself, then what it holds. Opens its public site. */
function CommunityCard({ community }: { community: PublicCommunity }) {
  return (
    <li className="h-(--card-h)">
      <a
        href={`https://${community.address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex h-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-background outline-offset-2 transition-[border-color,translate] duration-200 hover:-translate-y-0.5 hover:border-border focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <div aria-hidden className="relative h-20 shrink-0 overflow-hidden" style={{ backgroundColor: community.accentColor }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- owner-hosted image, any domain */}
          <img src={community.faviconUrl} alt="" className="absolute -inset-4 size-[calc(100%+2rem)] object-cover opacity-90 blur-xl saturate-150" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- owner-hosted image, any domain */}
          <img src={community.faviconUrl} alt="" className="relative -mt-7 mb-2 size-14 rounded-xl bg-background object-cover ring-4 ring-background" />
          <h3 className="truncate text-sm font-semibold group-hover:underline">{community.name}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{community.tagline}</p>
          <div className="mt-auto flex flex-col gap-1.5 pt-3 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <IdentityAvatar name={community.owner.name} kind={community.owner.kind} className={community.owner.kind === "organization" ? "size-4 rounded-sm" : "size-4"} />
              <span className="truncate">{community.owner.name}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="flex shrink-0 items-center gap-1 tabular-nums">
                <FileText className="size-3.5" />
                {community.records.toLocaleString("en")} records
              </span>
              {community.countries.length > 0 && (
                <span className="ms-auto flex shrink-0 items-center gap-1" aria-label={`Focus on ${community.countries.map((code) => code.toUpperCase()).join(", ")}`}>
                  {community.countries.map((code) => <CountryFlag key={code} countryCode={code} />)}
                </span>
              )}
            </span>
          </div>
        </div>
      </a>
    </li>
  );
}
