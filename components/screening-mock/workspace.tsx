"use client";

// An open screening, across the whole window: the frame its four pages share (Overview, Screen, Papers
// and Settings, each at its own address). Its reviewers, its settings and its state can change at any time from here.

import { createContext, use, useLayoutEffect, useRef, type ReactNode } from "react";
import { MotionConfig, motion } from "motion/react";
import { useParams, useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import { PenLine, AiIcon, BarChart3, Check, CircleCheck, CirclePause, Clock, Coins, Copy, Download, Eye, History, ListChecks, Lock, MoreHorizontal, Move, Play, RefreshCw, RotateCcw, Search, Settings2, Table2, Trash2, Unlink, UserPlus, Users } from "@/components/icons";
import { ListEmpty, ListLoading } from "@/components/evidence-libraries/list-controls";
import { BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { AnimatedNumber, Chip, Meter } from "@/components/screening/parts";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { AutoHeight } from "@/components/ui/auto-height";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FadeRow } from "@/components/ui/fade-row";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpFact } from "@/components/ui/help";
import { TooltipHint } from "@/components/ui/tooltip";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { bareWorkspacePath } from "@/lib/workspaces/paths";
import { useWorkspace as usePageWorkspace } from "@/lib/workspaces/url";
import { cn } from "@/lib/utils";
import { plural, inOrder, num, SETTLE_MEANS, SETTLE_SAYS, readersOf, EVERY_LABEL, livingSays, day, growing, activeReviewers, modelsOf, type Reviewer, type Screening, lookOf, ago, whoIs, settlerSettles, lookerLabel, VOTES_HIDDEN_SAYS } from "./data";
import type { ExportTab } from "./dialogs";
import { useKept } from "./drafts";
import { SCREENINGS, SCREENINGS_CRUMB, newHref, overviewHref, papersHref, screenHref, settingsHref } from "./links";
import { useScreeningOverlays } from "./overlays";
import { Faces, votesBy, StateChip, Help, LinkChip, TONE, TabCount, type Tone, MODELS_SAY, INLINE_LINK } from "./parts";
import { useOpenScreening, type Open, modelsDone, perPaper } from "./store";

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
function ruleFacts(screening: Screening, voter: boolean) {
  const [{ each }, models] = [readersOf(screening), modelsOf(screening).length];
  const readers = [each ? `${plural(each, "person", "people")}` : null, models ? `${models} AI ${models === 1 ? "model" : "models"}` : null].filter(Boolean).join(" and ");
  return {
    who: readers ? `Each paper: ${readers}` : "No reviewer yet",
    whoIcon: each ? Users : AiIcon,
    when: SETTLE_SAYS[screening.rule.settle],
    // Votes are hidden on the papers that wait for a reviewer's own vote, which is their To do: the chip names that queue, a word the page shows, and promises nothing. Someone who doesn't vote here sees every vote: their chip says what holds for the reviewers.
    see: screening.rule.blind === "after" ? (voter ? "Votes hidden in your To do" : "Votes hidden in reviewers' To do") : "Votes visible to all",
    seeIcon: screening.rule.blind === "after" ? Lock : Eye,
  };
}

export function ScreeningWorkspace({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
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
    // A link to a part of the page is followed before the strip's height is known, and the strip can still settle after that (its notice arriving). Until the person first touches the page, the part the address names lands again under the strip as it is now.
    let untouched = true;
    const touched = () => { untouched = false; };
    const write = () => {
      root.style.setProperty("--screening-frame", held.parentElement && getComputedStyle(held.parentElement).position === "sticky" ? `${held.offsetHeight}px` : "0px");
      if (untouched && window.location.hash) document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(held);
    window.addEventListener("resize", write);
    for (const kind of ["wheel", "keydown", "pointerdown", "touchstart"]) window.addEventListener(kind, touched, { once: true, passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", write);
      for (const kind of ["wheel", "keydown", "pointerdown", "touchstart"]) window.removeEventListener(kind, touched);
    };
  }, [found]);

  // While it is read the frame holds its place: the bar with the list's name, and the room a screening's pages take.
  if (read === undefined) {
    return (
      <PageWrapper>
        <LibraryPageShell wide icon={ListChecks} title="Screening" trail={[SCREENINGS_CRUMB]}>
          <ListLoading label="Loading the screening" />
        </LibraryPageShell>
      </PageWrapper>
    );
  }
  if (!open) {
    return (
      <PageWrapper>
        <LibraryPageShell wide icon={ListChecks} title="Not found" trail={[SCREENINGS_CRUMB]}>
          <ListEmpty icon={Unlink}>This screening was deleted, or isn&apos;t shared with you</ListEmpty>
        </LibraryPageShell>
      </PageWrapper>
    );
  }

  const { screening } = open;
  const facts = ruleFacts(screening, open.isReviewer);
  const reviewers = inOrder(activeReviewers(screening), open.me);
  const total = open.total;
  const workspace = screening.workspace;
  // On Screen a row that came and went would move the paper being read.
  const banner = bannerKind(open, view === "screen");
  // Everyone on it: its workspace's people who review it, its models, and whoever it is shared with from outside, to vote or to look.
  const on = open.guests + activeReviewers(screening).filter((one) => !one.guest).length;
  // A member who isn't one of its reviewers can join it.
  const canJoin = !open.isReviewer && open.canChange && !screening.finishedAt;
  const resume = () => void open.resume();
  const reopen = () => void open.reopen();

  // The pages. Beside the rule they are a compact group; where the card is too narrow for both they take a line of their own, each as wide as its share.
  const pages = (fill: boolean) => (
    <Segmented
      label="Pages of this screening"
      value={view}
      fill={fill ? "labels" : false}
      // On a phone the labels go without their icons and the four stay on one line. Where large counts or an unsaved mark make that line longer than the screen, it scrolls sideways.
      className={fill ? "@max-[30rem]:w-max @max-[30rem]:min-w-full @max-[30rem]:flex-nowrap @max-[30rem]:*:gap-1.5 @max-[30rem]:*:px-2 @max-[30rem]:[&_svg]:hidden" : undefined}
      options={[
        { id: "overview", label: "Overview", icon: BarChart3, href: overviewHref(id) },
        { id: "screen", label: "Screen", icon: ListChecks, href: screenHref(id), detail: open.toDo ? <TabCount value={open.toDo} tone="primary" /> : undefined },
        { id: "papers", label: "Papers", icon: Table2, href: papersHref(id), detail: <span className="tabular-nums text-muted-foreground">{num(total)}</span> },
        // Only someone who may change it has its settings.
        ...(open.canChange ? [{ id: "settings" as const, label: "Settings", icon: Settings2, href: settingsHref(id), detail: unsaved ? <StateChip tone="warning" icon={PenLine} className="h-5 px-1.5 text-2xs">Unsaved</StateChip> : undefined }] : []),
      ]}
    />
  );

  // The screening's menu. It also holds what the bar has no room for: the activity and the export below a wide window, and sharing on a phone, where the bar keeps the title and this menu.
  const more = (
    <DropdownMenu>
      <TooltipHint label="More">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label="More"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
      </TooltipHint>
      <DropdownMenuContent align="end" className="w-72 [&_[role=menuitem]]:whitespace-nowrap">
        <DropdownMenuItem className="xl:hidden" onSelect={() => overlays.show("activity")}><History />Activity</DropdownMenuItem>
        <DropdownMenuItem className="xl:hidden" onSelect={() => overlays.show("export")}><Download />Export</DropdownMenuItem>
        <DropdownMenuItem className="sm:hidden" onSelect={() => overlays.show("people")}><Users />People</DropdownMenuItem>
        <DropdownMenuSeparator className="xl:hidden" />
        {/* Someone it is shared with from outside can start their own from it, and nothing else here. */}
        {open.canChange ? (
          <>
            {screening.finishedAt ? (
              <DropdownMenuItem onSelect={reopen}><RotateCcw />Reopen</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => overlays.show("finish")}><CircleCheck />Mark as finished</DropdownMenuItem>
            )}
            {modelsOf(screening).length && !screening.finishedAt ? (
              screening.paused ? (
                <DropdownMenuItem onSelect={resume}><Play />Resume models</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void open.pause()}><CirclePause />Pause models</DropdownMenuItem>
              )
            ) : null}
            {growing(screening).length ? <DropdownMenuItem disabled={Boolean(screening.checking)} onSelect={() => void open.check()}><RefreshCw />Check for new papers</DropdownMenuItem> : null}
          </>
        ) : null}
        <DropdownMenuItem asChild><NextLink href={newHref(id)}><Copy />Duplicate as a new screening</NextLink></DropdownMenuItem>
        {open.canChange ? (
          <>
            <DropdownMenuItem onSelect={() => overlays.show("move")}><Move />Move to another workspace</DropdownMenuItem>
            {/* In the widest windows the bar has this as a button. */}
            {canJoin ? <DropdownMenuItem className="2xl:hidden" onSelect={() => void open.join()}><UserPlus />Join as a reviewer</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => overlays.show("delete")}><Trash2 />Delete</DropdownMenuItem>
          </>
        ) : null}
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
        more={{ href: overviewHref(id, "reviewers"), says: "Every reviewer" }}
        linkOf={(reviewer) => {
          const on = narrowedTo.includes(reviewer.id);
          const who = reviewer.id === open.me ? "yourself" : reviewer.name;
          return { href: faceHref(reviewer), on, says: on ? `Take ${who} out of the filter` : narrowedTo.length ? `Add ${who} to the filter` : votesBy(reviewer, open.me) };
        }}
      />
      {/* In the bar only in a window wide enough to keep a long name whole beside it: the menu has it at every width. */}
      {canJoin ? <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs max-2xl:hidden" onClick={() => void open.join()}><UserPlus />Join as a reviewer</Button> : null}
    </>
  );

  // How a paper is decided. From a tablet's width it is one line, and its chips scroll sideways where the line is too short for them. On a phone its name and the way to change it share a line, and the chips wrap under them at the card's whole width, so none is cut. In the settings the form itself says the same.
  const rule = (
    <div className="flex min-w-0 items-center gap-2 max-sm:flex-wrap">
      <span className="flex shrink-0 items-center gap-1 text-sm font-medium">
        {/* Its name shows where the line has room for it: on a line of its own from a tablet up, and beside the pages in a wide window. */}
        <span className="sr-only max-sm:not-sr-only @[48rem]/strip:not-sr-only @[76rem]/strip:sr-only @[92rem]/strip:not-sr-only">How a paper is decided</span>
        <Help
          title="How a paper is decided"
          facts={
            <>
              {screening.rule.settle !== "one" ? <HelpFact icon={Users}>Conflicts go to {whoIs(screening, screening.rule.resolver, open.me)}</HelpFact> : null}
              {screening.living ? <HelpFact icon={RefreshCw}>Checks for new papers {EVERY_LABEL[screening.living.every].toLowerCase()}</HelpFact> : null}
            </>
          }
        >
          <p>Each paper gets the votes named in these chips, and is settled once they are in.</p>
          <p>{SETTLE_MEANS[screening.rule.settle]}</p>{screening.rule.settle === "one" ? null : <p>A paper in conflict stays open until {settlerSettles(screening, open.me)} it.</p>}
          {/* What the third chip stands for, in full, for whoever reads it. */}
          {screening.rule.blind === "after" ? <p>{VOTES_HIDDEN_SAYS}</p> : null}
          {screening.living ? <p>A living screening checks its sources for new papers on a schedule and screens what is new. Uploaded files and pasted lists never gain papers.</p> : null}
        </Help>
      </span>
      {/* On a phone the chips are four lines: the Overview shows them, and the other pages keep the one line with the "?" that says the same. */}
      <div className={cn("min-w-0 max-sm:order-last max-sm:basis-full", view !== "overview" && "max-sm:hidden")}>
      <FadeRow scrolls scrollbar="none" className="flex items-center gap-2 max-sm:flex-wrap">
        <LinkChip href={overviewHref(id, "reviewers")} icon={facts.whoIcon} className="shrink-0">{facts.who}</LinkChip>
        <Chip icon={Check}>{facts.when}</Chip>
        <Chip icon={facts.seeIcon}>{facts.see}</Chip>
        {/* Below a laptop's width the bar keeps its room for the name, so "Living" joins these. */}
        {screening.living ? <LinkChip href={overviewHref(id, "new-papers")} icon={RefreshCw} className="shrink-0 lg:hidden">{livingSays(screening.living.every)}</LinkChip> : null}
      </FadeRow>
      </div>
      {open.canChange ? <Button asChild variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs max-sm:ms-auto"><NextLink href={settingsHref(id, "decided")}>Change</NextLink></Button> : null}
    </div>
  );

  // Who the person looking is to it, where that is less than a reviewer who can change it.
  const role = !open.isReviewer
    ? { label: lookerLabel(open.canChange), icon: Eye, text: open.canChange ? `You see every paper and every vote. You aren't one of its reviewers, so you get no papers to vote on.${screening.finishedAt ? "" : " Join as a reviewer to get some."}` : `${workspace.name} shared it with you. You see every paper and every vote, and you get no papers to vote on.` }
    : !open.canChange
      ? { label: "Guest", icon: Users, text: `${workspace.name} shared it with you. You vote on the papers you get. Only ${workspace.name}'s members change its settings.` }
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
            trail={[SCREENINGS_CRUMB]}
            titleAside={
              <>
                {/* On a phone the chip is its icon, with its "?": the name keeps the room. */}
                {role ? (
                  <span className="flex items-center gap-0.5">
                    <Chip icon={role.icon}><span className="@max-[30rem]:sr-only">{role.label}</span></Chip>
                    <Help title={role.label}>{role.text}</Help>
                  </span>
                ) : null}
                {/* A living screening says so beside its name, as its row in the list does, and opens its checks. Below a laptop's width the chip is with the rule's. */}
                {screening.living ? <LinkChip href={overviewHref(id, "new-papers")} icon={RefreshCw} className="max-lg:hidden">Living{/* Beside the name, what it means is said where the bar has the room for both. */}<span className="max-[87.5rem]:hidden">, new papers {EVERY_LABEL[screening.living.every].toLowerCase()}</span></LinkChip> : null}
                {/* On a phone the menu ends the title's row, as an app bar's does. */}
                <span className="flex sm:hidden">{more}</span>
              </>
            }
            actions={
              <>
                {/* On Screen a narrow window keeps the bar for the name: the paper is what is being read. */}
                <div className={cn("flex items-center gap-2 border-e border-border-subtle pe-3 max-sm:hidden", view === "screen" && "max-lg:hidden")}>{team}</div>
                {/* Below a wide window these two are in the menu, so the name keeps its room. */}
                <Button variant="outline" size="sm" className="max-xl:hidden" onClick={() => overlays.show("activity")}><History />Activity</Button>
                <Button variant="outline" size="sm" className="max-xl:hidden" onClick={() => overlays.show("export")}><Download />Export</Button>
                {/* Everyone on it, and where anyone is added: a reviewer, a model, or someone it is shared with. Icon-only, it keeps its count, so it is as wide as both. */}
                <Button variant="outline" size="sm" className="max-sm:hidden @max-3xl:px-2" aria-label={`People, ${num(on)} on this screening`} onClick={() => overlays.show("people")}>
                  <Users /><span className={BAR_LABEL}>People</span>
                  {on ? <span className="ms-0.5 rounded-full bg-muted px-1.5 text-2xs tabular-nums">{on}</span> : null}
                </Button>
                <span className="flex max-sm:hidden">{more}</span>
              </>
            }
            stickyIntro
            intro={
              <div ref={strip} className="@container/strip">
                {/* One strip under the bar: the pages, then how a paper is decided. Where the card is too narrow for both on a line, the pages take the first and the rule the second. */}
                <div className="border-b border-border-subtle px-4 py-3 sm:px-6 @[76rem]/strip:hidden"><FadeRow scrolls scrollbar="none" keepInView="[aria-current=page]">{pages(true)}</FadeRow></div>
                {/* On Screen from a laptop's width the window's height goes to the paper: the rule shows only where it shares the pages' line. */}
                <div className={cn("flex items-center gap-x-6 px-4 py-3 sm:px-6", view === "settings" && "@max-[76rem]/strip:hidden", view === "screen" && "max-sm:hidden lg:@max-[76rem]/strip:hidden")}>
                  <div className="shrink-0 @max-[76rem]/strip:hidden">{pages(false)}</div>
                  {view === "settings" ? null : <div className="min-w-0 @[76rem]/strip:ms-auto">{rule}</div>}
                </div>
                {view === "settings" || view === "screen" ? null : <div className="flex items-center gap-2 px-4 pb-3 sm:hidden">{team}</div>}
                {/* The row comes and goes as the models start and finish: it slides, so nothing under it jumps. */}
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


/** What the screening is doing now, which a person may need to act on. Who the person is to it is a chip beside its title, not one of these. */
type BannerKind = "gathering" | "checking" | "credits" | "finished" | "paused" | "arrived" | "waiting" | "reading" | "nothing";
/** Which one thing the row under the bar says. `quiet` leaves out what comes and goes as models read and papers arrive: on Screen and in the settings that row would move what is being read or changed. */
function bannerKind(open: Open, quiet: boolean): BannerKind | null {
  // What the models are doing is the one answer the list's row and the Overview read too.
  const { screening, modelsNow } = open;
  if (modelsNow === "gathering" || modelsNow === "checking" || modelsNow === "credits") return modelsNow;
  if (screening.finishedAt) return "finished";
  if (modelsNow === "paused") return "paused";
  if (quiet) return null;
  if (open.latest?.mine) return "arrived";
  if (modelsNow === "waiting" || modelsNow === "reading") return modelsNow;
  // A check that found nothing says so, where nothing else has to be said.
  if (open.lastCheck?.added === 0 && Date.now() - open.lastCheck.at < NOTHING_SHOWN_MS) return "nothing";
  return null;
}

/** How long the row says a check found nothing: long enough for whoever asked for it to read it. */
const NOTHING_SHOWN_MS = 60_000;

/** Each kind of notice in the colour of what it is about: what waits for you is primary, a stop is warning, the rest are facts. */
const BANNER_TONE: Record<BannerKind, Tone> = { gathering: "neutral", checking: "neutral", credits: "warning", finished: "neutral", paused: "warning", arrived: "primary", waiting: "neutral", reading: "neutral", nothing: "neutral" };

function Banner({ kind, open, workspace, onReopen, onResume }: { kind: BannerKind | null; open: Open; workspace: string; onReopen: () => void; onResume: () => void }) {
  const { screening, reading, total } = open;
  const id = screening.id;
  if (!kind) return null;
  const tone = TONE[BANNER_TONE[kind]];
  // Every kind of row is as tall as the tallest, the one with a button: one giving way to another moves nothing under it.
  const row = cn("flex min-h-[3.25rem] flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle px-4 py-2.5 text-sm sm:px-6", tone.panel);
  const icon = cn("size-4 shrink-0", tone.ink);
  const modelLink = (model: Reviewer) => <NextLink key={model.id} href={papersHref(id, { reviewer: model.id })} className={INLINE_LINK}>{model.name}</NextLink>;
  const models = (list: Reviewer[]) => list.map((model, i) => <span key={model.id}>{i ? (i === list.length - 1 ? " and " : ", ") : null}{modelLink(model)}</span>);
  if (kind === "checking" && screening.checking) {
    return (
      <div className={row}>
        <RefreshCw className={icon} />
        <span className="font-medium">{MODELS_SAY.checking.says}</span>
        <Meter value={screening.checking.done} max={screening.checking.of} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground">{screening.checking.done} of {plural(screening.checking.of, "source", "sources")} checked</span>
      </div>
    );
  }
  if (kind === "arrived" && open.latest) {
    return (
      <div className={row}>
        <RefreshCw className={icon} />
        <span><NextLink href={papersHref(id, { added: open.latest.id })} className={INLINE_LINK}>{open.latest.added} new {open.latest.added === 1 ? "paper" : "papers"}</NextLink> came in {ago(open.latest.at)}</span>
        <Button asChild variant="outline" size="sm"><NextLink href={screenHref(id, { order: "fresh" })}><ListChecks />Screen your {open.latest.mine} new {open.latest.mine === 1 ? "paper" : "papers"} first</NextLink></Button>
      </div>
    );
  }
  if (kind === "nothing") {
    return (
      <div className={row}>
        <RefreshCw className={icon} />
        <span className="font-medium">The last check found no new papers</span>
      </div>
    );
  }
  if (kind === "gathering" && open.gathering) {
    return (
      <div className={row}>
        <Search className={icon} />
        <span className="font-medium">{MODELS_SAY.gathering.says}</span>
        <Meter value={open.gathering.done} max={open.gathering.of} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground"><AnimatedNumber value={open.gathering.done} /> of {num(open.gathering.of)}</span>
        {/* Offered once one of the papers that are in is theirs to vote on. */}{open.isReviewer && open.toDo ? <Button asChild variant="outline" size="sm"><NextLink href={screenHref(id)}><ListChecks />Screen the papers that are in</NextLink></Button> : null}
      </div>
    );
  }
  if (kind === "credits") {
    return (
      <div className={row}>
        <Coins className={icon} />
        <span className="flex items-center gap-1 font-medium">
          {MODELS_SAY.credits.says}
          <Help title={MODELS_SAY.credits.says} facts={reading.map((model) => <HelpFact key={model.id} icon={Coins}>{model.name}, {perPaper(model.model!)}</HelpFact>)}>
            A model stops when the workspace can&apos;t pay for its next paper. Its votes so far stay, and it carries on from where it stopped once {open.canChange ? "you add credits" : `${workspace} adds credits`}.
          </Help>
        </span>
        <span className="text-muted-foreground">{models(reading)} stopped at {num(modelsDone(reading))} of {num(total)} papers</span>
        {/* With credits added, the models are let go on from where they stopped. */}
        {open.canChange ? <Button asChild variant="outline" size="sm"><NextLink href="/settings/billing"><Coins />Add credits</NextLink></Button> : null}
        {open.canChange ? <Button variant="outline" size="sm" onClick={onResume}><Play />Resume models</Button> : null}
      </div>
    );
  }
  if (kind === "finished" && screening.finishedAt) {
    const at = screening.finishedAt;
    return (
      <div className={row}>
        <CircleCheck className={icon} />
        <span className="flex items-center gap-1 font-medium">
          Finished {ago(at) === day(at) ? `on ${day(at)}` : ago(at)}
          <Help title="Finished screening">Its models stop reading and it stops checking for new papers. {open.canChange ? "You can still read, export and change it, or reopen it." : `You can still read and export it. A member of ${workspace} can reopen it.`}</Help>
        </span>
        {open.canChange && growing(screening).length ? <Button variant="outline" size="sm" onClick={() => void open.check()}><RefreshCw />Check for new papers</Button> : null}
        {open.canChange ? <Button variant="outline" size="sm" onClick={onReopen}><RotateCcw />Reopen</Button> : null}
      </div>
    );
  }
  if (kind === "paused") {
    const done = modelsDone(modelsOf(screening));
    return (
      <div className={row}>
        <CirclePause className={icon} />
        <span className="flex items-center gap-1 font-medium">
          {MODELS_SAY.paused.says}
          <Help title="Paused models">Paused models read nothing and spend no credits. People can keep voting. {open.canChange ? "Resume the models to have them read on." : `A member of ${workspace} can resume them.`}</Help>
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{num(done)} of {num(total)} papers read</span>
        {open.canChange ? <Button variant="outline" size="sm" onClick={onResume}><Play />Resume models</Button> : null}
      </div>
    );
  }
  if (kind === "waiting" && open.waitingFor) {
    return (
      <div className={row}>
        <Clock className={icon} />
        <span className="flex items-center gap-1">
          <span className="font-medium">{MODELS_SAY.waiting.says} <NextLink href={overviewHref(open.waitingFor.id)} className={INLINE_LINK}>{open.waitingFor.name}</NextLink></span>
          <Help title="Models take turns" facts={<HelpFact icon={ListChecks}>40 papers at a time</HelpFact>}>
            {workspace}&apos;s models read 40 papers at a time, so a screening started while another is reading waits for it. People can vote in the meantime.
          </Help>
        </span>
        <Meter value={open.waitingFor.done} max={open.waitingFor.of} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground"><AnimatedNumber value={open.waitingFor.done} /> of {num(open.waitingFor.of)}</span>
      </div>
    );
  }
  if (kind === "reading") {
    const done = modelsDone(reading);
    return (
      <div className={row}>
        <AiIcon working className="size-4 shrink-0" />
        <span className="font-medium">{reading.length === 1 ? modelLink(reading[0]!) : `${reading.length} models`} reading</span>
        <Meter value={done} max={total} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground">{num(done)} of {num(total)}</span>
      </div>
    );
  }
  return null;
}
