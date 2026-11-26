"use client";

// An open screening, across the whole window: the frame its four pages share (Overview, Screen, Papers
// and Settings, each at its own address). Its reviewers, its settings and its state can change at any time from here.

import { createContext, use, useLayoutEffect, useRef, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useParams, useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import { PenLine, AiIcon, BarChart3, Check, CircleCheck, CirclePause, Clock, Coins, Download, Eye, History, ListChecks, Lock, MoreHorizontal, Play, RefreshCw, RotateCcw, Search, Settings2, Table2, Unlink, UserPlus, Users } from "@/components/icons";
import { ListEmpty, ListRowsSkeleton } from "@/components/evidence-libraries/list-controls";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { AnimatedNumber, Chip, Meter } from "./parts";
import { EASE } from "@/components/settings/model-map";
import { Opening } from "@/components/ui/opening";
import { Segmented } from "@/components/settings/parts";
import { AutoHeight } from "@/components/ui/auto-height";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FadeRow } from "@/components/ui/fade-row";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpFact } from "@/components/ui/help";
import { TooltipHint } from "@/components/ui/tooltip";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { bareWorkspacePath } from "@/lib/workspaces/paths";
import { useWorkspace as usePageWorkspace } from "@/lib/workspaces/url";
import { cn } from "@/lib/utils";
import { inOrder, readersOf, growing, activeReviewers, modelsOf, type Reviewer, type Screening, lookOf } from "./data";
import type { ExportTab } from "./dialogs";
import { useKept } from "./drafts";
import { SCREENINGS, useScreeningsCrumb, overviewHref, papersHref, screenHref, settingsHref } from "./links";
import { ScreeningMenuItems, useScreeningOverlays } from "./overlays";
import { Faces, votesBy, StateChip, Help, LinkChip, TONE, TabCount, type Tone, INLINE_LINK } from "./pieces";
import { useOpenScreening, type Open, modelsRead, perPaper } from "./store";
import { useWords, type Words } from "./words";

/** This part's messages, for a function that is handed them. */
type T = ReturnType<typeof useTranslations<"screening.frame">>;

type View = "overview" | "screen" | "papers" | "settings";

/**
 * Where each step of a screening's history was scrolled, and whether the last step was the browser's Back or Forward
 * rather than a link. Back returns to where the page was: the browser tries that itself, but while the page being left
 * is still drawn, so a shorter one cuts it short. The browser's history and the window's scroll are the outside
 * systems; the listener lives as long as the tab and acts only on the screening pages.
 */
const scrolled = new Map<string, number>();
let returning = false;
if (typeof window !== "undefined" && "navigation" in window) {
  const { navigation } = window;
  const mock = () => bareWorkspacePath(window.location.pathname).startsWith(SCREENINGS);
  const keep = () => { if (navigation.currentEntry && mock()) scrolled.set(navigation.currentEntry.key, window.scrollY); };
  // A link is pressed before the router scrolls the page it opens, so the press is when the page being left is kept.
  window.addEventListener("click", keep, true);
  navigation.addEventListener("navigate", (event) => {
    // A replace (typing a search, going from paper to paper) stays on the same step.
    if (event.navigationType !== "push" && event.navigationType !== "traverse") return;
    if (event.navigationType === "traverse") keep();
    returning = event.navigationType === "traverse";
  });
  navigation.addEventListener("currententrychange", (event) => {
    const y = navigation.currentEntry ? scrolled.get(navigation.currentEntry.key) : undefined;
    if (event.navigationType !== "traverse" || y === undefined || !mock()) return;
    // Once the page it returns to is drawn; a page that grows over its first frames gets a few more tries.
    let tries = 10;
    const restore = () => {
      window.scrollTo(0, y);
      if (Math.abs(window.scrollY - y) > 1 && --tries) requestAnimationFrame(restore);
    };
    requestAnimationFrame(restore);
  });
}

/** The names of the screenings a list showed, kept as one of its rows is pressed: the screening opens under its name while the rest of it is read. */
export const listedNames = new Map<string, string>();

/** What the frame gives the page inside it: the screening as the person sees it, and the ways to open what opens over it. */
const Workspace = createContext<{ open: Open; exportTo: (tab: ExportTab) => void; finish: () => void; openActivity: () => void } | null>(null);
export function useWorkspace() {
  const workspace = use(Workspace);
  if (!workspace) throw new Error("A screening's page is shown inside its frame");
  return workspace;
}

/** The frame, for a component that also stands outside one: a new screening's form has none. */
export const useFrame = () => use(Workspace);

/** A name or a count inside a sentence that opens what it stands for. */

/** The rule in three chips, each a sentence of its own: who votes on a paper, what settles it, and who sees the votes. Said from the paper's side ("each paper"), so a chip never reads as how one paper stands. */
function ruleFacts({ words, t }: { words: Words; t: T }, screening: Screening, voter: boolean) {
  const [{ each }, models] = [readersOf(screening), modelsOf(screening).length];
  return {
    who: each || models ? t("rule.eachPaper", { who: each && models ? "both" : each ? "people" : "models", people: each, models }) : t("rule.noReviewer"),
    whoIcon: each ? Users : AiIcon,
    when: words.t(`settle.says.${screening.rule.settle}`),
    // As advice, the models' votes settle nothing on a paper a person has: said beside the rule, where it changes what the rule means.
    advice: screening.rule.models === "advice" && screening.rule.settle !== "one" && each > 0 && models > 0 ? t("rule.advice") : null,
    // Votes are hidden on the papers that wait for a reviewer's own vote, which is their To do: the chip names that queue, a word the page shows, and promises nothing. Someone who doesn't vote here sees every vote: their chip says what holds for the reviewers.
    // Once it is finished nobody has a vote left to cast, and every vote shows (lib/screening/rules.ts `seesVotes`).
    see: screening.rule.blind === "after" && !screening.finishedAt ? (voter ? t("rule.hiddenMine") : t("rule.hiddenTheirs")) : screening.finishedAt && screening.rule.blind === "after" ? t("rule.visibleFinished") : t("rule.visible"),
    seeIcon: screening.rule.blind === "after" && !screening.finishedAt ? Lock : Eye,
  };
}

export function ScreeningWorkspace({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("screening.frame");
  const crumb = useScreeningsCrumb();
  const words = useWords();
  const pieces = useTranslations("screening.pieces");
  const router = useWorkspaceRouter();
  const here = usePageWorkspace();
  // Which of its pages is open: each has its own address, so Back returns to the one before.
  const segment = useSelectedLayoutSegment();
  const search = useSearchParams();
  const view: View = segment === "screen" || segment === "papers" || segment === "settings" ? segment : "overview";
  const read = useOpenScreening(id);
  const open = read ?? null;
  // Changes to its settings that were started and not saved.
  const unsaved = useKept((kept) => Boolean(kept.drafts[id]));
  // A deleted screening's page is left for good: Back does not return to it.
  const overlays = useScreeningOverlays(open, { onDeleted: () => router.replace(SCREENINGS) });
  // A page opened by a link starts at its top; Back and Forward, and a link to a section, keep their place. The window's scroll is the outside system.
  // Before the page's own effects, so a page that then brings the item its link named into view has the last word.
  useLayoutEffect(() => {
    if (!returning && !window.location.hash) window.scrollTo(0, 0);
  }, [view, id]);

  // The strip of tabs stays under the page's bar from a laptop's width. Its height is the outside system: it is written where a table's head and the sidebars under it read it, so they stand right below it. Zero where the strip scrolls with the page.
  const frame = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const found = Boolean(open);
  useLayoutEffect(() => {
    const [root, held] = [frame.current, strip.current];
    if (!root || !held) return;
    // A link to a part of the page is followed before the strip's height is known, and the strip can still settle after that (its notice arriving): until the person first touches the page they came to, the part the address names lands again under the strip as it is now. Anything else above it that settles (a list arriving shorter than the room kept for it) leaves the part where it landed, in the same frame, so it holds still.
    let untouched = true;
    let landedAt: number | undefined;
    const touched = () => { untouched = false; };
    // Where it stands in the page, leaving out the page's own slide in as it opens.
    const placeOf = (element: HTMLElement) => { let y = 0; for (let at: HTMLElement | null = element; at; at = at.offsetParent as HTMLElement | null) y += at.offsetTop; return y; };
    const part = () => (untouched && window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null);
    const write = () => {
      root.style.setProperty("--screening-frame", held.parentElement && getComputedStyle(held.parentElement).position === "sticky" ? `${held.offsetHeight}px` : "0px");
      const target = part();
      target?.scrollIntoView();
      landedAt = target ? placeOf(target) : undefined;
    };
    const hold = () => {
      const target = part();
      if (target && landedAt !== undefined) { window.scrollBy(0, placeOf(target) - landedAt); landedAt = placeOf(target); }
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(held);
    const settling = new ResizeObserver(hold);
    settling.observe(document.body);
    window.addEventListener("resize", write);
    for (const kind of ["wheel", "keydown", "pointerdown", "touchstart"]) window.addEventListener(kind, touched, { once: true, passive: true });
    return () => {
      observer.disconnect();
      settling.disconnect();
      window.removeEventListener("resize", write);
      for (const kind of ["wheel", "keydown", "pointerdown", "touchstart"]) window.removeEventListener(kind, touched);
    };
  }, [found, view]);

  // The pages, on a line of their own, each as wide as its share: the card stops short of the width the rule beside them would need.
  // While the screening is read they stand where they will be: the count of its papers holds a digit's room, and Settings is there, as it is for its members.
  const pages = (
    <Segmented
      label={t("tabs.label")}
      value={view}
      fill="labels"
      // On a phone the labels go without their icons and the four stay on one line. Where large counts or an unsaved mark make that line longer than the screen, it scrolls sideways.
      className="@max-[30rem]:w-max @max-[30rem]:min-w-full @max-[30rem]:flex-nowrap @max-[30rem]:*:gap-1.5 @max-[30rem]:*:px-2 @max-[30rem]:[&_svg]:hidden"
      options={[
        { id: "overview", label: t("tabs.overview"), icon: BarChart3, href: overviewHref(id) },
        { id: "screen", label: t("tabs.screen"), icon: ListChecks, href: screenHref(id), detail: open?.toDo ? <TabCount value={open.toDo} tone="primary" /> : undefined },
        { id: "papers", label: t("tabs.papers"), icon: Table2, href: papersHref(id), detail: open ? <span className="tabular-nums text-muted-foreground">{words.num(open.total)}</span> : <span aria-hidden className="invisible tabular-nums">0</span> },
        // Only someone who may change it has its settings.
        ...(!open || open.canChange ? [{ id: "settings" as const, label: t("settings"), icon: Settings2, href: settingsHref(id), detail: unsaved ? <StateChip tone="warning" icon={PenLine} className="h-5 px-1.5 text-2xs">{t("tabs.unsaved")}</StateChip> : undefined }] : []),
      ]}
    />
  );
  // The strip under the bar, the same while it is read: the pages on the first line, with what the models are doing, and how a paper is decided on the second.
  // On Screen from a laptop's width the window's height goes to the paper: the rule shares the pages' line, where its chips scroll sideways.
  const stripOf = (rule: ReactNode, passing?: ReactNode) => (
    <>
      <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 sm:px-6"><FadeRow scrolls scrollbar="none" keepInView="[aria-current=page]" className="min-w-0 flex-1">{pages}</FadeRow>{passing}{view === "screen" ? <div className="min-w-0 max-lg:hidden">{rule}</div> : null}</div>
      {view === "settings" ? null : <div className={cn("flex items-center px-4 py-3 sm:px-6", view === "screen" && "max-sm:hidden lg:hidden")}><div className="min-w-0">{rule}</div></div>}
    </>
  );

  // While it is read the frame holds its place: the name the list showed, or a line where it will be, the strip of pages, and lines where the page will be.
  if (read === undefined) {
    const name = listedNames.get(id);
    return (
      <PageWrapper className={view === "screen" ? "lg:[&>footer]:hidden" : undefined}>
        <LibraryPageShell
          wide
          fill={view === "screen"}
          icon={ListChecks}
          title={name ?? ""}
          titleAside={name ? undefined : <SkeletonBar className="h-4 w-48" />}
          trail={[crumb]}
          actions={
            <>
              <Button variant="outline" size="sm" disabled className="max-xl:hidden"><History />{t("activity")}</Button>
              <Button variant="outline" size="sm" disabled className="max-xl:hidden"><Download />{t("export")}</Button>
              <Button variant="outline" size="sm" disabled className="max-sm:hidden @max-3xl:px-2"><Users /><span className={BAR_LABEL}>{t("people")}</span></Button>
              <Button variant="ghost" size="icon" disabled className="size-8 shrink-0 text-muted-foreground" aria-label={t("more")}><MoreHorizontal /></Button>
            </>
          }
          stickyIntro
          intro={
            <div className="@container/strip">
              {stripOf(
                <div aria-hidden className="flex items-center gap-2">
                  <SkeletonBar className="h-4 w-32 max-sm:hidden" />
                  {["w-36", "w-44", "w-40"].map((width) => <SkeletonBar key={width} className={cn("h-6 rounded-full", width)} />)}
                </div>,
              )}
              {view === "settings" || view === "screen" ? null : <div aria-hidden className="flex items-center gap-1 px-4 pb-3 sm:hidden">{[0, 1, 2].map((at) => <SkeletonBar key={at} className="size-7 rounded-full" />)}</div>}
            </div>
          }
        >
          <ListRowsSkeleton rows={6} height={64} icon={false} label={t("loading")} />
        </LibraryPageShell>
      </PageWrapper>
    );
  }
  if (!open) {
    return (
      <PageWrapper>
        <LibraryPageShell wide icon={ListChecks} title={t("notFound")} trail={[crumb]}>
          <ListEmpty icon={Unlink}>{t("gone")}</ListEmpty>
        </LibraryPageShell>
      </PageWrapper>
    );
  }

  const { screening } = open;
  const facts = ruleFacts({ words, t }, screening, open.isReviewer);
  const reviewers = inOrder(activeReviewers(screening), open.me);
  const total = open.total;
  const workspace = screening.workspace;
  // On Screen a row that came and went would move the paper being read.
  const banner = bannerKind(open, view === "screen");
  const now = passingKind(open, view === "screen");
  // It opens its place in the tabs' row by its width, and closes it as it goes.
  const passing = <AnimatePresence initial={false}>{now ? <Opening across key="now"><Passing kind={now} open={open} workspace={workspace.name} /></Opening> : null}</AnimatePresence>;
  // The people on it: its workspace's people who review it, and whoever it is shared with from outside, to vote or to look. Its models are not people, and are counted with the reviewers on the Overview.
  const on = open.guests + activeReviewers(screening).filter((one) => !one.guest && one.kind === "person").length;
  // A member who isn't one of its reviewers can join it.
  const canJoin = !open.isReviewer && open.canChange && !screening.finishedAt;
  const resume = () => void open.resume();
  const reopen = () => void open.reopen();


  // The screening's menu. It also holds what the bar has no room for: the activity and the export below a wide window, and sharing on a phone, where the bar keeps the title and this menu.
  const more = (
    <DropdownMenu>
      <TooltipHint label={t("more")}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={t("more")}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
      </TooltipHint>
      <DropdownMenuContent align="end" className="w-72 [&_[role=menuitem]]:whitespace-nowrap">
        <ScreeningMenuItems open={open} show={overlays.show} bar />
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // On Papers each face is a switch of its own: it takes that reviewer into the ones the table is narrowed to and shows that it has, and a second press takes them out. With several on, the table shows the papers all of them voted on. From another page a face opens Papers narrowed to that reviewer.
  // A vote named without a reviewer is your own, as the table reads it. The others are in `with`, as the table's address keeps them.
  const others = search.get("with")?.split(",").filter(Boolean) ?? [];
  const first = view === "papers" ? (search.get("reviewer") ?? ((search.get("voted") ?? "any") !== "any" ? open.me : (others[0] ?? null))) : null;
  const narrowedTo = first ? [first, ...others.filter((one) => one !== first)] : [];
  const faceHref = (reviewer: Reviewer) => {
    if (view !== "papers") return papersHref(id, { reviewer: reviewer.id });
    const now = narrowedTo.includes(reviewer.id) ? narrowedTo.filter((one) => one !== reviewer.id) : [...narrowedTo, reviewer.id];
    const next = new URLSearchParams(search);
    // One reviewer's kind of vote stays only while they are still the only one.
    for (const key of ["reviewer", "with", "page", ...(now.length === 1 && now[0] === first ? [] : ["voted"])]) next.delete(key);
    if (now[0]) next.set("reviewer", now[0]);
    if (now.length > 1) next.set("with", now.slice(1).join(","));
    return `${papersHref(id)}${next.size ? `?${next}` : ""}`;
  };

  // Who reviews it, in the bar beside People, which adds to them. On a phone the bar keeps the name and the menu, so they sit under the rule.
  const team = (
    <>
      {/* The workspace is named wherever it isn't the one the person looking works in. */}
      {workspace.id !== here ? <WorkspaceTag size="sm" workspace={lookOf(workspace)} /> : null}
      <Faces
        reviewers={reviewers}
        me={open.me}
        more={{ href: overviewHref(id, "reviewers"), says: t("faces.every") }}
        linkOf={(reviewer) => {
          const on = narrowedTo.includes(reviewer.id);
          const who = { you: String(reviewer.id === open.me), name: reviewer.name };
          return { href: faceHref(reviewer), on, says: on ? t("faces.takeOut", who) : narrowedTo.length ? t("faces.add", who) : votesBy(pieces, reviewer, open.me) };
        }}
      />
      {/* In the bar only in a window wide enough to keep a long name whole beside it: the menu has it at every width. */}
      {canJoin ? <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs max-2xl:hidden" onClick={() => void open.join()}><UserPlus />{t("join")}</Button> : null}
    </>
  );

  // How a paper is decided. From a tablet's width it is one line, and its chips scroll sideways where the line is too short for them. On a phone its name and the way to change it share a line, and the chips wrap under them at the card's whole width, so none is cut. In the settings the form itself says the same.
  const rule = (
    <div className="flex min-w-0 items-center gap-2 max-sm:flex-wrap">
      <span className="flex shrink-0 items-center gap-1 text-sm font-medium">
        {/* Its name shows where the line has room for it: on a line of its own from a tablet up, and beside the pages in a wide window. */}
        <span className="sr-only max-sm:not-sr-only @[48rem]/strip:not-sr-only">{t("rule.title")}</span>
        <Help
          title={t("rule.title")}
          facts={
            <>
              {screening.rule.settle !== "one" ? <HelpFact icon={Users}>{t("rule.conflictsGoTo", { who: words.whoIs(screening, screening.rule.resolver, open.me) })}</HelpFact> : null}
              {screening.living && !screening.finishedAt ? <HelpFact icon={RefreshCw}>{t("rule.checks", { every: screening.living.every })}</HelpFact> : null}
            </>
          }
        >
          <p>{t("rule.chips")}</p>
          <p>{words.t(`settle.means.${screening.rule.settle}`)}</p>{screening.rule.settle === "one" ? null : <p>{t("rule.conflictOpen", { you: String(screening.rule.resolver === open.me), name: words.nameOn(screening, screening.rule.resolver) })}</p>}
          {/* What the third chip stands for, in full, for whoever reads it. */}
          {screening.rule.blind === "after" ? <p>{words.t("votesHiddenSays")}</p> : null}
          {screening.living ? <p>{t("rule.living")}</p> : null}
        </Help>
      </span>
      {/* On a phone the chips are four lines: the Overview shows them, and the other pages keep the one line with the "?" that says the same. */}
      <div className={cn("min-w-0 max-sm:order-last max-sm:basis-full", view !== "overview" && "max-sm:hidden")}>
      <FadeRow scrolls scrollbar="none" className="flex items-center gap-2 max-sm:flex-wrap">
        <LinkChip href={overviewHref(id, "reviewers")} icon={facts.whoIcon} className="shrink-0">{facts.who}</LinkChip>
        <Chip icon={Check}>{facts.when}</Chip>
        {facts.advice ? <Chip icon={AiIcon}>{facts.advice}</Chip> : null}
        <Chip icon={facts.seeIcon}>{facts.see}</Chip>
        {/* Below a laptop's width the bar keeps its room for the name, so "Living" joins these. */}
        {screening.living ? <LinkChip href={overviewHref(id, "new-papers")} icon={RefreshCw} className="shrink-0 lg:hidden">{words.living(screening.living.every)}</LinkChip> : null}
      </FadeRow>
      </div>
      {open.canChange ? <Button asChild variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs max-sm:ms-auto"><NextLink href={settingsHref(id, "decided")}>{t("change")}</NextLink></Button> : null}
    </div>
  );

  // Who the person looking is to it, where that is less than a reviewer who can change it.
  const role = !open.isReviewer
    ? { label: words.looker(open.canChange), icon: Eye, text: open.canChange ? t("role.member", { finished: String(Boolean(screening.finishedAt)) }) : t("role.viewer", { workspace: workspace.name }) }
    : !open.canChange
      ? { label: t("role.guest"), icon: Users, text: t("role.guestSays", { workspace: workspace.name, personal: String(workspace.kind === "personal") }) }
      : null;

  return (
    <MotionConfig reducedMotion="user">
      {/* Screen fits the window from a laptop's width and scrolls inside its own panes, so the site's footer has no page to end there. */}
      <PageWrapper className={view === "screen" ? "lg:[&>footer]:hidden" : undefined}>
        {/* Faces fade in as they load, where they would otherwise appear in one frame. */}
        {/* The screening's name keeps some room in the bar at every width, so it always shows at least in part. */}
        <div ref={frame} className={`contents ${AVATARS_FADE_IN} [&_[data-sticky-page-header]_h1]:min-w-32 @7xl:[&_[data-sticky-page-header]_h1]:min-w-64`}>
          <LibraryPageShell
            wide
            fill={view === "screen"}
            icon={ListChecks}
            title={screening.name}
            trail={[crumb]}
            titleAside={
              <>
                {/* The chip keeps its word at every width: a sign alone, a group of people for a guest, was taken for a button that opens the team. */}
                {role ? (
                  <span className="flex items-center gap-0.5">
                    <Chip icon={role.icon}>{role.label}</Chip>
                    <Help title={role.label}>{role.text}</Help>
                  </span>
                ) : null}
                {/* A living screening says so beside its name, as its row in the list does, and opens its checks. Below a laptop's width the chip is with the rule's. */}
                {screening.living ? <LinkChip href={overviewHref(id, "new-papers")} icon={RefreshCw} className="max-lg:hidden">{/* Beside the name, what it means is said where the bar has the room for both. */}{t.rich("rule.livingChip", { every: screening.living.every, more: (chunks) => <span className="max-[87.5rem]:hidden">{chunks}</span> })}</LinkChip> : null}
                {/* On a phone the menu ends the title's row, as an app bar's does. */}
                <span className="flex sm:hidden">{more}</span>
              </>
            }
            actions={
              <>
                {/* On Screen a narrow window keeps the bar for the name: the paper is what is being read. */}
                <div className={cn("flex items-center gap-2 border-e border-border-subtle pe-3 max-sm:hidden", view === "screen" && "max-lg:hidden")}>{team}</div>
                {/* Below a wide window these two are in the menu, so the name keeps its room. */}
                <Button variant="outline" size="sm" className="max-xl:hidden" onClick={() => overlays.show("activity")}><History />{t("activity")}</Button>
                <Button variant="outline" size="sm" className="max-xl:hidden" onClick={() => overlays.show("export")}><Download />{t("export")}</Button>
                {/* Everyone on it, and where anyone is added: a reviewer, a model, or someone it is shared with. Icon-only, it keeps its count, so it is as wide as both. */}
                <Button variant="outline" size="sm" className="max-sm:hidden @max-3xl:px-2" aria-label={t("peopleOn", { count: words.num(on) })} onClick={() => overlays.show("people")}>
                  <Users /><span className={BAR_LABEL}>{t("people")}</span>
                  {on ? <span className="ms-0.5 rounded-full bg-muted px-1.5 text-2xs tabular-nums">{words.num(on)}</span> : null}
                </Button>
                <span className="flex max-sm:hidden">{more}</span>
              </>
            }
            stickyIntro
            intro={
              <div ref={strip} className="@container/strip">
                {stripOf(rule, passing)}
                {view === "settings" || view === "screen" ? null : <div className="flex items-center gap-2 px-4 pb-3 sm:hidden">{team}</div>}
                {/* The row is for what asks something of the person: it slides in and out, and changes only when the screening's state does. What passes by itself is the chip in the tabs' row. */}
                <AutoHeight>
                  <Banner kind={banner} open={open} workspace={workspace.name} onReopen={reopen} onResume={resume} />
                </AutoHeight>
              </div>
            }
          >
            {/* Each page rises in as it opens. */}
            <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className={view === "screen" ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col" : undefined}>
              <Workspace value={{ open, exportTo: overlays.exportTo, finish: () => overlays.show("finish"), openActivity: () => overlays.show("activity") }}>{children}</Workspace>
            </motion.div>
          </LibraryPageShell>
        </div>

        {overlays.overlays}
      </PageWrapper>
    </MotionConfig>
  );
}


/**
 * What the screening asks of the person looking: it is out of credits, paused or finished, or new papers of theirs
 * came in. Each has the row under the tabs, with what to do about it. Who the person is to it is a chip beside its
 * title, not one of these.
 */
type BannerKind = "credits" | "finished" | "paused" | "arrived";
/** Which one thing the row under the tabs says. `quiet`, on Screen, leaves out the papers that came in: a row arriving there would move the paper being read. */
function bannerKind(open: Open, quiet: boolean): BannerKind | null {
  // What the models are doing is the one answer the list's row and the Overview read too.
  const { screening, modelsNow } = open;
  if (modelsNow === "credits") return "credits";
  if (screening.finishedAt) return "finished";
  if (modelsNow === "paused") return "paused";
  if (!quiet && open.latest?.mine) return "arrived";
  return null;
}
/**
 * What comes and goes by itself as papers arrive and models read: nobody has to do anything about it. It is a chip
 * at the end of the tabs' row, which takes no row of its own, so nothing under the tabs moves when it comes or goes.
 */
type PassingKind = "gathering" | "checking" | "waiting" | "reading" | "nothing" | "arrived";
function passingKind(open: Open, quiet: boolean): PassingKind | null {
  const { modelsNow } = open;
  if (modelsNow === "gathering" || modelsNow === "checking" || modelsNow === "waiting" || modelsNow === "reading") return modelsNow;
  // On Screen, where the row for it would move the paper being read, the papers that came in for the person are said here: a queue that grew says why.
  if (quiet && !open.screening.finishedAt && open.latest?.mine) return "arrived";
  // A check that found nothing says so, where nothing else has to be said.
  if (open.lastCheck?.added === 0 && Date.now() - open.lastCheck.at < NOTHING_SHOWN_MS) return "nothing";
  return null;
}

/** How long the row says a check found nothing: long enough for whoever asked for it to read it. */
const NOTHING_SHOWN_MS = 60_000;

/** Each kind of notice in the colour of what it is about: what waits for you is primary, a stop is warning, the rest are facts. */
const BANNER_TONE: Record<BannerKind, Tone> = { credits: "warning", finished: "neutral", paused: "warning", arrived: "primary" };

function Banner({ kind, open, workspace, onReopen, onResume }: { kind: BannerKind | null; open: Open; workspace: string; onReopen: () => void; onResume: () => void }) {
  const { screening, reading, total } = open;
  const id = screening.id;
  const t = useTranslations("screening.frame");
  const pieces = useTranslations("screening.pieces");
  const list = useTranslations("screening.list");
  const words = useWords();
  const format = useFormatter();
  if (!kind) return null;
  const tone = TONE[BANNER_TONE[kind]];
  // Every kind of row is as tall as the tallest, the one with a button: one giving way to another moves nothing under it.
  const row = cn("flex min-h-[3.25rem] flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle px-4 py-2.5 text-sm sm:px-6", tone.panel);
  const icon = cn("size-4 shrink-0", tone.ink);
  const modelLink = (model: Reviewer) => <NextLink key={model.id} href={papersHref(id, { reviewer: model.id })} className={INLINE_LINK}>{model.name}</NextLink>;
  // Their names as a list, each a link.
  const models = (list: Reviewer[]) => format.list(list.map(modelLink), { type: "conjunction" });
  if (kind === "arrived" && open.latest) {
    return (
      <div className={row}>
        <RefreshCw className={icon} />
        <span>{t.rich("banner.arrived", { count: open.latest.added, ago: words.ago(open.latest.at), link: (chunks) => <NextLink href={papersHref(id, { added: open.latest!.id })} className={INLINE_LINK}>{chunks}</NextLink> })}</span>
        <Button asChild variant="outline" size="sm"><NextLink href={screenHref(id, { order: "fresh" })}><ListChecks />{t("banner.screenNew", { count: open.latest.mine })}</NextLink></Button>
      </div>
    );
  }
  if (kind === "credits") {
    return (
      <div className={row}>
        <Coins className={icon} />
        <span className="flex items-center gap-1 font-medium">
          {pieces("modelsSay.credits.says")}
          <Help title={pieces("modelsSay.credits.says")} facts={reading.map((model) => <HelpFact key={model.id} icon={Coins}>{t("banner.modelPrice", { name: model.name, price: perPaper({ words, t: list }, model.model!) })}</HelpFact>)}>
            {t("banner.creditsHelp", { you: String(open.canChange), workspace })}
          </Help>
        </span>
        <span className="text-muted-foreground">{t.rich("banner.stoppedAt", { done: modelsRead(reading, total).done, of: modelsRead(reading, total).of, models: () => models(reading) })}</span>
        {/* With credits added, the models are let go on from where they stopped. */}
        {open.canChange ? <Button asChild variant="outline" size="sm"><NextLink href="/settings/billing"><Coins />{t("addCredits")}</NextLink></Button> : null}
        {open.canChange ? <Button variant="outline" size="sm" onClick={onResume}><Play />{t("resumeModels")}</Button> : null}
      </div>
    );
  }
  if (kind === "finished" && screening.finishedAt) {
    const at = screening.finishedAt;
    return (
      <div className={row}>
        <CircleCheck className={icon} />
        <span className="flex items-center gap-1 font-medium">
          {words.ago(at) === words.day(at) ? t("banner.finishedOn", { day: words.day(at) }) : t("banner.finishedAgo", { ago: words.ago(at) })}
          <Help title={t("banner.finishedTitle")}>{t("banner.finishedHelp", { member: String(open.canChange), workspace })}</Help>
        </span>
        {open.canChange && growing(screening).length ? <Button variant="outline" size="sm" onClick={() => void open.check()}><RefreshCw />{t("checkNew")}</Button> : null}
        {open.canChange ? <Button variant="outline" size="sm" onClick={onReopen}><RotateCcw />{t("reopen")}</Button> : null}
      </div>
    );
  }
  if (kind === "paused") {
    const read = modelsRead(modelsOf(screening), total);
    return (
      <div className={row}>
        <CirclePause className={icon} />
        <span className="flex items-center gap-1 font-medium">
          {pieces("modelsSay.paused.says")}
          <Help title={t("banner.pausedTitle")}>{t("banner.pausedHelp", { member: String(open.canChange), workspace })}</Help>
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{t("banner.papersRead", { done: read.done, of: read.of })}</span>
        {open.canChange ? <Button variant="outline" size="sm" onClick={onResume}><Play />{t("resumeModels")}</Button> : null}
      </div>
    );
  }
  return null;
}

/**
 * What the screening is doing by itself right now, in a chip: its papers are arriving, its sources are being
 * checked, its models wait their turn or are reading, or the last check found nothing. On a narrow strip the chip
 * keeps its sign and its figures, and its words are for a screen reader.
 */
function Passing({ kind, open, workspace }: { kind: PassingKind; open: Open; workspace: string }) {
  const { screening, reading, total } = open;
  const t = useTranslations("screening.frame");
  const words = useWords();
  const pieces = useTranslations("screening.pieces");
  const says = "@max-[34rem]/strip:sr-only";
  const figures = "tabular-nums text-muted-foreground";
  if (kind === "checking" && screening.checking) {
    return <Chip icon={RefreshCw} className="shrink-0 whitespace-nowrap"><span className={says}>{pieces("modelsSay.checking.says")}</span><span className={figures}>{t("banner.checked", { done: screening.checking.done, of: screening.checking.of })}</span></Chip>;
  }
  if (kind === "gathering" && open.gathering) {
    return <Chip icon={Search} className="shrink-0 whitespace-nowrap"><span className={says}>{pieces("modelsSay.gathering.says")}</span><span className={figures}>{t.rich("banner.counting", { of: open.gathering.of, done: () => <AnimatedNumber value={open.gathering!.done} /> })}</span></Chip>;
  }
  if (kind === "waiting" && open.waitingFor) {
    return (
      <Chip icon={Clock} className="shrink-0 whitespace-nowrap">
        <span>{pieces.rich("modelsSay.waiting.says", { name: open.waitingFor.name, link: (chunks) => <NextLink href={overviewHref(open.waitingFor!.id)} className={cn(INLINE_LINK, "inline-block max-w-40 truncate align-bottom")}>{chunks}</NextLink> })}</span>
        <Help title={t("banner.turnsTitle")} facts={<HelpFact icon={ListChecks}>{t("banner.atATime", { count: open.atOnce })}</HelpFact>}>
          {t("banner.turnsHelp", { workspace, count: open.atOnce })}
        </Help>
      </Chip>
    );
  }
  if (kind === "reading") {
    const read = modelsRead(reading, total);
    return (
      <Chip className="shrink-0 whitespace-nowrap">
        <AiIcon working className="size-3.5 shrink-0" />
        <span className={says}>{reading.length === 1 ? t.rich("banner.modelReading", { name: reading[0]!.name, model: () => <NextLink href={papersHref(screening.id, { reviewer: reading[0]!.id })} className={INLINE_LINK}>{reading[0]!.name}</NextLink> }) : t("banner.modelsReading", { count: reading.length })}</span>
        <span className={figures}>{t("banner.read", { done: read.done, of: read.of })}</span>
      </Chip>
    );
  }
  if (kind === "nothing") return <Chip icon={RefreshCw} className="shrink-0 whitespace-nowrap">{t("banner.nothing")}</Chip>;
  if (kind === "arrived" && open.latest) return <StateChip tone="primary" icon={RefreshCw} className="shrink-0 whitespace-nowrap">{t("banner.arrivedForYou", { count: open.latest.mine, ago: words.ago(open.latest.at) })}</StateChip>;
  return null;
}
