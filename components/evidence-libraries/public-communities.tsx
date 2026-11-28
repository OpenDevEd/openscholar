"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { SearchX } from "@/components/icons";
import { THEME_DEFAULTS } from "@/lib/evidence-libraries/configuration/rules";
import { WorkspaceTile, type WorkspaceLook } from "@/components/workspaces/parts";
import { CountryFlag } from "@/components/ui/country-flag";
import { TooltipHint } from "@/components/ui/tooltip";
import { AutoHeight } from "@/components/ui/auto-height";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { PUBLIC_PER_PAGE } from "@/lib/evidence-libraries/directory";
import type { Preloaded } from "convex/react";
import { preloadedQueryResult } from "convex/nextjs";
import { cn } from "@/lib/utils";
import { LIST_FILTER, ListEmpty, ListLoading, STALE_ROWS } from "./list-controls";
import { FadeImage } from "@/components/ui/fade-image";
import { ApplyCorner } from "./applications/apply-corner";
import { fromCard, type Standing } from "./applications/apply-dialog";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useWorkspace } from "@/lib/workspaces/url";

const PER_PAGE = PUBLIC_PER_PAGE;
/** Two rows of cards and the pager under them (its top padding and buttons, and its margin): the place held while the first are read. */
const FULL_PAGE_WITH_PAGER = "min-h-[calc(6*var(--card-h)+5rem+4.5rem)] @xl/public:min-h-[calc(3*var(--card-h)+2rem+4.5rem)] @4xl/public:min-h-[calc(2*var(--card-h)+1rem+4.5rem)]";
const SORTS = ["newest", "name", "records"] as const;
type Sort = (typeof SORTS)[number];
type Card = FunctionReturnType<typeof api.evidenceLibraries.directory.directory>["page"][number];

/** Every public community, as cards, a page at a time, sorted and searched on the server (#1090), for anyone, signed in or not. */
export function PublicCommunities({ search, preloaded, heading, signedIn = false, preloadedStanding }: {
  search: string;
  preloaded?: Preloaded<typeof api.evidenceLibraries.directory.directory>;
  /** Signed in, each card's corner says where the person stands with it: Apply, Applied, or nothing for one they're in. */
  signedIn?: boolean;
  /** Where the person stands with the cards of the server's first page, read with the page. */
  preloadedStanding?: Preloaded<typeof api.evidenceLibraries.applications.standing>;
  /** In place of the title, such as the tabs that switch to Your submissions. The title stays for screen readers. */
  heading?: ReactNode;
}) {
  const t = useTranslations("libraryList.directory");
  const [sort, setSort] = useState<Sort>("newest");
  const live = useCursorPageAt("page", api.evidenceLibraries.directory.directory, { sort, ...(search ? { search } : {}) }, PER_PAGE, { open: true });
  // The server's first page, newest first, until the live one arrives: the cards are there from the first frame.
  const first = preloaded && live.isLoading && live.page === 1 && sort === "newest" && !search ? preloadedQueryResult(preloaded) : undefined;
  const read = first ? { ...live, items: first.page, isLoading: false, hasPages: !first.isDone } : live;
  // Where the person stands with each card shown, read for the page of cards; the first page's comes with the page.
  const workspaceId = useWorkspace();
  const ids = read.items.map((community) => community._id);
  const standingLive = useProtectedQuery(api.evidenceLibraries.applications.standing, signedIn && workspaceId && ids.length ? { workspaceId, libraryIds: ids } : "skip").data;
  const standingRead = standingLive ?? (preloadedStanding ? preloadedQueryResult(preloadedStanding) : undefined);
  const standing = new Map((standingRead?.page ?? []).map((row) => [row.libraryId as string, row]));
  return (
    <section aria-labelledby="public-communities" className="@container/public flex min-w-0 flex-col p-4 sm:p-5" style={{ "--card-h": "17.25rem" } as React.CSSProperties}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="public-communities" className={heading ? "sr-only" : "text-base font-semibold"}>{t("title")}</h2>
        {heading}
        <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
          <SelectTrigger size="sm" aria-label={t("sortLabel")} className={cn("w-36", LIST_FILTER)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SORTS.map((key) => <SelectItem key={key} value={key}>{t(`sort.${key}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {/* What a community is, for someone who has never met one. */}
      <p className="-mt-2 mb-4 max-w-prose text-sm text-muted-foreground">{t("intro")}</p>
      {/* The cards arrive after the page: the grid slides to their height instead of moving what's below in one frame. */}
      <AutoHeight>
        {/* Until the cards are read, two rows of them and a pager hold their place; more slide the page longer below the window. */}
        {read.isLoading ? <div className={cn("grid place-items-center", FULL_PAGE_WITH_PAGER)}><ListLoading label={t("loading")} /></div> : read.items.length ? (
          // A full page's height while there are pages, so a short last page keeps the pager where it was.
          // Another sort, search or page is a new list: its cards fade in, in place of each card's text changing where it stood.
          <ul
            key={read.items.map((community) => community._id).join(",")}
            // One column of the panel's width on a phone: an implicit column would be as wide as a card's whole name.
            className={cn("grid grid-cols-1 content-start gap-4 @xl/public:grid-cols-2 @4xl/public:grid-cols-3", read.isStale && STALE_ROWS)}
            inert={read.isStale || undefined}
          >
            {read.items.map((community) => <CommunityCard key={community._id} community={community} signedIn={signedIn} standing={standing.get(community._id)} />)}
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
export function CommunityCard({ community, signedIn = false, standing }: { community: Card; signedIn?: boolean; standing?: Standing }) {
  const t = useTranslations("libraryList.directory");
  const format = useFormatter();
  const locale = useLocale();
  // The countries' names in the page's language, for the flags' accessible name.
  const regions = useMemo(() => { try { return new Intl.DisplayNames([locale], { type: "region" }); } catch { return null; } }, [locale]);
  // A backend from before these were kept sends neither, for the minute a deploy takes to reach it.
  const countries = community.countries ?? [];
  const people = community.people ?? null;
  const published = community.publishedAt ?? null;
  // Its theme's accent, as its site shows it; one that set none has the theme every community starts with. With no icon it shows Openscholar's, as its site does.
  const accent = community.accentColor ?? THEME_DEFAULTS.colors.accent;
  const icon = community.faviconUrl ?? "/icon.svg";
  const named = countries.map((code) => regionName(regions, code));
  return (
    // One height for every card, so a new sort changes what each holds without moving the rows.
    <li className="fade-enter h-(--card-h)">
      {/* The name's link covers the card, under its Apply button. */}
      <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-background transition-[border-color,translate] duration-200 hover:-translate-y-0.5 hover:border-border has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0">
        <ApplyCorner community={fromCard(community)} standing={standing} signedIn={signedIn} />
        {/* Its own icon blurred across its theme's accent; without one, the accent alone. */}
        <div aria-hidden className="relative h-20 shrink-0 overflow-hidden" style={{ background: community.faviconUrl ? accent : `linear-gradient(135deg, ${accent}, color-mix(in oklab, ${accent} 55%, var(--background)))` }}>
          {community.faviconUrl ? <FadeImage src={icon} className="absolute -inset-4 size-[calc(100%+2rem)] object-cover blur-xl saturate-150" shown="opacity-90" /> : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          {/* The icon's tile holds its place, and the icon fades into it. */}
          <span className="relative -mt-7 mb-2 block size-14 overflow-hidden rounded-xl bg-background ring-4 ring-background">
            {/* One that won't load gives way to Openscholar's, as a community with no icon shows. */}
            <FadeImage src={icon} fallback="/icon.svg" className="size-full object-cover" />
          </span>
          <TooltipHint label={community.name} onlyWhenClipped>
            <h3 className="truncate text-sm font-semibold group-hover:underline">
              <a href={community.address} target="_blank" rel="noopener noreferrer" className="outline-none after:absolute after:inset-0">{community.name}</a>
            </h3>
          </TooltipHint>
          {/* Its tagline, or its description; one with neither says so, quieter, so the space reads as empty on purpose. */}
          {community.tagline ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{community.tagline}</p> : <p className="mt-1 text-xs leading-relaxed text-subtle-foreground">{t("noDescription")}</p>}
          {/* What it holds as a strip of figures over their labels, then who runs it and when it last changed. */}
          <div className="mt-auto pt-3">
            <dl className="grid grid-cols-3 gap-3 border-t border-border-subtle pt-3">
              <Stat label={t("recordsLabel", { count: community.records ?? 0 })}>{community.records !== null ? format.number(community.records) : <NotCounted />}</Stat>
              <Stat label={t("peopleLabel", { count: people ?? 0 })}>{people !== null ? format.number(people) : <NotCounted />}</Stat>
              {/* Its countries when its records name any: the flags, and the one it's most about with how many more. */}
              {countries.length ? (
                <Stat byBrowser label={`${named[0]}${named.length > 1 ? ` +${named.length - 1}` : ""}`}>
                  <span className="flex items-center gap-1">
                    {/* Browsers name a few places their own way ("China mainland"): the page keeps the server's name for them. */}
                    <span suppressHydrationWarning className="sr-only">{t("countries", { names: named.join(", ") })}</span>
                    {countries.slice(0, 3).map((code) => <CountryFlag key={code} countryCode={code} />)}
                  </span>
                </Stat>
              ) : null}
            </dl>
            <div className="mt-3 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {/* The owner as the switcher draws a workspace: its logo, or the mark made for it in its colour; a person's photo. */}
              <WorkspaceTile workspace={ownerLook(community.owner)} size="xxs" />
              <span className="min-w-0 truncate">{community.owner.name ?? t("unnamedOwner")}</span>
              {published !== null ? <span className="ms-auto shrink-0 text-subtle-foreground">{t("updated", { when: format.relativeTime(published) })}</span> : null}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/** A country's name in the page's language, or its code: a code the browser doesn't know as a region (a three-letter one) makes it throw. */
function regionName(regions: Intl.DisplayNames | null, code: string) {
  try {
    return regions?.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** A figure not counted yet: a dash, and the words for a screen reader. */
function NotCounted() {
  const t = useTranslations("libraryList.directory");
  return <><span aria-hidden className="text-subtle-foreground">–</span><span className="sr-only">{t("notCounted")}</span></>;
}

/** One figure of a card's strip over its label. */
/** `byBrowser`: a label the browser words (a country's name), which may differ from the server's, whose wording the page keeps. */
function Stat({ label, byBrowser = false, children }: { label: string; byBrowser?: boolean; children: ReactNode }) {
  return (
    // The label comes first, as a list of terms reads; the figure shows above it.
    <div className="flex min-w-0 flex-col-reverse">
      <dt suppressHydrationWarning={byBrowser} className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className="flex h-5 items-center text-sm font-semibold tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

/** A card's owner as the switcher's tile takes a workspace. */
function ownerLook(owner: Card["owner"]): WorkspaceLook {
  return {
    kind: owner.kind === "organization" ? "organization" : "personal",
    name: owner.name ?? "",
    workspaceId: owner.workspaceId,
    ...(owner.imageUrl ? { imageUrl: owner.imageUrl } : {}),
    ...(owner.colour ? { colour: owner.colour } : {}),
  };
}
