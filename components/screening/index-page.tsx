"use client";

// The list of a workspace's screenings, as a table: the ones waiting on you first.

import { WaitingInvitations } from "@/components/workspaces/shared";
import { AutoHeight } from "@/components/ui/auto-height";
import { useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { AiIcon, CircleCheck, Eye, GitCompare, Hourglass, Layers, ListChecks, MoreHorizontal, PenLine, Plus, RefreshCw, MessagesSquare, Search } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { CommandCenterFilters } from "@/components/command-center/command-center-toolbar";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { ListEmpty, ListRowsSkeleton } from "@/components/evidence-libraries/list-controls";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { PageWrapper } from "@/components/PageWrapper";
import { Chip } from "./parts";
import { Segmented } from "@/components/settings/parts";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { TooltipHint } from "@/components/ui/tooltip";
import PlainLink from "next/link";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { useRunBy } from "@/components/workspaces/run-by";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { nameHas } from "@/lib/screening/rules";
import { cn } from "@/lib/utils";
import { workspaceHref } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { useTranslations } from "next-intl";
import { inOrder, RESULTS } from "./data";
import { searchHistory } from "./address";
import { askedHref, newHref, overviewHref, papersHref, reviewerHref, screenHref } from "./links";
import { draftOf, useKept } from "./drafts";
import { OVERS, ScreeningMenuItems, useScreeningOverlays, type Over } from "./overlays";
import { Faces, FilterMenu, Help, LinkChip, StateChip, votesBy, RESULT_ICON, ResultBar, ResultChip, TabCount, tinted, MODELS_READING, MODELS_SAY, FIGURE_LINK } from "./pieces";
import { toReviewers, useOpenScreening, type Summary } from "./store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWords } from "./words";
import { listedNames } from "./workspace";

const PAGE = 25;
/** Rows held while how many there are isn't known yet: a few, as most lists have, and the frame slides to the real number. */
const UNCOUNTED_ROWS = 3;
const SORTS = ["you", "active", "newest", "oldest", "name"] as const;
/** The groups the rows fall in, and past All a tab for each, under the same name. In progress holds every screening that isn't finished, the ones that need the person among them. */
const SHOWS = ["you", "open", "finished"] as const;
/** Which screenings the list shows, kept in the address: Back from a screening returns to the list as it was left. */
const PLACE = {
  show: parseAsStringLiteral(["all", ...SHOWS] as const).withDefault("all"),
  sort: parseAsStringLiteral(SORTS).withDefault("you"),
  q: parseAsString.withDefault(""),
  // The page of the list, as its pager keeps it (lib/hooks/use-cursor-page.ts): named here so another tab or order starts at the first.
  page: parseAsString,
};

/** Each tab in the colour its rows' status chips have: what waits for you is primary, a finished screening is green. */
const SHOW_ICON = { you: tinted(ListChecks, "primary"), open: tinted(Hourglass, "neutral"), finished: tinted(CircleCheck, "success") };
/**
 * The table's columns, from a laptop's width up: Screening, Reviewers, Papers, Status, Last activity
 * and the menu. Narrower, each row is a card: the title and its menu, the facts under it, the faces
 * and when it last moved on one line, the bar, then the status.
 */
const COLUMNS = "@5xl:grid-cols-[minmax(14rem,1.75fr)_9rem_minmax(8rem,1fr)_minmax(15rem,2fr)_6rem_2rem]";
const CARD = "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'title_menu'_'meta_meta'_'faces_faces'_'papers_papers'_'status_status'] @5xl:[grid-template-areas:'title_faces_papers_status_when_menu'_'meta_faces_papers_status_when_menu']";
/** A link inside a row sits above the link the whole row is, and shows that it is one. */
const ABOVE = "relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

type What = Over;

export function ScreeningsIndex() {
  // Another tab, order or page is a step Back returns from. Typing in the search box changes the address in place.
  const [{ show, sort, q: search }, setPlace] = useQueryStates(PLACE, { history: "push", scroll: false });
  const go = (next: Parameters<typeof setPlace>[0]) => void setPlace(next);
  // A row's menu opens the screening's dialogs over the list, kept in the address as its own pages keep them: the row, and what is open over it (./address.ts).
  const [{ row: overRow }, openOver] = useQueryStates({ row: parseAsString, over: parseAsStringLiteral(OVERS) }, { history: "push", scroll: false });
  const here = useWorkspace();
  // A new screening begun in this workspace and not started yet, kept with the tab: the list leads back to it.
  const begun = useKept((store) => store.drafts);
  const draft = Object.entries(begun).flatMap(([key, held]) => { const one = draftOf(key); return one && one.workspace === (here ?? "") ? [{ name: held.name.trim(), href: newHref(one.started) }] : []; })[0];
  const t = useTranslations("screening.list");
  const tp = useTranslations("screening.pieces");
  const words = useWords();
  const runBy = useRunBy("screeningJobs", { label: "startedBy", compact: true });
  const searched = useDebouncedValue(search.trim(), 300);
  // What waits for the person, and what is shared with them from elsewhere: read whole, since both are theirs alone and few.
  const mine = useProtectedQuery(api.screening.view.mine, inWorkspace(here, {})).data;
  const tally = useProtectedQuery(api.screening.view.tally, inWorkspace(here, {})).data;
  const elsewhere = useProtectedQuery(api.screening.view.elsewhere, inWorkspace(here, {})).data;
  // "Needs you first" is the newest first with what waits for the person above them.
  const listed = useCursorPageAt("page", api.screening.view.list, inWorkspace(here, show === "you" ? "skip" : { show, sort: sort === "you" ? ("newest" as const) : sort, ...(runBy.by ? { by: runBy.by } : {}), ...(searched ? { text: searched } : {}) }), PAGE);

  const fits = (row: Summary) => nameHas(row.name, searched) && (!runBy.by || row.createdBy.id === runBy.by);
  const needing = (row: Summary) => row.forYou + row.conflicts + row.asked > 0;
  const needs = (mine?.page ?? []).filter((row) => needing(row) && fits(row));
  const shared = (mine?.page ?? []).filter((row) => !row.member && fits(row));
  const waiting = new Set(needs.map((row) => row.id));
  // Under the default order what waits for the person leads the first page, and the pages after it never repeat one.
  const pinned = sort === "you" && show !== "finished" && listed.page === 1 ? needs.filter((row) => show === "all" || !row.finishedAt) : [];
  const paged = show === "you" ? [] : listed.items.filter((row) => !(sort === "you" && show !== "finished" && waiting.has(row.id)));
  // Screenings shared from outside its workspace come on the first page, on top of its own: the pager counts them there.
  const sharedShown = shared.filter((row) => !pinned.some((one) => one.id === row.id) && (show === "all" || (show === "finished") === Boolean(row.finishedAt)));
  const rows = (show === "you" ? needs : [...pinned, ...paged, ...(listed.page === 1 ? sharedShown : [])]).map((row) => ({ row, group: waiting.has(row.id) ? 0 : row.finishedAt ? 2 : 1 }))
    // Under "Needs you first" the rows sit in their groups, each group in the page's order: one group never splits around another.
    .sort((a, b) => (sort === "you" ? a.group - b.group : 0));
  // The rows wait for what is drawn above them too, so a list that has drawn is never pushed down.
  const loading = mine === undefined || tally === undefined || elsewhere === undefined || (show !== "you" && listed.isLoading);
  const counts = tally && mine ? { all: tally.open + tally.finished + mine.page.filter((row) => !row.member).length, you: mine.page.filter(needing).length, open: tally.open + mine.page.filter((row) => !row.member && !row.finishedAt).length, finished: tally.finished + mine.page.filter((row) => !row.member && row.finishedAt).length } : undefined;
  const empty = counts !== undefined && counts.all === 0 && counts.you === 0;
  // Under the default order the rows sit in their groups, where there is more than one.
  const grouped = sort === "you" && new Set(rows.map((one) => one.group)).size > 1;
  const none = searched ? t("noneCalled", { show, name: words.quoted(searched) }) : t("none", { show });
  // A count still being read holds a digit's room, so the tabs keep their place when it arrives.
  const count = (value: number | undefined, tone?: "primary" | "success") => (value === undefined ? <span aria-hidden className="invisible tabular-nums">0</span> : <TabCount value={value} tone={tone} />);

  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        <div className={`contents ${AVATARS_FADE_IN}`}>
          <LibraryPageShell
            wide
            icon={ListChecks}
            title={t("title")}
            // Until the counts say whether there is any screening, the search and the order hold their place unseen: a new account has neither.
            filters={empty ? undefined : <CommandCenterFilters pending={counts === undefined} sortOptions={SORTS.map((value) => ({ value, label: t(`sort.${value}`) }))} currentSort={sort} onSortChange={(next) => go({ sort: next, page: null })} searchFilter={search} onSearchChange={(next) => void setPlace({ q: next, page: null }, searchHistory(search, next))} placeholder={t("find")} />}
            actions={
              <Button asChild size="sm" className={BAR_ACTION}>
                <NextLink href={newHref()}><Plus /><span className={BAR_LABEL}>{t("newScreening")}</span></NextLink>
              </Button>
            }
          >
            {/* What waits elsewhere, the first-use block or the list: each slides to its height as the counts and the rows come. */}
            <AutoHeight>
              {draft && counts !== undefined ? (
                <div className="fade-enter flex items-center gap-3 border-b border-border-subtle px-4 py-3 sm:px-6">
                  <PenLine aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate text-sm">{t("draft.says", { named: String(Boolean(draft.name)), name: draft.name })}</p>
                  <Button asChild size="sm" variant="outline"><NextLink href={draft.href}>{t("draft.continue")}</NextLink></Button>
                </div>
              ) : null}
              <WaitingInvitations kind="screening" />
              <Elsewhere rows={elsewhere ?? []} />
            </AutoHeight>
            <AutoHeight>
            {empty ? (
              // Where screenings elsewhere wait for the person, this workspace having none is said in a few lines, not as a first visit.
              <div className={cn("flex flex-col items-center gap-3 px-6 text-center", elsewhere?.length ? "py-8" : "py-20")}>
                {elsewhere?.length ? null : <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary"><ListChecks className="size-6" /></span>}
                <h2 className={elsewhere?.length ? "text-sm font-medium" : "text-lg font-semibold tracking-tight"}>{elsewhere?.length ? t("firstUse.noneHere") : t("firstUse.title")}</h2>
                {elsewhere?.length ? null : <p className="max-w-md text-sm text-muted-foreground">{t("firstUse.text")}</p>}
                <Button asChild className="mt-2"><NextLink href={newHref()}><Plus />{t("newScreening")}</NextLink></Button>
              </div>
            ) : (
              <>
                {/* Unseen until the counts are in: an account with no screening gets the first-use block in their place. */}
                <div className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-3 border-b border-border-subtle p-4 sm:px-6", !counts && "invisible")}>
                  {/* Four tabs don't fit a phone's width, and a row of tabs never runs off the screen: there they are one menu, with the same signs and counts. */}
                  <FilterMenu
                    name={t("showMenu")}
                    value={show}
                    onChange={(next) => go({ show: next, page: null })}
                    narrows={false}
                    className="h-8 w-full rounded-full px-3.5 text-xs sm:hidden"
                    choices={[
                      { value: "all" as typeof show, label: t("show.all"), icon: <Layers />, count: counts?.all },
                      { value: "you" as typeof show, label: t("show.you"), icon: <ListChecks />, tone: "primary" as const, count: counts?.you },
                      { value: "open" as typeof show, label: t("show.open"), icon: <Hourglass />, count: counts?.open },
                      { value: "finished" as typeof show, label: t("show.finished"), icon: <CircleCheck />, tone: "success" as const, count: counts?.finished },
                    ]}
                  />
                  <ScrollArea axis="x" shades className="max-w-full max-sm:hidden max-lg:-mx-4">
                  <div className="w-max max-lg:px-4">
                    <Segmented
                      label={t("whichScreenings")}
                      value={show}
                      onChange={(next) => go({ show: next, page: null })}
                      options={[
                        { id: "all", label: t("show.all"), detail: count(counts?.all) },
                        { id: "you", label: t("show.you"), icon: SHOW_ICON.you, detail: count(counts?.you, "primary") },
                        { id: "open", label: t("show.open"), icon: SHOW_ICON.open, detail: count(counts?.open) },
                        { id: "finished", label: t("show.finished"), icon: SHOW_ICON.finished, detail: count(counts?.finished, "success") },
                      ]}
                    />
                  </div>
                  </ScrollArea>
                  {/* What the bars' colours mean and what "settled" counts: beside the tabs where the row has the room, and on a line of its own under them where it hasn't. */}
                  <span role="group" aria-label={t("legend.label")} className="order-last flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground @7xl:order-none @7xl:basis-auto">
                    {([["settled", ["include", "maybe", "exclude"]], ["notYet", ["conflict", "waiting"]]] as const).map(([name, results]) => (
                      <span key={name} className="flex items-center gap-x-2.5">
                        <span className="font-medium text-foreground">{t(`legend.${name}`)}</span>
                        {results.map((result) => { const Icon = RESULT_ICON[result]; return <span key={result} className="flex items-center gap-1"><Icon aria-hidden className="size-3.5 shrink-0" />{words.result(result)}</span>; })}
                      </span>
                    ))}
                  </span>
                  {/* In an organization, whose screenings: the same control every list of a workspace has. */}
                  {runBy.filter}
                </div>
                {/* The column names stay under the page's bar while the list scrolls. */}
                <div className={cn("sticky top-[calc(var(--app-navbar-height)+var(--page-header-height,4rem))] z-10 hidden items-center gap-x-5 border-b border-border-subtle bg-inset px-6 py-2 text-xs font-medium text-muted-foreground @5xl:grid", COLUMNS, !counts && "invisible")}>
                  <span>{t("column.screening")}</span>
                  <span>{t("column.reviewers")}</span>
                  <span className="flex items-center gap-1">
                    {t("column.papers")}
                    <Help title={t("papersHelp.title")} facts={RESULTS.map((result) => <ResultChip key={result} result={result} />)}>
                      <p>{t("papersHelp.text")}</p>
                    </Help>
                  </span>
                  <span>{t("column.status")}</span>
                  <span className="whitespace-nowrap">{t("column.lastActivity")}</span>
                  <span />
                </div>
                {/* The rows and what stands in for them while they are read are different heights: the frame around them slides from one to the other. */}
                <AutoHeight>
                {loading && !rows.length ? (
                  <ListRowsSkeleton rows={Math.max(1, Math.min(counts?.[show] ?? UNCOUNTED_ROWS, PAGE))} height={72} icon={false} label={t("loadingScreenings")} />
                ) : (
                <ul className={cn("divide-y divide-border-subtle", listed.isStale && "pointer-events-none opacity-60")}>
                  {rows.map(({ row, group }, i) => {
                    const id = row.id;
                    const me = row.me as string;
                    // The workspace is named wherever it isn't the one the person looking works in.
                    const elsewhere = row.workspace.id !== here;
                    const reviewers = inOrder(toReviewers(row.reviewers.filter((one) => one.left === undefined), words), me);
                    const { counts: stands, total, forYou, conflicts, asked, askedFirst, models, ahead } = row;
                    const settled = total - stands.conflict - stands.waiting;
                    const resolver = row.resolver.id === me ? words.t("youInline") : words.firstName(row.resolver.name);
                    return (
                      <Group key={id} label={(grouped || show === "you") && (i === 0 || rows[i - 1]!.group !== group) ? t(`show.${SHOWS[group]!}`) : null} note={group === 0 ? t("needsYouNote") : undefined} count={group === 0 ? needs.length : undefined}>
                        {/* Whatever in the row is pressed opens the screening: it opens under this name while the rest of it is read. */}
                        <li onClickCapture={() => listedNames.set(id, row.name)} className={cn("relative grid items-center gap-x-5 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted sm:px-6 @5xl:gap-y-0.5", CARD, COLUMNS)}>
                          {/* The whole row opens the screening. Its title is the link a keyboard reaches; what is pressable inside the row sits above this one. */}
                          <NextLink href={overviewHref(id)} tabIndex={-1} aria-hidden className="absolute inset-0" />
                          <TooltipHint label={row.name} onlyWhenClipped>
                            <NextLink dir="auto" href={overviewHref(id)} className={cn(ABOVE, "min-w-0 self-end text-sm font-semibold [grid-area:title] hover:underline line-clamp-2")}>{row.name}</NextLink>
                          </TooltipHint>
                          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 self-start text-xs text-muted-foreground [grid-area:meta]">
                            {t.rich("startedBy", {
                              who: words.youOr(row.createdBy, me),
                              // Whether it names the reader: some languages say "you started it" with another form of the verb.
                              you: String(row.createdBy.id === me),
                              when: words.ago(row.createdAt),
                              person: (chunks) => (
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <IdentityAvatar name={row.createdBy.name} imageUrl={row.createdBy.imageUrl} className="size-4" />
                                  <span className="truncate">{chunks}</span>
                                </span>
                              ),
                              at: (chunks) => <span className="whitespace-nowrap">{chunks}</span>,
                            })}
                            {elsewhere ? <span className="flex min-w-0"><WorkspaceTag size="sm" workspace={{ kind: row.workspace.kind, name: row.workspace.name, imageUrl: row.workspace.imageUrl, colour: row.workspace.colour, workspaceId: row.workspace.id }} /></span> : null}
                            {/* Found by a search or under All, a finished one says so on its card, as the Show filter would. */}
                            {row.finishedAt ? <Chip icon={CircleCheck} className="h-5 px-1.5">{t("show.finished")}</Chip> : row.living ? <Chip icon={RefreshCw} className="h-5 px-1.5">{words.living(row.living.every)}</Chip> : null}
                            {/* A member who isn't one of its reviewers can still change it: only someone it was shared with is a viewer. */}
                            {!row.isReviewer ? <Chip icon={Eye} className="h-5 px-1.5">{words.looker(row.member)}</Chip> : null}
                          </span>
                          {/* On a card the faces and when it last moved share a line under the title; in the table each has its column. */}
                          <span className="flex min-w-0 items-center justify-between gap-3 [grid-area:faces] @5xl:contents">
                            <Faces reviewers={reviewers} me={me} className="[grid-area:faces] @5xl:row-span-2" linkOf={(reviewer) => { const href = reviewerHref(id, reviewer); return href ? { href, says: votesBy(tp, reviewer, me) } : null; }} more={{ href: overviewHref(id, "reviewers"), says: t("everyReviewer") }} />
                            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground @5xl:row-span-2 @5xl:[grid-area:when]">{t.rich("lastActivity", { when: words.ago(row.activeAt), label: (chunks) => <span className="@5xl:hidden">{chunks}</span> })}</span>
                          </span>
                          <span className="min-w-0 space-y-1.5 [grid-area:papers]">
                            <ResultBar counts={stands} hrefOf={(result) => papersHref(id, { result })} />
                            {/* A count of none opens nothing: its list would be empty. */}
                            {(row.finishedAt ? stands.include : total) ? (
                              <NextLink href={row.finishedAt ? papersHref(id, { result: "include" }) : papersHref(id)} className={cn(ABOVE, FIGURE_LINK, "block w-fit text-xs tabular-nums text-muted-foreground hover:text-foreground")}>
                                {row.finishedAt ? t("includedOf", { included: words.num(stands.include), total: words.num(total) }) : t("settledOf", { settled: words.num(settled), total: words.num(total) })}
                              </NextLink>
                            ) : (
                              <p className="text-xs tabular-nums text-muted-foreground">{row.finishedAt ? t("includedOf", { included: words.num(stands.include), total: words.num(total) }) : t("settledOf", { settled: words.num(settled), total: words.num(total) })}</p>
                            )}
                          </span>
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5 [grid-area:status] @5xl:row-span-2">
                            {forYou ? <LinkChip href={screenHref(id)} tone="primary" icon={ListChecks} className="relative shrink-0">{t("forYouToScreen", { count: forYou })}</LinkChip> : null}
                            {conflicts ? <LinkChip href={screenHref(id, { queue: "conflicts" })} tone="info" icon={GitCompare} className="relative shrink-0">{t("conflictsToSettle", { count: conflicts })}</LinkChip> : null}
                            {/* It opens the paper the question is about, where it is answered. */}
                            {asked && askedFirst ? <LinkChip href={askedHref(id, askedFirst, row.askedWhere)} tone="primary" icon={MessagesSquare} className="relative shrink-0">{t("questionsForYou", { count: asked })}</LinkChip> : null}
                            {/* What its models are doing shows beside your work. */}
                            {models === "reading" ? <LinkChip href={overviewHref(id)} className="relative shrink-0"><span className="flex items-center gap-1.5"><AiIcon working className="size-3.5" />{MODELS_READING(tp)}</span></LinkChip>
                              : models === "waiting" ? (ahead ? <LinkChip href={overviewHref(ahead.id)} icon={MODELS_SAY.waiting.icon} className="relative shrink-0">{tp.rich("modelsSay.waiting.says", { name: ahead.name, link: (chunks) => chunks })}</LinkChip> : null)
                              : models ? <LinkChip href={overviewHref(id)} tone={MODELS_SAY[models].stop ? "warning" : undefined} icon={MODELS_SAY[models].icon} className="relative shrink-0">{tp(`modelsSay.${models}.says`)}</LinkChip>
                              : null}
                            {/* Where its papers stand shows where nothing waits for you. */}
                            {forYou || conflicts ? null
                              : row.finishedAt ? (stands.include ? <LinkChip href={papersHref(id, { result: "include" })} tone="success" icon={CircleCheck} className="relative shrink-0">{t("finishedIncluded", { included: words.num(stands.include) })}</LinkChip> : <StateChip tone="success" icon={CircleCheck} className="relative shrink-0">{t("finishedIncluded", { included: words.num(0) })}</StateChip>)
                              : models ? null
                              : stands.waiting ? <LinkChip href={papersHref(id, { result: "waiting" })} icon={Hourglass} className="relative shrink-0">{t("waitingForVotes", { count: words.num(stands.waiting) })}</LinkChip>
                              : stands.conflict ? <LinkChip href={papersHref(id, { result: "conflict" })} tone="info" icon={GitCompare} className="relative shrink-0">{t("inConflictFor", { count: words.num(stands.conflict), who: resolver })}</LinkChip>
                              : row.living ? <LinkChip href={overviewHref(id, "new-papers")} icon={RefreshCw} className="relative shrink-0">{t("upToDate")}</LinkChip>
                              // Ready to finish is said to whoever may finish it; a screening with no papers has nothing settled to say.
                              : total ? <LinkChip href={papersHref(id)} tone="success" icon={CircleCheck} className="relative shrink-0">{t("allSettled", { finish: String(row.member) })}</LinkChip>
                              : null}
                          </span>
                          <span className="flex justify-end [grid-area:menu] @5xl:row-span-2">
                            <RowMenu id={id} name={row.name} onOpen={(what) => void openOver({ row: id, over: what })} />
                          </span>
                        </li>
                      </Group>
                    );
                  })}
                  {!rows.length ? (
                    <li>
                      {/* "Show every screening" takes off every narrowing, the person a list is run by too. */}
                      <ListEmpty icon={searched ? Search : ListChecks} action={<Button variant="outline" size="sm" onClick={() => { runBy.clear(); go({ q: null, show: null, page: null }); }}>{t("showEvery")}</Button>}>{none}</ListEmpty>
                    </li>
                  ) : null}
                </ul>
                )}
                </AutoHeight>
                {/* The total is the tabs' own count, with the screenings shared from outside, which the first page shows on top of its own; the pages are its own screenings'. Under "Needs you first" the rows that wait are drawn first, out of the pages' order, so neither a total nor a range is said there. */}
                {show !== "you" && listed.hasPages ? <CommandCenterPagination className="border-t border-border-subtle p-4 sm:px-6" currentPage={listed.page} itemLabel={t("pagerItems")} steps={{ canPrevious: listed.canPrevious, canNext: listed.canNext, onPrevious: listed.previous, onNext: listed.next, offset: listed.offset + (listed.page > 1 ? sharedShown.length : 0), shown: sort === "you" ? 0 : listed.items.length + (listed.page === 1 ? sharedShown.length : 0), ...(searched || runBy.by || !counts || !tally || sort === "you" ? {} : { total: show === "open" ? counts.open : show === "finished" ? counts.finished : counts.all, pageCount: Math.max(1, Math.ceil((show === "open" ? tally.open : show === "finished" ? tally.finished : tally.open + tally.finished) / PAGE)) }) }} /> : null}
              </>
            )}
            </AutoHeight>
          </LibraryPageShell>
          {/* On a phone the last row can scroll clear of the assistant's button in the corner. */}
          <div aria-hidden className="h-6 lg:hidden" />
        </div>
        {overRow ? <RowDialogs key={overRow} id={overRow} /> : null}
      </PageWrapper>
    </MotionConfig>
  );
}

/** A group's labelled row before its first screening on the page, under the default order. */
/** The screenings that wait for the person in another workspace. This list holds this workspace's own, so each of those is a link to where it is. */
function Elsewhere({ rows }: { rows: Array<{ id: string; name: string; in: string; slug?: string; forYou: number; conflicts: number; asked: number; askedFirst?: string; askedWhere?: "conflicts" | "screen" | "papers" }> }) {
  const t = useTranslations("screening.list");
  const words = useWords();
  if (!rows.length) return null;
  return (
    <ul aria-label={t("elsewhere")} className="divide-y divide-border-subtle border-b border-border-subtle">
      <li className="flex items-baseline gap-2 bg-inset px-4 py-2 text-xs font-medium sm:px-6">
        <span>{t("elsewhere")}</span>
        <span className="tabular-nums text-muted-foreground">{rows.length}</span>
      </li>
      {rows.map((row) => {
        const there = (path: string) => workspaceHref(row.slug, path);
        return (
          <li key={row.id} onClickCapture={() => listedNames.set(row.id, row.name)} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-6">
            <PlainLink dir="auto" href={there(overviewHref(row.id))} className={cn(ABOVE, "min-w-0 text-sm font-semibold hover:underline")}>{row.name}</PlainLink>
            <Chip className="h-5 px-1.5">{t("inWorkspace", { name: row.in })}</Chip>
            <span className="ms-auto flex flex-wrap items-center gap-1.5">
              {row.forYou ? <LinkChip elsewhere href={there(screenHref(row.id))} tone="primary" icon={ListChecks} className="shrink-0">{t("forYouToScreen", { count: row.forYou })}</LinkChip> : null}
              {row.conflicts ? <LinkChip elsewhere href={there(screenHref(row.id, { queue: "conflicts" }))} tone="info" icon={GitCompare} className="shrink-0">{t("conflictsToSettle", { count: row.conflicts })}</LinkChip> : null}
              {row.asked ? <LinkChip elsewhere href={there(row.askedFirst ? askedHref(row.id, row.askedFirst, row.askedWhere) : overviewHref(row.id))} tone="primary" icon={MessagesSquare} className="shrink-0">{t("questionsForYou", { count: row.asked })}</LinkChip> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Group({ label, note, count, children }: { label: string | null; /** What the group holds, where its name doesn't say: with it, a row that shows no question is a screening where nobody waits for an answer. */ note?: string; /** How many it holds, where that is known without reading every page. */ count?: number; children: ReactNode }) {
  return (
    <>
      {label ? (
        <li className="flex items-baseline gap-2 bg-inset px-4 py-2 text-xs font-medium sm:px-6">
          <span className="shrink-0">{label}</span>
          {count === undefined ? null : <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>}
          {note ? <span className="min-w-0 ps-1 font-normal text-muted-foreground">{note}</span> : null}
        </li>
      ) : null}
      {children}
    </>
  );
}

/** Its reviewers' faces and marks, each opening the papers that reviewer voted on. */
/** The row's menu: what the open screening's menu offers, under the same names and in the same order, after Settings, Export and Share. */
function RowMenu({ id, name, onOpen }: { id: string; name: string; onOpen: (what: What) => void }) {
  const t = useTranslations("screening.list");
  // The pointer over the button or the keyboard on it: the screening is read from then, so the menu opens with its items.
  const [near, setNear] = useState(false);
  return (
    <DropdownMenu>
      {near ? <ReadAhead id={id} /> : null}
      <TooltipHint label={t("more")}>
        <DropdownMenuTrigger asChild onPointerEnter={() => setNear(true)} onFocus={() => setNear(true)}>
          <Button variant="ghost" size="icon" className="relative size-8 text-muted-foreground" aria-label={t("moreFor", { name })}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
      </TooltipHint>
      <DropdownMenuContent align="end" className="w-auto min-w-56 [&_[role=menuitem]]:whitespace-nowrap">
        <RowMenuItems id={id} onOpen={onOpen} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Reads the screening before its menu opens; the cache keeps it for the menu. */
function ReadAhead({ id }: { id: string }) {
  useOpenScreening(id);
  return null;
}

/** The menu's items, worked out from the screening as the person sees it. Opened before it is read, rows hold their place. */
function RowMenuItems({ id, onOpen }: { id: string; onOpen: (what: What) => void }) {
  const t = useTranslations("screening.list");
  const open = useOpenScreening(id);
  if (open) return <ScreeningMenuItems open={open} show={onOpen} />;
  return (
    <div role="status" aria-label={t("loadingMenu")} className="space-y-1 p-1">
      {["w-20", "w-24", "w-16", "w-28", "w-24", "w-20"].map((width, at) => <div key={at} className="flex h-7 items-center gap-2 px-2"><SkeletonBar className="size-4 shrink-0" /><SkeletonBar className={width} /></div>)}
    </div>
  );
}

/**
 * What the row's menu opens, for one screening: the same dialogs and confirms the open screening has.
 * Sharing can lead on to making someone a reviewer or a viewer, each asked first.
 */
function RowDialogs({ id }: { id: string }) {
  // The same overlays the screening's own pages open, on the one its row's menu asked for.
  return useScreeningOverlays(useOpenScreening(id) ?? null).overlays;
}
