"use client";

// An open screening, across the whole window: the frame its four pages share (Overview, Screen, Papers
// and Settings, each at its own address). Its reviewers, its settings and its state can change at any time from here.

import { createContext, use, useEffect, type ComponentProps, type ReactNode } from "react";
import { MotionConfig, motion } from "motion/react";
import NextLink from "next/link";
import { useParams, useRouter, useSelectedLayoutSegment } from "next/navigation";
import { AiIcon, BarChart3, Check, CircleCheck, CirclePause, Clock, Coins, Copy, Download, Eye, History, ListChecks, Lock, MoreHorizontal, Move, Play, RefreshCw, RotateCcw, Search, Settings2, Share2, Table2, Trash2, Unlink, UserPlus, Users } from "@/components/icons";
import { ListEmpty } from "@/components/evidence-libraries/list-controls";
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
import { WorkspaceTag } from "@/components/workspaces/parts";
import { cn } from "@/lib/utils";
import { EVERY_LABEL, HOME, NOW, day, growing, workspaceOf, activeReviewers, invitedReviewer, modelReviewer, modelsOf, peopleOf, personOf, personReviewer, type Reviewer, type Screening, lookOf, ago } from "./data";
import type { ExportTab } from "./dialogs";
import { SCREENINGS, SCREENINGS_CRUMB, newHref, overviewHref, papersHref, screenHref, settingsHref } from "./links";
import { MockStates } from "./mock-states";
import { useScreeningOverlays } from "./overlays";
import { Help, LinkChip, ReviewerMark, TONE, type Tone } from "./parts";
import { credits, paperCredits, useMock, useModelsReading, useOpenScreening, type Open } from "./store";
import { AddModel, AddPerson } from "./team";

type View = "overview" | "screen" | "papers" | "settings";

/**
 * Where each step of the mock's history was scrolled, and whether the last step was the browser's Back or Forward
 * rather than a link. Back returns to where the page was: the browser tries that itself, but while the page being left
 * is still drawn, so a shorter one cuts it short. The browser's history and the window's scroll are the outside
 * systems; the listener lives as long as the tab and acts only on the mock's pages.
 */
const scrolled = new Map<string, number>();
let returning = false;
if (typeof window !== "undefined" && "navigation" in window) {
  const { navigation } = window;
  const mock = () => window.location.pathname.startsWith(SCREENINGS);
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

/** A name or a count inside a sentence that opens what it stands for. */
const INLINE_LINK = "rounded-sm font-medium text-foreground underline decoration-foreground/25 underline-offset-2 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

/** How a paper is decided here, in the words the settings use. */
function ruleFacts(screening: Screening) {
  const [people, models] = [peopleOf(screening).length, modelsOf(screening).length];
  const each = screening.rule.each === "all" ? people : Math.min(Number(screening.rule.each), people);
  const readers = [each ? (each < people ? `${each} of ${people} people` : `${people} ${people === 1 ? "person" : "people"}`) : null, models ? `${models} ${models === 1 ? "model" : "models"}` : null].filter(Boolean).join(", ");
  return {
    who: readers || "No reviewer yet",
    whoIcon: each ? Users : AiIcon,
    when: screening.rule.settle === "all" ? "All agree" : screening.rule.settle === "most" ? "Most agree" : "One has voted",
    see: screening.rule.blind === "after" ? "Votes hidden until you vote" : "Votes visible to all",
    seeIcon: screening.rule.blind === "after" ? Lock : Eye,
  };
}

export function ScreeningWorkspace({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const store = useMock();
  // Which of its pages is open: each has its own address, so Back returns to the one before.
  const segment = useSelectedLayoutSegment();
  const view: View = segment === "screen" || segment === "papers" || segment === "settings" ? segment : "overview";
  const open = useOpenScreening(id);
  useModelsReading(id);
  // A deleted screening's page is left for good: Back does not return to it.
  const overlays = useScreeningOverlays(open, { onDeleted: () => router.replace(SCREENINGS) });
  // A page opened by a link starts at its top; Back and Forward, and a link to a section, keep their place. The window's scroll is the outside system.
  useEffect(() => {
    if (!returning && !window.location.hash) window.scrollTo(0, 0);
  }, [view, id]);

  if (!open) {
    return (
      <PageWrapper>
        <LibraryPageShell wide icon={ListChecks} title="Not found" trail={[SCREENINGS_CRUMB]}>
          <ListEmpty icon={Unlink}>This screening was deleted, or isn&apos;t shared with you</ListEmpty>
          <MockStates />
        </LibraryPageShell>
      </PageWrapper>
    );
  }

  const { screening } = open;
  const facts = ruleFacts(screening);
  const reviewers = activeReviewers(screening);
  const total = open.papers.length;
  const workspace = workspaceOf(screening);
  const resolver = personOf(screening.rule.resolver);
  // On Screen a row that came and went would move the paper being read.
  const banner = bannerKind(open, view === "screen");
  const shared = (screening.viewers?.length ?? 0) + peopleOf(screening).length;
  // Changes to its settings that were started and not saved.
  const unsaved = Boolean(store.drafts[id]);
  // A member who isn't one of its reviewers can join it.
  const canJoin = !open.isReviewer && open.canChange && !screening.finishedAt;
  const resume = () => store.update(id, (s) => ({ ...s, paused: false }), { what: "Resumed the models" });
  const reopen = () => store.update(id, (s) => ({ ...s, finishedAt: undefined }), { what: "Reopened the screening" });

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
        { id: "screen", label: "Screen", icon: ListChecks, href: screenHref(id), detail: open.toDo.length ? <span className="tabular-nums text-muted-foreground">{open.toDo.length}</span> : undefined },
        { id: "papers", label: "Papers", icon: Table2, href: papersHref(id), detail: <span className="tabular-nums text-muted-foreground">{total}</span> },
        // Only someone who may change it has its settings.
        ...(open.canChange ? [{ id: "settings" as const, label: "Settings", icon: Settings2, href: settingsHref(id), detail: unsaved ? <span className="rounded-full bg-warning/20 px-1.5 text-2xs ink-warning">Unsaved</span> : undefined }] : []),
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
        <DropdownMenuItem className="sm:hidden" onSelect={() => overlays.show("share")}><Share2 />Share</DropdownMenuItem>
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
                <DropdownMenuItem onSelect={() => store.update(id, (s) => ({ ...s, paused: true }), { what: "Paused the models" })}><CirclePause />Pause models</DropdownMenuItem>
              )
            ) : null}
            {growing(screening).length ? <DropdownMenuItem disabled={Boolean(screening.checking)} onSelect={open.check}><RefreshCw />Check for new papers</DropdownMenuItem> : null}
          </>
        ) : null}
        <DropdownMenuItem asChild><NextLink href={newHref(id)}><Copy />New screening with these settings</NextLink></DropdownMenuItem>
        {open.canChange ? (
          <>
            <DropdownMenuItem onSelect={() => overlays.show("move")}><Move />Move to another workspace</DropdownMenuItem>
            {/* In the widest windows the bar has this as a button. */}
            {canJoin ? <DropdownMenuItem className="2xl:hidden" onSelect={open.join}><UserPlus />Join as a reviewer</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => overlays.show("delete")}><Trash2 />Delete</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Who reviews it and the ways to add to them, in the bar beside Share. On a phone the bar keeps the name and the menu, so they sit under the rule.
  const team = (
    <>
      {workspace !== HOME ? <WorkspaceTag size="sm" workspace={lookOf(workspace, screening.createdBy)} /> : null}
      <Faces id={id} reviewers={reviewers} me={open.me} />
      {/* In the bar only in a window wide enough to keep a long name whole beside it: the menu has it at every width. */}
      {canJoin ? <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs max-2xl:hidden" onClick={open.join}><UserPlus />Join as a reviewer</Button> : null}
      {open.canChange ? (
        <>
          <AddPerson exclude={reviewers.map((reviewer) => reviewer.id)} onPick={(pick) => overlays.add("person" in pick ? personReviewer(pick.person, Date.now()) : invitedReviewer(pick.email, Date.now()))}>
            <PickerButton hint="Add person"><UserPlus /></PickerButton>
          </AddPerson>
          <AddModel exclude={modelsOf(screening).map((model) => model.model!.id)} onPick={(model) => overlays.add(modelReviewer(model, Date.now()))}>
            <PickerButton hint="Add model"><AiIcon /></PickerButton>
          </AddModel>
        </>
      ) : null}
    </>
  );

  // How a paper is decided, in one line at every width: the chips scroll sideways where the line is too short for them. In the settings the form itself says the same.
  const rule = (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex shrink-0 items-center gap-1 text-sm font-medium">
        {/* Its name shows where the line has room for it: on a line of its own from a tablet up, and beside the pages in a wide window. */}
        <span className="sr-only @[48rem]/strip:not-sr-only @[66rem]/strip:sr-only @[77rem]/strip:not-sr-only">How a paper is decided</span>
        <Help
          title="How a paper is decided"
          facts={
            <>
              {screening.rule.settle !== "one" && resolver ? <HelpFact icon={Users}>Conflicts go to {resolver.name}</HelpFact> : null}
              {screening.living ? <HelpFact icon={RefreshCw}>Checks for new papers {EVERY_LABEL[screening.living.every].toLowerCase()}</HelpFact> : null}
            </>
          }
        >
          <p>Each paper gets the votes named in these chips, and the rule settles it once they are in.</p>
          {screening.rule.settle === "one" ? <p>The first vote on a paper settles it, so reviewers never split.</p> : <p>When its reviewers split, the paper is in conflict until {resolver?.name ?? "a person"} settles it.</p>}
          {screening.living ? <p>A living screening checks its sources for new papers on a schedule and screens what is new. Uploaded files and pasted lists never gain papers.</p> : null}
        </Help>
      </span>
      <FadeRow scrolls scrollbar="none" className="flex items-center gap-2">
        <LinkChip href={overviewHref(id, "reviewers")} icon={facts.whoIcon} className="shrink-0">{facts.who}</LinkChip>
        <Chip icon={Check}>{facts.when}</Chip>
        <Chip icon={facts.seeIcon}>{facts.see}</Chip>
        {/* Below a laptop's width the bar keeps its room for the name, so "Living" joins these. */}
        {screening.living ? <LinkChip href={overviewHref(id, "new-papers")} icon={RefreshCw} className="shrink-0 lg:hidden">Living</LinkChip> : null}
      </FadeRow>
      {open.canChange ? <Button asChild variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs"><NextLink href={settingsHref(id, "decided")}>Change</NextLink></Button> : null}
    </div>
  );

  // Who the person looking is to it, where that is less than a reviewer who can change it.
  const role = !open.isReviewer
    ? { label: "Viewer", icon: Eye, text: open.canChange ? "You see every paper and every vote. You aren't one of its reviewers, so no paper is dealt to you." : `${workspace.name} shared it with you. You see every paper and every vote, and no paper is dealt to you.` }
    : !open.canChange
      ? { label: "Guest", icon: Users, text: `${workspace.name} shared it with you. You vote on the papers dealt to you. Only ${workspace.name}'s members change its settings.` }
      : null;

  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        {/* Faces fade in as they load, where they would otherwise appear in one frame. */}
        {/* The screening's name keeps some room in the bar at every width, so it always shows at least in part. */}
        <div className={`contents ${AVATARS_FADE_IN} [&_[data-sticky-page-header]_h1]:min-w-32 @7xl:[&_[data-sticky-page-header]_h1]:min-w-64`}>
          <LibraryPageShell
            wide
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
                {screening.living ? <LinkChip href={overviewHref(id, "new-papers")} icon={RefreshCw} className="max-lg:hidden">Living</LinkChip> : null}
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
                {/* Icon-only, it keeps its count, so it is as wide as both. */}
                <Button variant="outline" size="sm" className="max-sm:hidden @max-3xl:px-2" aria-label={`Share, ${shared} ${shared === 1 ? "person" : "people"}`} onClick={() => overlays.show("share")}>
                  <Share2 /><span className={BAR_LABEL}>Share</span>
                  {shared ? <span className="ms-0.5 rounded-full bg-muted px-1.5 text-2xs tabular-nums">{shared}</span> : null}
                </Button>
                <span className="flex max-sm:hidden">{more}</span>
              </>
            }
            intro={
              <div className="@container/strip">
                {/* One strip under the bar: the pages, then how a paper is decided. Where the card is too narrow for both on a line, the pages take the first and the rule the second. */}
                <div className="border-b border-border-subtle px-4 py-3 sm:px-6 @[66rem]/strip:hidden"><FadeRow scrolls scrollbar="none" keepInView="[aria-current=page]">{pages(true)}</FadeRow></div>
                <div className={cn("flex items-center gap-x-6 px-4 py-3 sm:px-6", view === "settings" && "@max-[66rem]/strip:hidden")}>
                  <div className="shrink-0 @max-[66rem]/strip:hidden">{pages(false)}</div>
                  {view === "settings" ? null : <div className="min-w-0 @[66rem]/strip:ms-auto">{rule}</div>}
                </div>
                {view === "settings" || view === "screen" ? null : <div className="flex items-center gap-2 px-4 pb-3 sm:hidden">{team}</div>}
                {/* The row comes and goes as the models start and finish: it slides, so nothing under it jumps. */}
                <AutoHeight>
                  <Banner kind={banner} open={open} workspace={workspace.name} onAddCredits={() => store.set({ wallet: store.wallet + 20_000 })} onReopen={reopen} onResume={resume} />
                </AutoHeight>
              </div>
            }
          >
            {/* Each page rises in as it opens. */}
            <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
              <Workspace value={{ open, exportTo: overlays.exportTo, finish: () => overlays.show("finish"), openActivity: () => overlays.show("activity") }}>{children}</Workspace>
            </motion.div>
          </LibraryPageShell>
        </div>

        {overlays.overlays}
        <MockStates />
      </PageWrapper>
    </MotionConfig>
  );
}

/** An icon-only button that opens a picker. The picker hands it the trigger's own props, and the hint names it. */
function PickerButton({ hint, className, ...button }: ComponentProps<typeof Button> & { hint: string }) {
  return (
    <TooltipHint label={hint}>
      <Button variant="outline" size="icon" aria-label={hint} {...button} className={cn("size-8 shrink-0", className)} />
    </TooltipHint>
  );
}

/** The reviewers' faces, people first. Each opens the papers that reviewer voted on; past the seventh, the count opens the Overview's list of them all. */
function Faces({ id, reviewers, me, max = 7 }: { id: string; reviewers: Reviewer[]; me: string; max?: number }) {
  return (
    <span className="flex shrink-0 items-center">
      {reviewers.slice(0, max).map((reviewer, i) => (
        <TooltipHint key={reviewer.id} label={`${reviewer.name}'s votes`}>
          <NextLink
            href={papersHref(id, { reviewer: reviewer.id })}
            aria-label={`${reviewer.name}'s votes`}
            className={cn("relative flex ring-2 ring-card outline-none transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:ring-ring/60 motion-reduce:transition-none", reviewer.kind === "model" ? "rounded-md" : "rounded-full", i > 0 && "-ms-1.5")}
          >
            <ReviewerMark reviewer={reviewer} you={reviewer.id === me} />
          </NextLink>
        </TooltipHint>
      ))}
      {reviewers.length > max ? (
        <NextLink href={overviewHref(id, "reviewers")} className={cn("ms-1.5 text-xs tabular-nums text-muted-foreground", INLINE_LINK)}>+{reviewers.length - max}</NextLink>
      ) : null}
    </span>
  );
}

/** What the screening is doing now, which a person may need to act on. Who the person is to it is a chip beside its title, not one of these. */
type BannerKind = "gathering" | "checking" | "credits" | "finished" | "paused" | "arrived" | "waiting" | "reading" | "nothing";
/** Which one thing the row under the bar says. `quiet` leaves out what comes and goes as models read and papers arrive: on Screen and in the settings that row would move what is being read or changed. */
function bannerKind(open: Open, quiet: boolean): BannerKind | null {
  const { screening, reading } = open;
  if (open.gathering) return "gathering";
  if (screening.checking) return "checking";
  if (open.outOfCredits) return "credits";
  if (screening.finishedAt) return "finished";
  if (screening.paused && modelsOf(screening).length) return "paused";
  if (quiet) return null;
  if (open.latest?.mine) return "arrived";
  if (reading.length) return open.waitingFor ? "waiting" : "reading";
  // A check that found nothing says so, where nothing else has to be said.
  if (screening.updates?.at(-1)?.added === 0 && screening.updates.at(-1)!.at > NOW) return "nothing";
  return null;
}

/** Each kind of notice in the colour of what it is about: what waits for you is primary, a stop is warning, the rest are facts. */
const BANNER_TONE: Record<BannerKind, Tone> = { gathering: "neutral", checking: "neutral", credits: "warning", finished: "neutral", paused: "warning", arrived: "primary", waiting: "neutral", reading: "neutral", nothing: "neutral" };

function Banner({ kind, open, workspace, onAddCredits, onReopen, onResume }: { kind: BannerKind | null; open: Open; workspace: string; onAddCredits: () => void; onReopen: () => void; onResume: () => void }) {
  const { screening, reading, papers } = open;
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
        <span className="font-medium">Checking for new papers</span>
        <Meter value={screening.checking.done} max={screening.checking.of} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground">{screening.checking.done} of {screening.checking.of} {screening.checking.of === 1 ? "source" : "sources"} checked</span>
      </div>
    );
  }
  if (kind === "arrived" && open.latest) {
    return (
      <div className={row}>
        <RefreshCw className={icon} />
        <span><NextLink href={papersHref(id, { added: String(open.latest.at) })} className={INLINE_LINK}>{open.latest.papers} new {open.latest.papers === 1 ? "paper" : "papers"}</NextLink> came in {ago(open.latest.at)}</span>
        <Button asChild variant="outline" size="sm"><NextLink href={screenHref(id, { order: "fresh" })}><ListChecks />Screen your {open.latest.mine}</NextLink></Button>
      </div>
    );
  }
  if (kind === "nothing") {
    const before = screening.updates?.at(-2)?.at ?? screening.createdAt;
    return (
      <div className={row}>
        <RefreshCw className={icon} />
        <span className="font-medium">No new papers since {ago(before) === day(before) ? day(before) : ago(before)}</span>
      </div>
    );
  }
  if (kind === "gathering" && open.gathering) {
    return (
      <div className={row}>
        <Search className={icon} />
        <span className="font-medium">Getting its papers</span>
        <Meter value={open.gathering.done} max={open.gathering.of} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground"><AnimatedNumber value={open.gathering.done} /> of {open.gathering.of.toLocaleString("en-GB")}</span>
        {open.isReviewer ? <Button asChild variant="outline" size="sm"><NextLink href={screenHref(id)}><ListChecks />Screen the papers that are in</NextLink></Button> : null}
      </div>
    );
  }
  if (kind === "credits") {
    return (
      <div className={row}>
        <Coins className={icon} />
        <span className="flex items-center gap-1 font-medium">
          Out of credits
          <Help title="Out of credits" facts={reading.map((model) => <HelpFact key={model.id} icon={Coins}>{model.name}, {credits(paperCredits(model.model!))} credits a paper</HelpFact>)}>
            A model stops when the workspace can&apos;t pay for its next paper. Its votes so far stay, and it carries on from where it stopped once credits are added.
          </Help>
        </span>
        <span className="text-muted-foreground">{models(reading)} stopped at {Math.max(...reading.map((model) => screening.reached[model.id] ?? 0))} of {papers.length} papers</span>
        {/* The mock has no payment: going to billing adds the credits, and Back returns here with them. */}
        {open.canChange ? <Button asChild variant="outline" size="sm"><NextLink href="/settings/billing" onClick={onAddCredits}><Coins />Add credits</NextLink></Button> : null}
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
          <Help title="Finished screening">Its models stop reading and it stops checking for new papers. You can still read, export and change it, or reopen it.</Help>
        </span>
        {open.canChange && growing(screening).length ? <Button variant="outline" size="sm" onClick={open.check}><RefreshCw />Check for new papers</Button> : null}
        {open.canChange ? <Button variant="outline" size="sm" onClick={onReopen}><RotateCcw />Reopen</Button> : null}
      </div>
    );
  }
  if (kind === "paused") {
    const done = Math.min(...modelsOf(screening).map((model) => screening.reached[model.id] ?? 0));
    return (
      <div className={row}>
        <CirclePause className={icon} />
        <span className="flex items-center gap-1 font-medium">
          Models paused
          <Help title="Paused models">Paused models read nothing and spend no credits. People keep voting, and papers settle on the votes they have.</Help>
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{done} of {papers.length} papers read</span>
        {open.canChange ? <Button variant="outline" size="sm" onClick={onResume}><Play />Resume models</Button> : null}
      </div>
    );
  }
  if (kind === "waiting" && open.waitingFor) {
    return (
      <div className={row}>
        <Clock className={icon} />
        <span className="flex items-center gap-1">
          <span className="font-medium">{reading.length === 1 ? "Its model starts" : "Its models start"} after <NextLink href={overviewHref(open.waitingFor.screening.id)} className={INLINE_LINK}>{open.waitingFor.screening.name}</NextLink></span>
          <Help title="Models take turns" facts={<HelpFact icon={ListChecks}>40 papers at a time</HelpFact>}>
            {workspace}&apos;s models read 40 papers at a time, so a screening started while another is reading waits for it. People can vote in the meantime.
          </Help>
        </span>
        <Meter value={open.waitingFor.done} max={open.waitingFor.of} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground"><AnimatedNumber value={open.waitingFor.done} /> of {open.waitingFor.of.toLocaleString("en-GB")}</span>
      </div>
    );
  }
  if (kind === "reading") {
    const done = Math.min(...reading.map((model) => screening.reached[model.id] ?? 0));
    return (
      <div className={row}>
        <AiIcon working className="size-4 shrink-0" />
        <span className="font-medium">{reading.length === 1 ? modelLink(reading[0]!) : `${reading.length} models`} reading</span>
        <Meter value={done} max={papers.length} className="w-40" />
        <span className="text-xs tabular-nums text-muted-foreground">{done} of {papers.length}</span>
      </div>
    );
  }
  return null;
}
