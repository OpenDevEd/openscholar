"use client";

import Link from "next/link";
import { useContext, type ReactElement, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import { readAuthorCard, type AuthorCard } from "@/app/actions/author-card";
import { readTopic } from "@/app/actions/topics";
import { AuthorAvatar } from "@/components/authors/author-avatar";
import { ArrowUpRight, ChevronRight, Filter, Search, TopicsIcon } from "@/components/icons";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { FadeRow } from "@/components/assistant/parts";
import { useAuthorFilter, useTopicFilter } from "@/components/paper-card/hooks";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/country-flag";
import { FocusModeClose } from "@/components/focus-mode/close-context";
import { useUIStore } from "@/lib/store";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TooltipHint } from "@/components/ui/tooltip";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { unlessLimited } from "@/lib/openalex/limited";
import { catalogNode } from "@/lib/topics/search";
import { topicHref } from "@/lib/topics/links";
import { cn } from "@/lib/utils";

/** Closes the focus mode the card sits in, whichever it is, before the card leaves the page. */
export function useCloseFocus() {
  const closeFocus = useContext(FocusModeClose);
  return closeFocus ?? (() => useUIStore.getState().setIsFocusModeOpen(false));
}

/**
 * A card that opens over a name after a short hover, holding what the name is and what can be
 * done with it. Its clicks stay inside it: React carries a portal's events up to the paper card
 * the name sits in, which would open focus mode.
 */
function EntityHoverCard({ trigger, children }: { trigger: ReactElement; children: ReactNode }) {
  return (
    <HoverCard openDelay={250} closeDelay={80}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="w-88 overflow-hidden p-0"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {children}
      </HoverCardContent>
    </HoverCard>
  );
}

function CardHeader({ icon, name, line }: { icon: ReactNode; name: string; line: ReactNode }) {
  return (
    <div className="flex gap-3 px-4 pt-4">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-medium leading-snug">{name}</p>
        <div className="mt-0.5 flex h-5 min-w-0 items-center gap-1.5 text-xs text-muted-foreground">{line}</div>
      </div>
    </div>
  );
}

/** A count and what it counts. While it loads, a bar holds its place; then it fades in there. */
function Stat({ value, label, loading = false }: { value: number | null | undefined; label: string; loading?: boolean }) {
  const locale = useLocale();
  return (
    <div className="min-w-0">
      <div className="flex h-6 items-center text-base font-semibold tabular-nums">
        {loading ? <SkeletonBar className="h-4 w-14" /> : value != null && <span className="fade-enter">{value.toLocaleString(locale)}</span>}
      </div>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * The card's actions: narrow the page's search by the record (or start one where the page has
 * none), go to its page, and open it on OpenAlex. The page link fills the space between the two
 * when it is known, so nothing moves when it arrives.
 */
function CardActions({ filter, value, name, page, openAlex }: {
  filter: ReturnType<typeof useAuthorFilter>;
  value: string;
  name: string;
  page: { href: string; label: string } | null;
  openAlex: string;
}) {
  const t = useTranslations("entityCards");
  const pressed = filter.selected.includes(value);
  const closeFocus = useCloseFocus();
  return (
    <div className="mt-4 flex items-center gap-2 bg-inset/60 px-3 py-2.5">
      <Button size="sm" variant={pressed ? "outline" : "default"} className="min-w-0" aria-pressed={pressed} onClick={() => {
        if (!filter.canFilter) closeFocus();
        filter.toggle({ value, name });
      }}>
        {filter.canFilter ? <Filter aria-hidden /> : <Search aria-hidden />}
        <span className="truncate">{filter.canFilter ? (pressed ? t("removeFilter") : t("filterResults")) : t("searchPapers")}</span>
      </Button>
      {page && (
        <Button size="sm" variant="ghost" className="fade-enter min-w-0" asChild>
          <Link href={page.href} onNavigate={closeFocus}><span className="truncate">{page.label}</span><ArrowUpRight aria-hidden /></Link>
        </Button>
      )}
      <TooltipHint label={t("openOnOpenAlex")}>
        <Button size="icon-sm" variant="ghost" className="ml-auto shrink-0" asChild>
          <a href={openAlex} target="_blank" rel="noreferrer" aria-label={t("openOnOpenAlex")}><OpenAlexIcon className="size-4" /></a>
        </Button>
      </TooltipHint>
    </div>
  );
}

/**
 * An author's top topics, each a link to its page with the number of their papers it holds, on a
 * bar scaled to the first. Three rows' space is kept whether they are loading or there are fewer.
 */
function TopTopics({ topics, onNavigate }: { topics: AuthorCard["topics"] | undefined; onNavigate: () => void }) {
  const t = useTranslations("entityCards");
  const locale = useLocale();
  const most = Math.max(1, ...(topics ?? []).map((topic) => topic.papers));
  return (
    <div className="mt-3 -mx-2 space-y-0.5">
      {/* Bars the shape of the rows to come, longest first. */}
      {!topics && ["w-full", "w-3/5", "w-2/5"].map((width) => <SkeletonBar key={width} className={cn("h-7 rounded-md", width)} />)}
      {topics?.map((topic) => (
        <TooltipHint key={topic.id} label={topic.name} onlyWhenClipped>
          <Link
            href={`/topics/${topic.id}`}
            onNavigate={onNavigate}
            aria-label={t("topicPapers", { name: topic.name, count: topic.papers })}
            className="relative flex h-7 items-center gap-3 overflow-hidden rounded-md px-2 text-xs transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span aria-hidden className="absolute inset-y-0 left-0 rounded-md bg-primary/10" style={{ width: `${(topic.papers / most) * 100}%` }} />
            <span className="relative min-w-0 flex-1 truncate">{topic.name}</span>
            <span className="relative tabular-nums text-muted-foreground">{topic.papers.toLocaleString(locale)}</span>
          </Link>
        </TooltipHint>
      ))}
      {topics && !topics.length && <p className="px-2 text-xs text-muted-foreground">{t("noTopics")}</p>}
    </div>
  );
}

function AuthorCardBody({ id, name }: { id: string; name: string }) {
  const t = useTranslations("entityCards");
  const closeFocus = useCloseFocus();
  const filter = useAuthorFilter();
  const card = useSWR(["author-card", id], ([, author]) => unlessLimited(readAuthorCard(author)), { revalidateOnFocus: false });
  const author = card.data;
  return (
    <>
      <CardHeader
        icon={<AuthorAvatar className="size-10" />}
        name={name}
        line={author?.institution ? (
          <>
            {author.institution.country && <CountryFlag countryCode={author.institution.country} className="shrink-0" />}
            <span className="truncate">{author.institution.name}</span>
          </>
        ) : author ? <span>{t("noInstitution")}</span> : <SkeletonBar className="h-3 w-44" />}
      />
      {/* Counts and top topics, at one height whether loading, loaded, empty or failed. */}
      {card.error ? (
        <div role="alert" className="mx-4 mt-3 flex h-[8.75rem] flex-col items-start justify-center gap-2 text-sm text-muted-foreground">
          {t("authorFailed")}
          <Button size="sm" variant="outline" onClick={() => void card.mutate()}>{t("tryAgain")}</Button>
        </div>
      ) : (
        <div className="mt-3 h-[8.75rem] px-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat value={author?.works} label={t("papers")} loading={!author} />
            <Stat value={author?.citations} label={t("citations")} loading={!author} />
            <Stat value={author?.hIndex} label={t("hIndex")} loading={!author} />
          </div>
          <TopTopics topics={author?.topics} onNavigate={closeFocus} />
        </div>
      )}
      <CardActions
        filter={filter}
        value={id}
        name={author?.name ?? name}
        page={author?.profileId ? { href: `/authors/${author.profileId}`, label: t("authorPage") } : null}
        openAlex={`https://openalex.org/${id}`}
      />
    </>
  );
}

/** An OpenAlex author's name with their card. */
export function AuthorHoverCard({ id, name, children }: { id: string; name: string; children: ReactElement }) {
  return (
    <EntityHoverCard trigger={children}>
      <AuthorCardBody id={id} name={name} />
    </EntityHoverCard>
  );
}

function TopicCardBody({ id, name }: { id: string; name: string }) {
  const t = useTranslations("entityCards");
  const filter = useTopicFilter();
  const node = catalogNode(id);
  const isTopic = node?.level === "topic";
  // A topic's description and count are read; an area's place and size are in the bundled catalog.
  const detail = useSWR(isTopic ? ["topic", id] : null, ([, topic]) => readTopic(topic), { revalidateOnFocus: false });
  const path = node?.path.slice(0, -1) ?? [];
  return (
    <>
      <CardHeader
        icon={<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-inset text-primary"><TopicsIcon aria-hidden className="size-5" /></span>}
        name={node?.name ?? name}
        line={path.length ? (
          <FadeRow className="min-w-0">
            <span className="flex w-max items-center gap-1">
              {path.map((step, index) => <span key={step} className="flex items-center gap-1">{index > 0 && <ChevronRight aria-hidden className="size-3" />}{step}</span>)}
            </span>
          </FadeRow>
        ) : <span>{t(`level.${node?.level ?? "topic"}`)}</span>}
      />
      {isTopic ? (
        <>
          {detail.data || detail.error ? (
            <p className="fade-enter mx-4 mt-3 line-clamp-3 h-[3lh] text-xs leading-relaxed text-muted-foreground">
              {detail.error ? t("topicFailed") : detail.data?.description || t("noDescription")}
            </p>
          ) : (
            // Three lines of bars in the description's three lines.
            <div className="mx-4 mt-3 flex h-[3lh] flex-col justify-around text-xs leading-relaxed">
              {["w-full", "w-full", "w-2/3"].map((width, index) => <SkeletonBar key={index} className={width} />)}
            </div>
          )}
          {/* A failed read offers to try again in the count's place, the same height. */}
          <div className="mt-3 grid h-10 grid-cols-3 items-center gap-3 px-4">
            {detail.error
              ? <Button size="xs" variant="outline" className="justify-self-start" onClick={() => void detail.mutate()}>{t("tryAgain")}</Button>
              : <Stat value={detail.data?.worksCount} label={t("papers")} loading={!detail.data} />}
          </div>
        </>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-3 px-4">
          <Stat value={node?.childCount} label={t(`below.${node?.level === "topic" || !node ? "domain" : node.level}`)} />
        </div>
      )}
      <CardActions
        filter={filter}
        value={id}
        name={node?.name ?? name}
        page={{ href: topicHref(id, name), label: isTopic ? t("topicPage") : t("browseTopics") }}
        openAlex={`https://openalex.org/${id}`}
      />
    </>
  );
}

/** A topic's (or a research area's) name with its card, by catalog id: T10017 or subfields/3304. */
export function TopicHoverCard({ id, name, children }: { id: string; name: string; children: ReactElement }) {
  return (
    <EntityHoverCard trigger={children}>
      <TopicCardBody id={id} name={name} />
    </EntityHoverCard>
  );
}
