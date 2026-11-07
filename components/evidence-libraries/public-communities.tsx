"use client";

import { useMemo, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { FileText, SearchX, Users } from "@/components/icons";
import { CountryFlag } from "@/components/ui/country-flag";
import { AutoHeight } from "@/components/ui/auto-height";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { cn } from "@/lib/utils";
import { LIST_FILTER, ListEmpty, ListLoading } from "./list-controls";

const PER_PAGE = 6;
/** A full page of cards, one, two or three to a row by the section's width; and with its pager under it (its top padding and buttons, and its margin). */
const FULL_PAGE = "min-h-[calc(6*var(--card-h)+5rem)] @xl/public:min-h-[calc(3*var(--card-h)+2rem)] @4xl/public:min-h-[calc(2*var(--card-h)+1rem)]";
const FULL_PAGE_WITH_PAGER = "min-h-[calc(6*var(--card-h)+5rem+4.5rem)] @xl/public:min-h-[calc(3*var(--card-h)+2rem+4.5rem)] @4xl/public:min-h-[calc(2*var(--card-h)+1rem+4.5rem)]";
const SORTS = ["newest", "name", "records"] as const;
type Sort = (typeof SORTS)[number];
type Card = FunctionReturnType<typeof api.evidenceLibraries.directory.listPublic>["page"][number];

/** Every public community, as cards, a page at a time, sorted and searched on the server (#1090). */
export function PublicCommunities({ search, workspaceId }: { search: string; workspaceId?: Id<"workspaces"> }) {
  const t = useTranslations("libraryList.directory");
  const [sort, setSort] = useState<Sort>("newest");
  const read = useCursorPage(api.evidenceLibraries.directory.listPublic, workspaceId ? { workspaceId, sort, ...(search ? { search } : {}) } : "skip", PER_PAGE);
  return (
    <section aria-labelledby="public-communities" className="@container/public flex min-w-0 flex-col p-4 sm:p-5" style={{ "--card-h": "16.5rem" } as React.CSSProperties}>
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
        {/* Until the cards are read, a full page of them and its pager hold their place, so arriving cards don't push the page down. */}
        {read.isLoading ? <div className={cn("grid place-items-center", FULL_PAGE_WITH_PAGER)}><ListLoading label={t("loading")} /></div> : read.items.length ? (
          // A full page's height while there are pages, so a short last page keeps the pager where it was.
          <ul
            className={cn("grid content-start gap-4 @xl/public:grid-cols-2 @4xl/public:grid-cols-3", read.hasPages && FULL_PAGE, read.isStale && "opacity-60")}
            inert={read.isStale || undefined}
          >
            {/* By place on the page: another sort or page changes what each card holds, in place of moving cards about. */}
            {read.items.map((community, at) => <CommunityCard key={at} community={community} />)}
          </ul>
        ) : (
          <ListEmpty icon={SearchX}>{search ? t("noMatches") : t("none")}</ListEmpty>
        )}
        {read.hasPages && (
          <CommandCenterPagination
            className="mt-4"
            currentPage={read.page}
            itemLabel="communities"
            // While another sort or search is read, the pager keeps saying there's more, as the page it shows did.
            steps={{ canPrevious: read.canPrevious, canNext: read.canNext || (read.isStale && read.hasPages), onPrevious: read.previous, onNext: read.next, offset: read.offset, shown: read.items.length }}
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
  const locale = useLocale();
  // The countries' names in the page's language, for the flags' accessible name.
  const regions = useMemo(() => { try { return new Intl.DisplayNames([locale], { type: "region" }); } catch { return null; } }, [locale]);
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
          <FadeImage src={icon} className="absolute -inset-4 size-[calc(100%+2rem)] object-cover blur-xl saturate-150" shown="opacity-90" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          {/* The icon's tile holds its place, and the icon fades into it. */}
          <span className="relative -mt-7 mb-2 block size-14 overflow-hidden rounded-xl bg-background ring-4 ring-background">
            <FadeImage src={icon} className="size-full object-cover" />
          </span>
          <h3 className="truncate text-sm font-semibold group-hover:underline">{community.name}</h3>
          {community.tagline ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{community.tagline}</p> : null}
          <div className="mt-auto flex flex-col gap-1.5 pt-3 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <IdentityAvatar name={community.owner.name ?? ""} imageUrl={community.owner.imageUrl} kind={community.owner.kind} className={community.owner.kind === "organization" ? "size-4 rounded-sm" : "size-4"} />
              <span className="truncate">{community.owner.name ?? t("unnamedOwner")}</span>
            </span>
            <span className="flex min-w-0 items-center gap-3">
              {community.records !== null ? (
                <span className="flex shrink-0 items-center gap-1 tabular-nums">
                  <FileText className="size-3.5" />
                  {t("records", { count: community.records, shown: format.number(community.records) })}
                </span>
              ) : null}
              {community.people !== null ? (
                <span className="flex shrink-0 items-center gap-1 tabular-nums">
                  <Users className="size-3.5" />
                  {t("people", { count: community.people, shown: format.number(community.people) })}
                </span>
              ) : null}
              {community.countries.length > 0 ? (
                <span className="ms-auto flex shrink-0 items-center gap-1" role="img" aria-label={t("countries", { names: community.countries.map((code) => regions?.of(code.toUpperCase()) ?? code.toUpperCase()).join(", ") })}>
                  {community.countries.slice(0, 3).map((code) => <CountryFlag key={code} countryCode={code} />)}
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </a>
    </li>
  );
}

/** An owner's picture that fades in once it has loaded, in place of appearing in one frame. */
function FadeImage({ src, className, shown = "opacity-100" }: { src: string; className: string; shown?: string }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- owner-hosted image, any domain
    <img
      ref={(image) => { if (image?.complete && image.naturalWidth > 0) setLoaded(src); }}
      src={src}
      alt=""
      onLoad={() => setLoaded(src)}
      className={cn(className, "transition-opacity duration-200 motion-reduce:transition-none", loaded === src ? shown : "opacity-0")}
    />
  );
}
