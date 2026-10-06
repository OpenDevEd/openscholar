"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { readAuthorCard } from "@/app/actions/author-card";
import { readTopic } from "@/app/actions/topics";
import { AuthorAvatar } from "@/components/authors/author-avatar";
import { ArrowUpRight, ChevronRight, Filter, Search, TopicsIcon } from "@/components/icons";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { FadeRow } from "@/components/assistant/parts";
import { useAuthorFilter, useTopicFilter } from "@/components/paper-card/hooks";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/country-flag";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TooltipHint } from "@/components/ui/tooltip";
import { unlessLimited } from "@/lib/openalex/limited";
import { catalogNode } from "@/lib/topics/search";
import { topicHref } from "@/lib/topics/links";
import { cn } from "@/lib/utils";

/** A card's chips: one line that scrolls sideways, each a link. */
const CHIP = "shrink-0 rounded-md bg-inset px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring";

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
        className="w-80 overflow-hidden p-0"
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

/** A count and what it counts; the count fades in once it is known, in the space kept for it. */
function Stat({ value, label }: { value: number | null | undefined; label: string }) {
  return (
    <div className="min-w-0">
      <div aria-hidden={value == null} className={cn("h-6 text-base font-semibold tabular-nums transition-opacity duration-300", value == null ? "opacity-0" : "opacity-100")}>
        {value == null ? "0" : value.toLocaleString()}
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
  return (
    <div className="mt-4 flex items-center gap-2 bg-inset/60 px-3 py-2.5">
      <Button size="sm" variant={pressed ? "outline" : "default"} aria-pressed={pressed} onClick={() => filter.toggle({ value, name })}>
        {filter.canFilter ? <Filter aria-hidden /> : <Search aria-hidden />}
        {filter.canFilter ? (pressed ? t("removeFilter") : t("filterResults")) : t("searchPapers")}
      </Button>
      {page && (
        <Button size="sm" variant="ghost" className="fade-enter" asChild>
          <Link href={page.href}>{page.label}<ArrowUpRight aria-hidden /></Link>
        </Button>
      )}
      <TooltipHint label={t("openOnOpenAlex")}>
        <Button size="icon-sm" variant="ghost" className="ml-auto" asChild>
          <a href={openAlex} target="_blank" rel="noreferrer" aria-label={t("openOnOpenAlex")}><OpenAlexIcon className="size-4" /></a>
        </Button>
      </TooltipHint>
    </div>
  );
}

function AuthorCardBody({ id, name }: { id: string; name: string }) {
  const t = useTranslations("entityCards");
  const filter = useAuthorFilter();
  const card = useSWR(["author-card", id], ([, author]) => unlessLimited(readAuthorCard(author)), { revalidateOnFocus: false });
  const author = card.data;
  return (
    <>
      <CardHeader
        icon={<AuthorAvatar className="size-10" />}
        name={author?.name ?? name}
        line={author?.institution ? (
          <>
            {author.institution.country && <CountryFlag countryCode={author.institution.country} className="shrink-0" />}
            <span className="truncate">{author.institution.name}</span>
          </>
        ) : author ? <span>{t("noInstitution")}</span> : null}
      />
      {card.error ? (
        <div role="alert" className="mx-4 mt-3 flex h-[5.75rem] flex-col items-start justify-center gap-2 text-sm text-muted-foreground">
          {t("authorFailed")}
          <Button size="sm" variant="outline" onClick={() => void card.mutate()}>{t("tryAgain")}</Button>
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-3 px-4">
            <Stat value={author?.works} label={t("papers")} />
            <Stat value={author?.citations} label={t("citations")} />
            <Stat value={author?.hIndex} label={t("hIndex")} />
          </div>
          <FadeRow scrolls className="mt-3 h-7 px-4">
            <div className="flex w-max items-center gap-1.5">
              {author?.topics.map((topic) => <Link key={topic.id} href={`/topics/${topic.id}`} className={CHIP}>{topic.name}</Link>)}
              {author && !author.topics.length && <span className="text-xs text-muted-foreground">{t("noTopics")}</span>}
            </div>
          </FadeRow>
        </>
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
          <p className={cn("mx-4 mt-3 line-clamp-3 h-[3lh] text-xs leading-relaxed text-muted-foreground transition-opacity duration-300", detail.data || detail.error ? "opacity-100" : "opacity-0")}>
            {detail.error ? t("topicFailed") : detail.data?.description || t("noDescription")}
          </p>
          {/* A failed read offers to try again in the count's place, the same height. */}
          <div className="mt-3 grid h-10 grid-cols-3 items-center gap-3 px-4">
            {detail.error
              ? <Button size="xs" variant="outline" className="justify-self-start" onClick={() => void detail.mutate()}>{t("tryAgain")}</Button>
              : <Stat value={detail.data?.worksCount} label={t("papers")} />}
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
