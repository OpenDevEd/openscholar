"use client";

// Mock of the research assistant: an overlay that hovers above every page of the
// app and folds into a launcher. A scripted run stands in for the model and plays
// entirely inside the chat; it doesn't change the page underneath. Along the way it
// hits what real use hits: a plan limit, a question back, a credit shortfall and a
// failed publish, and any reply can be stopped, retried or edited.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowRight, ArrowUp, Check, ChevronDown, CircleHelp, CirclePause, CircleStop, Coins, Copy, Eye, FileText, Folder, FolderPlus, Globe, LayoutList, ListChecks, Search, SlidersHorizontal, TableProperties, MessagesSquare, Pencil, PictureInPicture2, Play, RotateCcw, Sparkles, Square, SquarePen, UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { EDGE_FADE } from "@/components/ui/scroll-area";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { getModelIcon } from "@/components/icons/provider-icons";
import { EffortMeter } from "@/components/models/meters";
import { ModelPicker } from "@/components/models/model-picker";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { PRESET_KEYS } from "@/lib/ai/tasks";
import { StatusIcon } from "@/components/evidence-libraries/configuration/status-chip";
import { EASE, effortOf, usePresetModels, type PickedModel, type PresetPick } from "@/components/settings/model-map";
import { ApprovalCard, CollectionCard, Facts, JobCard, KindTile, QuestionCard, RunMap, VersionBars, WorkingText, type Ask, type Step } from "./run-map";
import { LogoMark } from "./logo-mark";
import { Dim, EdgeGlow, HistorySheet, SHEET_SPRING, Sheet, ShareSheet, TopUpSheet, stackedUnder, type SheetKind } from "./sheets";
import { Cite, EXTRACT_CELLS, ExtractionCard } from "./extraction";
import { MentionComposer, MessageText } from "./mentions";
import {
  ACCOUNT, BALANCE, COLLECTED, COLLECTION_CHOICES, COLLECTION_NAME, EXTRACT_HOLD, EXTRACT_SPENT, LIBRARY, ORIGINAL_COUNT, OTHER_SCREENING,
  REPLY_CAP, SCREEN_HOLD, SCREEN_ORDER, SCREEN_SPENT, SEARCH_NAME, SETTLED, TIGHT_COUNT, type Decision,
} from "./data";

type Card =
  | { type: "approval"; ask: Ask; status: "pending" | "allowed" | "declined" }
  | { type: "job"; done: number; waiting?: number; settled?: boolean; cancelled?: boolean }
  | { type: "extract"; filled: number; cancelled?: boolean }
  | { type: "question"; picked: string | null; typed?: string }
  | { type: "collection"; undone: boolean; name: string; count: number }
  | { type: "publish"; stage: number; failed?: boolean };
type AssistantTurn = { kind: "assistant"; id: number; steps: Step[]; text: string; shown: number; cards: Card[]; stopped?: boolean };
/** What a message changes, saved when it's sent, so a retry or an edit can start from there again. */
type Snapshot = { always: boolean; balance: number; home: Home; owner: number | null };
type UserTurn = { kind: "user"; id: number; text: string; step: number; snap: Snapshot; edited?: boolean };
type Turn = UserTurn | AssistantTurn;
type Choice = "once" | "always" | "no";
/** Where the included studies went. */
type Home = { name: string; count: number };
type Answer = { id: string; typed?: string };

const PROMPTS = [
  `Tighten @${SEARCH_NAME} to sub-Saharan Africa`,
  "Screen them. Keep trials and quasi-experiments in primary schools",
  "Save the included ones to a collection",
  "Compare the designs and samples in these studies",
  "Feature them on our Evidence Library's homepage",
  "Publish it",
];
const TITLE = "Structured pedagogy in sub-Saharan Africa";
const PANEL_W = 440;
const SHELL_SPRING = { type: "spring" as const, stiffness: 380, damping: 36, mass: 0.9 };
const START_HOME: Home = { name: COLLECTION_NAME, count: COLLECTED };

const SCREEN_ASK: Ask = {
  kind: "screening",
  title: "Screen 24 papers",
  items: ["Is it a randomized or quasi-experimental study?", "Is it set in primary schools?"],
  credits: SCREEN_HOLD,
  always: true,
  confirm: "Allow once",
  decline: "Don't screen",
  queue: true,
};
const EXTRACT_ASK: Ask = {
  kind: "extraction",
  title: "Extract from 4 papers",
  items: ["Study design", "Country and grades", "Sample size"],
  credits: EXTRACT_HOLD,
  always: true,
  confirm: "Allow once",
  decline: "Don't extract",
};
const publishAsk = (collection: string): Ask => ({
  kind: "publish",
  title: "Publish the new homepage",
  items: ["The homepage intro", "A tagline and description", `“${collection}” first among the homepage collections`],
  always: false,
  confirm: "Publish",
  decline: "Don't publish",
});
/** What the homepage text step writes: the visible intro, plus the tagline and description search results show. */
const HOME_TEXT = ["Intro", "Tagline", "Description"];
/** The publish operation's stages: queued, assembling, validating, publishing, activating. */
const PUBLISH_STAGES = ["Queued", "Putting the settings together", "Checking them", "Publishing", "Switching the library over"];
/** The stage the first publish in a chat fails at, the way the watchdog fails a publish whose worker stops answering. */
const PUBLISH_FAILS_AT = 3;

/** What the assistant says it can see, from the route the user is on. */
function viewOf(pathname: string) {
  if (pathname.startsWith("/results")) return "Search results";
  if (pathname.startsWith("/history")) return "History";
  if (pathname.startsWith("/bookmarks")) return "Bookmarks";
  if (pathname.startsWith("/library")) return "Library";
  if (pathname.startsWith("/extraction/")) return "Extraction job";
  if (pathname.startsWith("/extraction")) return "Extraction";
  if (/^\/evidence-libraries\/[^/]+\/configuration/.test(pathname)) return "Library settings";
  if (pathname.startsWith("/evidence-libraries")) return "Evidence Libraries";
  if (pathname.startsWith("/topics")) return "Topics";
  if (pathname.startsWith("/authors")) return "Authors";
  if (pathname.startsWith("/settings")) return "Settings";
  return "Home";
}

class Stopped extends Error {}

/** A job on its own clock: Stop ends the reply, never the job; only its Cancel does. */
type Job = { cancelled: boolean; progress: number; hold: number; spent: number; done: Promise<boolean> };
type Reply = { id: number; spent: number; cap: number; paused: boolean };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type OpenSheet = { kind: SheetKind; chat: string; balance?: number; need?: number; purpose?: Ask };

export function AssistantOverlay() {
  const pathname = usePathname();
  const view = viewOf(pathname);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [always, setAlwaysState] = useState(false);
  const [balance, setBalanceState] = useState(BALANCE);
  const [home, setHomeState] = useState<Home>(START_HOME);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState(0);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(true);
  // Sheets stacked over the panel, bottom first.
  const [sheets, setSheets] = useState<OpenSheet[]>([]);
  const run = useRef(0);
  const ids = useRef(0);
  // Each wait on the person answers only the run that asked.
  const decide = useRef<{ token: number; resolve: (choice: Choice) => void } | null>(null);
  const question = useRef<{ token: number; resolve: (answer: Answer) => void } | null>(null);
  const retryWait = useRef<{ token: number; resolve: () => void } | null>(null);
  const capWait = useRef<{ token: number; resolve: () => void } | null>(null);
  // The running reply's own spending against its cap; the ref is what the script reads.
  const [reply, setReplyState] = useState<Reply | null>(null);
  const replyRef = useRef<Reply | null>(null);
  // Jobs by the turn that started them, and what a stopped turn still has to do once its job ends.
  const jobs = useRef(new Map<number, Job>());
  const continuations = useRef(new Map<number, { step: number; run: (token: number) => Promise<boolean | void> }>());
  // Read at the gates, so a change mid-step counts.
  const alwaysRef = useRef(false);
  const balanceRef = useRef(BALANCE);
  // The script reads where the studies went from here, so a rerun sees the restored value.
  const homeRef = useRef<Home>(START_HOME);
  // The turn whose collection is current; an older card's undo does nothing.
  const collectionOwner = useRef<number | null>(null);
  // The first publish in a chat fails, so the retry shows.
  const publishFailed = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);

  // Timers are an outside system: stop the scripted run and every job when the overlay unmounts.
  useEffect(() => {
    const running = jobs.current;
    return () => {
      run.current++;
      for (const job of running.values()) job.cancelled = true;
    };
  }, []);
  // A keyboard shortcut is an outside system too: ⌘J or Ctrl+J opens and closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setSheets([]);
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setSheets((all) => all.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setAlways = (value: boolean) => {
    alwaysRef.current = value;
    setAlwaysState(value);
  };
  const setBalance = (value: number) => {
    balanceRef.current = value;
    setBalanceState(value);
  };
  const setHome = (value: Home) => {
    homeRef.current = value;
    setHomeState(value);
  };
  const wait = (token: number, ms: number) =>
    new Promise<void>((resolve, reject) => setTimeout(() => (token === run.current ? resolve() : reject(new Stopped())), ms));
  const patch = (id: number, fn: (t: AssistantTurn) => Partial<AssistantTurn>) =>
    setTurns((all) => all.map((t) => (t.kind === "assistant" && t.id === id ? { ...t, ...fn(t) } : t)));
  const setStep = (id: number, i: number, step: Partial<Step>) =>
    patch(id, (t) => ({ steps: t.steps.map((s, j) => (j === i ? { ...s, ...step } : s)) }));
  const addStep = (id: number, step: Step) => patch(id, (t) => ({ steps: [...t.steps, step] }));
  const setCard = (id: number, i: number, card: Card) => patch(id, (t) => ({ cards: t.cards.map((c, j) => (j === i ? card : c)) }));
  const addCard = (id: number, card: Card) => patch(id, (t) => ({ cards: [...t.cards, card] }));
  const setReply = (value: Reply | null) => {
    replyRef.current = value;
    setReplyState(value);
  };
  /** Charges the reply's own AI use, pausing at its cap until the person allows more. */
  const spend = async (token: number, id: number, credits: number) => {
    const current = replyRef.current;
    if (!current || current.id !== id) return;
    let cap = current.cap;
    if (current.spent + credits > cap) {
      setReply({ ...current, paused: true });
      await new Promise<void>((resolve) => {
        capWait.current = { token, resolve };
      });
      capWait.current = null;
      if (token !== run.current) throw new Stopped();
      cap += REPLY_CAP;
    }
    setReply({ id, spent: current.spent + credits, cap, paused: false });
    charge(credits);
  };
  /**
   * Runs a job on its own clock, one tick at a time. It holds `hold` credits, spends
   * `spent` in step with its progress, and returns the rest when it ends or is cancelled.
   */
  const runJob = (id: number, hold: number, spent: number, ticks: Array<[ms: number, progress: number, apply: () => void]>): Job => {
    charge(hold);
    const job: Job = { cancelled: false, progress: 0, hold, spent, done: Promise.resolve(false) };
    job.done = (async () => {
      for (const [ms, progress, apply] of ticks) {
        await sleep(ms);
        if (job.cancelled) return false;
        job.progress = progress;
        apply();
      }
      charge(-(hold - spent));
      return true;
    })();
    jobs.current.set(id, job);
    return job;
  };
  /** Waits for a job as part of a reply: a stopped reply stops waiting, and the job carries on. */
  const follow = async (token: number, job: Job) => {
    const finished = await job.done;
    if (token !== run.current) throw new Stopped();
    return finished;
  };
  const cancelJob = (id: number) => {
    const job = jobs.current.get(id);
    if (!job || job.cancelled) return;
    job.cancelled = true;
    charge(-(job.hold - Math.round(job.spent * job.progress)));
    patch(id, (t) => ({ cards: t.cards.map((c): Card => (c.type === "job" || c.type === "extract" ? { ...c, cancelled: true } : c)) }));
  };
  const stream = async (token: number, id: number, text: string, cost = 2) => {
    await spend(token, id, cost);
    patch(id, () => ({ text, shown: 0 }));
    let shown = 0;
    for (const w of text.split(/(?<= )/)) {
      await wait(token, 26);
      shown += w.length;
      const n = shown;
      patch(id, () => ({ shown: n }));
    }
  };
  /** A step that runs for a while, then settles with its final title and detail. */
  const work = async (token: number, id: number, i: number, step: Step, done: Partial<Step>, ms: number, cost = 1) => {
    await spend(token, id, cost);
    addStep(id, step);
    await wait(token, ms);
    setStep(id, i, { ...done, status: "done" });
  };
  /**
   * Shows the approval card and waits for an answer. A credits ask is skipped once the
   * user has allowed credits for this chat and the balance covers it; publishing asks every time.
   */
  const approve = async (token: number, id: number, ask: Ask): Promise<{ choice: Choice; asked: boolean }> => {
    if (ask.always && alwaysRef.current && (ask.credits ?? 0) <= balanceRef.current) return { choice: "always", asked: false };
    addCard(id, { type: "approval", ask, status: "pending" });
    const choice = await new Promise<Choice>((resolve) => {
      decide.current = { token, resolve };
    });
    decide.current = null;
    if (token !== run.current) throw new Stopped();
    if (choice === "no") patch(id, (t) => ({ cards: t.cards.map((c) => (c.type === "approval" ? { ...c, status: "declined" } : c)) }));
    if (choice === "always") setAlways(true);
    return { choice, asked: true };
  };
  /** Puts the running job where the approval card was, or adds it when nothing was asked. */
  const startJob = (id: number, asked: boolean, card: Card) => (asked ? setCard(id, 0, card) : addCard(id, card));
  const charge = (credits: number) => setBalance(balanceRef.current - credits);
  /** Stops whatever runs, and drops every wait on the person. */
  const halt = () => {
    run.current++;
    decide.current = null;
    question.current = null;
    retryWait.current = null;
    capWait.current = null;
    setBusy(false);
  };
  /** Stops the running script: pending approvals close, an unanswered question goes, and so does the collection made on the old search. */
  const cancelRun = () => {
    halt();
    collectionOwner.current = null;
    setTurns((all) =>
      all.map((t) =>
        t.kind === "assistant"
          ? {
              ...t,
              cards: t.cards.filter((c) => !(c.type === "question" && c.picked === null)).map((c): Card =>
                c.type === "approval" && c.status === "pending" ? { ...c, status: "declined" } : c.type === "collection" ? { ...c, undone: true } : c,
              ),
            }
          : t,
      ),
    );
  };
  /** Stop, from the composer: the reply keeps what it had shown, marked as stopped. */
  const stop = () => {
    halt();
    setTurns((all) =>
      all.map((t, i): Turn =>
        t.kind === "assistant" && i === all.length - 1
          ? {
              ...t,
              stopped: true,
              text: t.text.slice(0, t.shown),
              steps: t.steps.map((s) => (s.status === "working" ? { ...s, status: "stopped" } : s)),
              cards: t.cards
                .filter((c) => !(c.type === "question" && c.picked === null))
                .map((c): Card => (c.type === "approval" && c.status === "pending" ? { ...c, status: "declined" } : c)),
            }
          : t,
      ),
    );
  };

  const undoSearch = (id: number) => {
    cancelRun();
    setNext(0);
    patch(id, (t) => ({ steps: t.steps.map((s) => (s.kind === "write" ? { ...s, status: "undone", onUndo: undefined } : s)) }));
  };

  const optimize = async (token: number, id: number) => {
    await work(token, id, 0, { kind: "search", title: "Reading your search", detail: <Facts items={[{ icon: Search, label: "Query" }, { icon: SlidersHorizontal, label: "Filters" }]} />, status: "working" },
      { title: "Read your search", detail: <Facts items={[{ value: ORIGINAL_COUNT, label: "results" }, { value: 6, label: "on this page" }]} /> }, 1100);
    await work(token, id, 1, { kind: "versions", title: "Trying tighter versions", detail: <Facts items={[{ value: 3, label: "versions" }, { icon: Globe, label: "OpenAlex counts" }]} />, status: "working" },
      { title: "Tried 3 versions", detail: <VersionBars /> }, 1700, 6);
    await work(token, id, 2, { kind: "write", title: "Updating your search", detail: <Facts items={[{ icon: Search, label: "Query" }, { icon: SlidersHorizontal, value: 2, label: "filters" }]} />, status: "working" },
      { title: "Updated your search", detail: <Facts items={[{ value: <>{ORIGINAL_COUNT} <ArrowRight className="inline size-3" /> {TIGHT_COUNT}</>, label: "results" }]} />, onUndo: () => undoSearch(id) }, 1200);
    await stream(
      token,
      id,
      "Most of the first page was off-topic: reading software, middle-school reform, Latin America. I added the other names this approach goes by, kept articles from 2015 on, and limited it to Sub-Saharan Africa. That leaves 24, and the first page is on target now.",
    );
  };

  const screen = async (token: number, id: number) => {
    await work(token, id, 0, { kind: "screening", title: "Setting up a screening", detail: <Facts items={[{ icon: ListChecks, value: 2, label: "questions" }, { icon: FileText, value: 24, label: "papers" }]} />, status: "working" },
      { title: "Set up a screening" }, 1000);
    const { choice, asked } = await approve(token, id, SCREEN_ASK);
    if (choice === "no") {
      await stream(token, id, "Okay, I haven't screened anything. Your search is unchanged.");
      return false;
    }
    // The plan runs one screening at a time, so this one waits for the other to finish.
    startJob(id, asked, { type: "job", done: 0, waiting: OTHER_SCREENING.start });
    const ticks: Array<[number, number, () => void]> = [];
    for (let w = OTHER_SCREENING.start + 1; w <= OTHER_SCREENING.total; w++) ticks.push([300, 0, () => setCard(id, 0, { type: "job", done: 0, waiting: w })]);
    ticks.push([600, 0, () => setCard(id, 0, { type: "job", done: 0 })]);
    for (let done = 1; done <= 24; done++) ticks.push([done === 1 ? 710 : 210, done / 24, () => setCard(id, 0, { type: "job", done })]);
    const job = runJob(id, SCREEN_HOLD, SCREEN_SPENT, ticks);
    return followUp(token, id, 1, (t) => afterScreening(t, id, job));
  };

  /** Runs what a reply does once its job ends, keeping it so a stopped reply can continue. */
  const followUp = async (token: number, id: number, step: number, rest: (token: number) => Promise<boolean>) => {
    continuations.current.set(id, { step, run: rest });
    const ok = await rest(token);
    continuations.current.delete(id);
    return ok;
  };

  const afterScreening = async (token: number, id: number, job: Job) => {
    if (!(await follow(token, job))) {
      await stream(token, id, `Okay, I cancelled the screening at ${Math.round(job.progress * 24)} of 24. The decisions it made so far are kept.`);
      return false;
    }
    await wait(token, 500);
    // Unclear answers that decide whether a paper is in get checked here, not left for a person.
    await work(token, id, 1, { kind: "screening", title: "Checking the 3 unclear papers", detail: <Facts items={[{ icon: CircleHelp, value: 3, label: "unclear", tone: "warn" }, { icon: Globe, label: "OpenAlex records" }]} />, status: "working" },
      { title: "Settled 2 of the 3 unclear", detail: <Facts items={[{ icon: X, value: SETTLED, label: "excluded" }, { icon: CircleHelp, value: 3 - SETTLED, label: "still unclear", tone: "warn" }]} />, onUndo: () => unsettle(id) }, 1800, 6);
    setCard(id, 0, { type: "job", done: 24, settled: true });
    await wait(token, 400);
    await stream(
      token,
      id,
      "5 of the 24 are trials or quasi-experiments in primary schools, and one of those is listed twice. I checked the 3 that came back unclear, using their full OpenAlex records: two report on a trial without being one, so they're out. The last has no abstract anywhere I can reach and its title doesn't say, so it stays unclear and isn't included.",
    );
    return true;
  };

  /** Undo for the settled answers: the two go back to unclear. */
  const unsettle = (id: number) =>
    patch(id, (t) => ({
      cards: t.cards.map((c): Card => (c.type === "job" ? { ...c, settled: false } : c)),
      steps: t.steps.map((st, i) => (i === 1 ? { ...st, status: "undone", onUndo: undefined } : st)),
    }));

  const collect = async (token: number, id: number) => {
    await work(token, id, 0, { kind: "collection", title: "Looking at your collections", detail: <Facts items={[{ icon: Folder, value: 3, label: "collections" }]} />, status: "working" },
      { title: "Checked your 3 collections", detail: <Facts items={[{ icon: Folder, value: 2, label: "could fit" }]} /> }, 1000);
    // Asks instead of guessing, and waits for a tap or a typed name.
    addCard(id, { type: "question", picked: null });
    const answer = await new Promise<Answer>((resolve) => {
      question.current = { token, resolve };
    });
    question.current = null;
    if (token !== run.current) throw new Stopped();
    patch(id, (t) => ({ cards: t.cards.map((c): Card => (c.type === "question" ? { ...c, picked: answer.id, typed: answer.typed } : c)) }));
    const choice = COLLECTION_CHOICES.find((c) => c.id === answer.id)!;
    const name = answer.typed ?? choice.name;
    const fresh = choice.id === "new";
    const count = choice.count + COLLECTED;
    // The pick shows for a moment, then the card folds into the run as a step, so the
    // turn still reads top to bottom.
    await wait(token, 750);
    patch(id, (t) => ({ cards: t.cards.filter((c) => c.type !== "question") }));
    addStep(id, { kind: "collection", title: answer.typed ? `You named it “${name}”` : `You chose ${name}`, detail: <Facts items={[{ icon: FileText, value: COLLECTED, label: "studies" }]} />, status: "done" });
    await wait(token, 450);
    await work(token, id, 2, { kind: "collection", title: fresh ? "Creating the collection" : `Opening ${name}`, detail: fresh ? name : <Facts items={[{ value: choice.count, label: "papers" }]} />, status: "working" },
      { title: fresh ? "Created the collection" : `Opened ${name}` }, 900);
    await work(token, id, 3, { kind: "collection", title: "Adding the included studies", detail: <Facts items={[{ icon: ListChecks, value: COLLECTED, label: "included" }]} />, status: "working" },
      { title: `Added ${COLLECTED} studies`, detail: <Facts items={[{ icon: Check, value: COLLECTED, label: "added", tone: "good" }, { icon: Copy, value: 1, label: "duplicate skipped" }]} /> }, 900);
    collectionOwner.current = id;
    setHome({ name, count });
    addCard(id, { type: "collection", undone: false, name, count });
    await wait(token, 300);
    await stream(
      token,
      id,
      fresh ? `Done. The 4 included studies are in “${name}”.` : `Done. “${name}” has ${count} papers now.`,
      1,
    );
  };

  const extract = async (token: number, id: number) => {
    await work(token, id, 0, { kind: "extraction", title: "Setting up an extraction", detail: <Facts items={[{ icon: TableProperties, value: 3, label: "fields" }, { icon: FileText, value: 4, label: "papers" }]} />, status: "working" },
      { title: "Set up an extraction" }, 1000);
    const { choice, asked } = await approve(token, id, EXTRACT_ASK);
    if (choice === "no") {
      await stream(token, id, "Okay, I haven't extracted anything.");
      return false;
    }
    startJob(id, asked, { type: "extract", filled: 0 });
    const ticks: Array<[number, number, () => void]> = [];
    for (let filled = 1; filled <= EXTRACT_CELLS; filled++) ticks.push([filled === 1 ? 760 : 360, filled / EXTRACT_CELLS, () => setCard(id, 0, { type: "extract", filled })]);
    const job = runJob(id, EXTRACT_HOLD, EXTRACT_SPENT, ticks);
    return followUp(token, id, 3, async (t) => {
      if (!(await follow(t, job))) {
        await stream(t, id, "Okay, I cancelled the extraction. The values it had read so far are kept.");
        return false;
      }
      await wait(t, 500);
      await stream(
        t,
        id,
        "Three are randomized trials and one a quasi-experiment. Ghana's bilingual trial has the largest sample, 3,559 students in 198 schools, in grades 2 and 3 [3]. The Kenya trial compares three arms with a control in grades 1 and 2, but its abstract gives no sample [1]. The Ghana quasi-experiment matched 2,400 pupils across 80 primary schools [4]. The storybook study has no abstract, so its title is all there is: it calls itself a randomized trial [2].",
        3,
      );
      return true;
    });
  };

  const undoFeature = (id: number) => {
    setNext((n) => Math.min(n, 4));
    patch(id, (t) => ({ steps: t.steps.map((s) => (s.kind === "library" ? { ...s, status: "undone", onUndo: undefined } : s)) }));
  };

  const feature = async (token: number, id: number) => {
    await work(token, id, 0, { kind: "library", title: "Reading the library's draft", detail: LIBRARY.name, status: "working" },
      { title: "Read the library's draft", detail: <Facts items={HOME_TEXT.map((label) => ({ label: `No ${label.toLowerCase()}`, tone: "missing" as const }))} /> }, 900, 2);
    await work(token, id, 1, { kind: "library", title: "Writing the homepage text", detail: <Facts items={HOME_TEXT.map((label) => ({ label }))} />, status: "working" },
      { title: "Wrote the homepage text", detail: <Facts items={HOME_TEXT.map((label) => ({ icon: Check, label, tone: "good" as const }))} /> }, 1400, 12);
    await work(token, id, 2, { kind: "library", title: "Featuring the collection", detail: homeRef.current.name, status: "working" },
      { title: "Featured the collection", onUndo: () => undoFeature(id) }, 900, 2);
    await stream(token, id, `I wrote the homepage intro, a tagline and a description, and put “${homeRef.current.name}” first among the homepage collections. It's saved as a draft of ${LIBRARY.name}, so visitors don't see it yet.`);
  };

  const publish = async (token: number, id: number) => {
    await work(token, id, 0, { kind: "publish", title: "Checking the draft", detail: <Facts items={[{ icon: LayoutList, label: "All sections" }]} />, status: "working" },
      { title: "Checked the draft", detail: <Facts items={[{ icon: Check, label: "No issues", tone: "good" }]} /> }, 900, 2);
    const { choice } = await approve(token, id, publishAsk(homeRef.current.name));
    if (choice === "no") {
      await stream(token, id, "Okay, it stays a draft.");
      return false;
    }
    setCard(id, 0, { type: "publish", stage: 0 });
    for (let stage = 1; stage <= PUBLISH_FAILS_AT; stage++) {
      await wait(token, 900);
      setCard(id, 0, { type: "publish", stage });
    }
    if (!publishFailed.current) {
      await wait(token, 1700);
      publishFailed.current = true;
      // Listen for Try again before the card offers it, so an early click counts.
      const retried = new Promise<void>((resolve) => {
        retryWait.current = { token, resolve };
      });
      setCard(id, 0, { type: "publish", stage: PUBLISH_FAILS_AT, failed: true });
      await stream(token, id, "The library didn't confirm the new settings in time, so it kept the old ones. Nothing changed for visitors, and the draft is safe. Trying again publishes the same approved draft.", 1);
      await retried;
      retryWait.current = null;
      if (token !== run.current) throw new Stopped();
      patch(id, () => ({ text: "", shown: 0 }));
      setCard(id, 0, { type: "publish", stage: PUBLISH_FAILS_AT });
    }
    for (let stage = PUBLISH_FAILS_AT + 1; stage <= PUBLISH_STAGES.length; stage++) {
      await wait(token, 1100);
      setCard(id, 0, { type: "publish", stage });
    }
    await stream(token, id, `It's live at ${LIBRARY.address}, with the new homepage and “${homeRef.current.name}” first among its collections.`, 1);
    return true;
  };

  const SCRIPT = [optimize, screen, collect, extract, feature, publish];

  /** Runs one step of the script as a new reply. */
  const execute = async (step: number) => {
    const token = ++run.current;
    const id = ++ids.current;
    setBusy(true);
    setReply({ id, spent: 0, cap: REPLY_CAP, paused: false });
    setTurns((all) => [...all, { kind: "assistant", id, steps: [], text: "", shown: 0, cards: [] }]);
    try {
      await wait(token, 450);
      if ((await SCRIPT[step]!(token, id)) === false) return;
      setNext(step + 1);
    } catch (error) {
      if (!(error instanceof Stopped)) throw error;
    } finally {
      if (token === run.current) setBusy(false);
    }
  };

  const snapshot = (): Snapshot => ({ always: alwaysRef.current, balance: balanceRef.current, home: homeRef.current, owner: collectionOwner.current });
  const restore = (snap: Snapshot) => {
    setAlways(snap.always);
    setBalance(snap.balance);
    setHome(snap.home);
    collectionOwner.current = snap.owner;
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    // A typed reply to a question answers it: here, the name of a new collection.
    if (question.current?.token === run.current) {
      setDraft("");
      question.current.resolve({ id: "new", typed: text });
      return;
    }
    if (busy || next >= PROMPTS.length) return;
    const snap = snapshot();
    setDraft("");
    setTurns((all) => [...all, { kind: "user", id: ++ids.current, text, step: next, snap }]);
    void execute(next);
  };

  /** Runs a message again from where it was sent, dropping what came after it; `text` edits it first. */
  const rerun = (userId: number, text?: string) => {
    const user = turns.find((t): t is UserTurn => t.kind === "user" && t.id === userId);
    if (!user) return;
    halt();
    restore(user.snap);
    const edited = text !== undefined && text.trim() !== user.text;
    // The collection current when the message was sent comes back as it was, undo and all.
    const kept = turns.slice(0, turns.findIndex((t) => t.id === userId)).map((t): Turn =>
      t.kind === "assistant" && t.id === user.snap.owner
        ? { ...t, cards: t.cards.map((c): Card => (c.type === "collection" ? { ...c, undone: false } : c)) }
        : t,
    );
    setTurns([...kept, { ...user, text: text?.trim() || user.text, edited: user.edited || edited }]);
    setNext(user.step);
    void execute(user.step);
  };

  /** Continues a stopped reply: it waits for its job, if still running, then finishes what it was doing. */
  const resume = (id: number) => {
    const rest = continuations.current.get(id);
    if (!rest) return;
    const token = ++run.current;
    setBusy(true);
    setReply({ id, spent: replyRef.current?.id === id ? replyRef.current.spent : 0, cap: REPLY_CAP, paused: false });
    patch(id, (t) => ({ stopped: false, text: "", shown: 0, steps: t.steps.filter((s) => s.status !== "stopped") }));
    void (async () => {
      try {
        const ok = await rest.run(token);
        continuations.current.delete(id);
        if (ok !== false) setNext(rest.step + 1);
      } catch (error) {
        if (!(error instanceof Stopped)) throw error;
      } finally {
        if (token === run.current) setBusy(false);
      }
    })();
  };
  const allowMore = () => {
    if (capWait.current?.token === run.current) capWait.current.resolve();
  };

  const answer = (choice: Choice) => {
    const pending = decide.current;
    if (!pending || pending.token !== run.current) return;
    // The buttons are about to go; keep keyboard focus in the chat.
    composer.current?.focus();
    pending.resolve(choice);
  };
  const pick = (id: string) => {
    if (question.current?.token === run.current) question.current.resolve({ id });
  };
  const retryPublish = () => {
    if (retryWait.current?.token === run.current) retryWait.current.resolve();
  };

  const restart = () => {
    cancelRun();
    for (const job of jobs.current.values()) job.cancelled = true;
    jobs.current.clear();
    continuations.current.clear();
    setReply(null);
    setTurns([]);
    setAlways(false);
    setBalance(BALANCE);
    setHome(START_HOME);
    publishFailed.current = false;
    setNext(0);
    setDraft("");
  };

  const undoCollection = (id: number) => {
    if (collectionOwner.current !== id) return;
    collectionOwner.current = null;
    patch(id, (t) => ({ cards: t.cards.map((c) => (c.type === "collection" ? { ...c, undone: true } : c)) }));
  };

  const push = (sheet: OpenSheet) => setSheets((all) => [...all, sheet]);
  const pop = () => setSheets((all) => all.slice(0, -1));
  const fold = () => {
    setSheets([]);
    setOpen(false);
  };
  const depth = sheets.length;
  const chatTitle = turns.length ? TITLE : "New chat";

  const last = turns.at(-1);
  const lastCards = last?.kind === "assistant" ? last.cards : [];
  const asking = lastCards.some((c) => c.type === "question" && c.picked === null);
  const pendingAsk = lastCards.flatMap((c) => (c.type === "approval" && c.status === "pending" && c.ask.credits ? [c.ask] : []))[0];
  const lastUser = turns.findLast((t) => t.kind === "user")?.id ?? null;
  const cards = turns.flatMap((t) => (t.kind === "assistant" ? t.cards.filter((c) => !("cancelled" in c && c.cancelled)) : []));
  const screening = cards.find((c): c is Extract<Card, { type: "job" }> => c.type === "job");
  const extraction = cards.find((c): c is Extract<Card, { type: "extract" }> => c.type === "extract");
  const running =
    extraction && extraction.filled < EXTRACT_CELLS
      ? extraction.filled / EXTRACT_CELLS
      : screening && screening.done < 24
        ? screening.done / 24
        : null;
  // A stopped reply that can continue offers Continue in the thread, so no new request is suggested.
  const resumable = last?.kind === "assistant" && last.stopped && continuations.current.has(last.id);
  const suggestion = !busy && !resumable && next < PROMPTS.length ? PROMPTS[next] : null;

  return (
    <MotionConfig reducedMotion="user">
      <EdgeGlow open={open} working={busy} />
      {/* The panel hovers above the page: it's fixed, and the page underneath keeps its full width. */}
      <AnimatePresence>
        {open ? (
          <motion.aside
            key="panel"
            layoutId="assistant-shell"
            // Measure only when the panel opens or folds, never on other re-renders.
            layoutDependency={open}
            transition={SHELL_SPRING}
            className="fixed bottom-3 right-3 top-3 z-40 max-w-[calc(100vw-1.5rem)] sm:bottom-4 sm:right-4 sm:top-4"
            style={{ width: PANEL_W, borderRadius: 18 }}
            aria-label="OpenScholar assistant"
          >
            <motion.div
              className="absolute inset-0 flex flex-col overflow-hidden rounded-[18px] border border-border/70 bg-card/[0.97] shadow-[0_24px_80px_-24px_rgb(0_0_0/0.55),0_0_0_1px_rgb(255_255_255/0.03)] backdrop-blur-xl"
              style={{ transformOrigin: "0% 50%" }}
              initial={false}
              animate={stackedUnder(depth)}
              transition={SHEET_SPRING}
            >
              <TooltipHint label="Fold away  ⌘J">
                <motion.button
                  type="button"
                  layoutId="assistant-logo"
                  layoutDependency={open}
                  onClick={fold}
                  aria-label="Fold the assistant away"
                  transition={SHELL_SPRING}
                  className="absolute left-4 top-3.5 z-10 flex size-9 items-center justify-center rounded-xl bg-primary/10 hover:bg-primary/15"
                >
                  <LogoMark size={24} draw working={busy} />
                </motion.button>
              </TooltipHint>
              <motion.div
                className="flex min-h-0 flex-1 flex-col"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.16, duration: 0.25 } }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
              >
                <Header
                  title={chatTitle}
                  onHistory={() => push({ kind: "history", chat: chatTitle })}
                  onShare={() => push({ kind: "share", chat: chatTitle })}
                  onRestart={restart}
                  onCollapse={fold}
                />
                <Thread
                  turns={turns}
                  view={view}
                  balance={balance}
                  busy={busy}
                  lastUser={lastUser}
                  onAnswer={answer}
                  onTopUp={() => push({ kind: "topup", chat: chatTitle, balance, need: (pendingAsk?.credits ?? 0) - balance, purpose: pendingAsk })}
                  onPick={pick}
                  onRetryPublish={retryPublish}
                  onUndoCollection={undoCollection}
                  onRerun={rerun}
                  onCancelJob={cancelJob}
                  canContinue={(id) => continuations.current.has(id)}
                  onContinue={resume}
                />
                <Footer
                  suggestion={suggestion}
                  done={!busy && next >= PROMPTS.length}
                  onSuggestion={send}
                  onRestart={restart}
                  composer={composer}
                  draft={draft}
                  setDraft={setDraft}
                  busy={busy}
                  asking={asking}
                  onSend={() => send(draft.trim() || suggestion || "")}
                  onStop={stop}
                  reply={busy ? reply : null}
                  onAllowMore={allowMore}
                  always={always}
                  onStopAlways={() => setAlways(false)}
                  view={view}
                />
              </motion.div>
              <Dim on={depth > 0} />
            </motion.div>
            <AnimatePresence>
              {sheets.map((sheet, i) => (
                <Sheet key={`${i}-${sheet.kind}`} index={i} depth={depth - 1 - i}>
                  {sheet.kind === "history" ? (
                    <HistorySheet onBack={pop} onShare={(chat) => push({ kind: "share", chat })} />
                  ) : sheet.kind === "share" ? (
                    <ShareSheet chat={sheet.chat} onBack={pop} />
                  ) : (
                    <TopUpSheet
                      balance={sheet.balance ?? balance}
                      need={sheet.need ?? 0}
                      purpose={sheet.purpose}
                      onBack={pop}
                      onBought={(credits) => setBalance(balanceRef.current + credits)}
                    />
                  )}
                </Sheet>
              ))}
            </AnimatePresence>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {!open ? <Launcher key="launcher" working={busy} progress={running} onOpen={() => setOpen(true)} /> : null}
      </AnimatePresence>
    </MotionConfig>
  );
}

/** A publish in progress: each stage checks off, then the library is live. A failed stage offers a retry. */
function PublishCard({ stage, failed, stopped, onRetry }: { stage: number; failed?: boolean; stopped?: boolean; onRetry: () => void }) {
  const live = stage >= PUBLISH_STAGES.length;
  const still = failed || stopped;
  return (
    <div className={cn("rounded-2xl border bg-muted/40 p-4 transition-colors", failed ? "border-destructive/30" : "border-border/60")}>
      <div className="flex h-9 items-center gap-3">
        <KindTile kind="publish" working={!live && !still} />
        <p className="min-w-0 flex-1 text-sm font-semibold">
          {live ? "Published" : failed ? "Couldn't publish" : stopped ? "Publishing stopped" : <WorkingText>Publishing the new homepage</WorkingText>}
        </p>
        {live ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">Live</span>
        ) : failed && !stopped ? (
          <Button size="sm" variant="secondary" className="h-8 gap-1.5 rounded-full px-3" onClick={onRetry}>
            <RotateCcw className="size-3.5" /> Try again
          </Button>
        ) : null}
      </div>
      <ol className="mt-3 space-y-2">
        {PUBLISH_STAGES.map((label, i) => {
          const tone = i < stage ? "success" : i === stage && !live ? (failed ? "danger" : stopped ? "neutral" : "running") : "neutral";
          return (
            <li key={label} className="flex items-center gap-2.5 text-sm">
              <StatusIcon tone={tone} label={tone === "success" ? "Done" : tone === "danger" ? "Failed" : tone === "running" ? "Running" : "Waiting"} />
              <span className={cn(i > stage ? "text-muted-foreground" : "text-foreground/90")}>{label}</span>
              {tone === "danger" ? <span className="text-xs text-muted-foreground">No answer</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Reply text, with [n] turned into citation chips once each token has fully streamed in. */
function Reply({ text, shown }: { text: string; shown: number }) {
  const visible = text.slice(0, shown);
  const parts = visible.split(/(\[\d\])/);
  return (
    <p className="text-sm leading-relaxed text-foreground">
      {parts.map((part, i) => {
        const cite = /^\[(\d)\]$/.exec(part);
        return cite ? <Cite key={i} n={Number(cite[1])} /> : <span key={i}>{part.replace(/\[\d?$/, "")}</span>;
      })}
      {shown < text.length ? (
        <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-pulse bg-primary motion-reduce:animate-none" />
      ) : null}
    </p>
  );
}

/** The folded panel: the mark, with a ring for a running job. It would sit on every page. */
function Launcher({ working, progress, onOpen }: { working: boolean; progress: number | null; onOpen: () => void }) {
  return (
    <TooltipHint label="Open the assistant  ⌘J">
      <motion.button
        type="button"
        layoutId="assistant-shell"
        layoutDependency={false}
        onClick={onOpen}
        aria-label="Open the assistant"
        transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.9 }}
        className="fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center border border-border/60 bg-card shadow-lg transition-colors hover:bg-muted"
        style={{ borderRadius: 18 }}
      >
        <motion.span
          layoutId="assistant-logo"
          layoutDependency={false}
          transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.9 }}
          className="relative flex size-11 items-center justify-center rounded-xl"
        >
          <LogoMark size={30} working={working} />
        </motion.span>
        {progress !== null ? (
          <svg className="pointer-events-none absolute -inset-1" viewBox="0 0 64 64" aria-hidden>
            <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={2.5} />
            <motion.circle
              cx="32"
              cy="32"
              r="30"
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2.5}
              strokeLinecap="round"
              transform="rotate(-90 32 32)"
              initial={false}
              animate={{ pathLength: progress }}
              transition={{ duration: 0.3, ease: EASE }}
            />
          </svg>
        ) : null}
      </motion.button>
    </TooltipHint>
  );
}

function Thread({
  turns,
  view,
  balance,
  busy,
  lastUser,
  onAnswer,
  onTopUp,
  onPick,
  onRetryPublish,
  onUndoCollection,
  onRerun,
  onCancelJob,
  canContinue,
  onContinue,
}: {
  turns: Turn[];
  view: string;
  balance: number;
  busy: boolean;
  lastUser: number | null;
  onAnswer: (choice: Choice) => void;
  onTopUp: () => void;
  onPick: (id: string) => void;
  onRetryPublish: () => void;
  onUndoCollection: (id: number) => void;
  onRerun: (userId: number, text?: string) => void;
  onCancelJob: (turnId: number) => void;
  /** Whether a stopped reply still has work to finish once its job ends. */
  canContinue: (turnId: number) => boolean;
  onContinue: (turnId: number) => void;
}) {
  return (
    <Conversation className="min-h-0 flex-1" style={{ maskImage: `linear-gradient(to bottom, transparent, black ${EDGE_FADE}px)` }}>
      <ConversationContent className="gap-5 overflow-x-clip px-4 py-4">
        {turns.length === 0 ? <Empty view={view} /> : null}
        {turns.map((t, i) => {
          if (t.kind === "user") return <UserBubble key={t.id} turn={t} editable={t.id === lastUser} onEdit={(text) => onRerun(t.id, text)} />;
          const asker = turns[i - 1];
          return (
            <div key={t.id} className="space-y-3">
              {t.steps.length ? <RunMap steps={t.steps} /> : t.stopped ? null : <Thinking />}
              <AnimatePresence mode="popLayout" initial={false}>
                {t.cards.map((c, j) => (
                  <motion.div
                    key={`${j}-${c.type}`}
                    layout="position"
                    initial={{ opacity: 0, scale: 0.97, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.4, ease: EASE }}
                  >
                    {c.type === "approval" ? (
                      <ApprovalCard
                        ask={c.ask}
                        status={c.status}
                        balance={balance}
                        onAllow={() => onAnswer("once")}
                        onAlways={() => onAnswer("always")}
                        onDecline={() => onAnswer("no")}
                        onTopUp={onTopUp}
                      />
                    ) : c.type === "job" ? (
                      <JobCard done={c.done} total={24} counts={countUpTo(c.done, c.settled)} waiting={c.waiting} cancelled={c.cancelled} onCancel={() => onCancelJob(t.id)} />
                    ) : c.type === "extract" ? (
                      <ExtractionCard filled={c.filled} cancelled={c.cancelled} onCancel={() => onCancelJob(t.id)} />
                    ) : c.type === "publish" ? (
                      <PublishCard stage={c.stage} failed={c.failed} stopped={t.stopped} onRetry={onRetryPublish} />
                    ) : c.type === "question" ? (
                      <QuestionCard
                        question="Where should the 4 studies go?"
                        hint="Pick one, or type a name for a new collection"
                        options={COLLECTION_CHOICES.map((o) => ({
                          id: o.id,
                          name: o.name,
                          detail: (
                            <Facts
                              items={o.id === "new" ? [{ icon: FolderPlus, label: "New collection" }] : [{ value: o.count, label: "papers" }, { value: `+${COLLECTED}`, label: "new", tone: "good" }]}
                            />
                          ),
                        }))}
                        picked={c.picked}
                        typed={c.typed}
                        onPick={onPick}
                      />
                    ) : (
                      <CollectionCard name={c.name} count={c.count} undone={c.undone} canUndo={!busy} onUndo={() => onUndoCollection(t.id)} />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {t.text ? <Reply text={t.text} shown={t.shown} /> : null}
              {t.stopped && asker?.kind === "user" ? (
                canContinue(t.id) ? <StoppedRow resumable onRetry={() => onContinue(t.id)} /> : <StoppedRow onRetry={() => onRerun(asker.id)} />
              ) : null}
            </div>
          );
        })}
      </ConversationContent>
    </Conversation>
  );
}

/**
 * Under a reply that was stopped: it says so, and offers to run the message again. When
 * its job is still going, Stop left the job alone, so it offers to continue instead.
 */
function StoppedRow({ onRetry, resumable }: { onRetry: () => void; resumable?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="flex h-8 items-center gap-2 text-xs text-muted-foreground"
    >
      <CircleStop className="size-3.5" /> {resumable ? "You stopped this reply. The job keeps going" : "You stopped this reply"}
      <button
        type="button"
        onClick={onRetry}
        className="ml-1 flex h-7 items-center gap-1 rounded-full px-2.5 font-medium text-foreground/80 hover:bg-muted hover:text-foreground"
      >
        {resumable ? <Play className="size-3" /> : <RotateCcw className="size-3" />} {resumable ? "Continue" : "Try again"}
      </button>
    </motion.div>
  );
}

/**
 * A message you sent. The latest one can be edited in place: the bubble turns into
 * an editor, and sending runs it again from there, dropping the replies after it.
 */
function UserBubble({ turn, editable, onEdit }: { turn: UserTurn; editable: boolean; onEdit: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(turn.text);
  const save = () => {
    if (!text.trim()) return;
    setEditing(false);
    onEdit(text);
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className={cn("group relative ml-10 self-end", editing && "w-[calc(100%-2.5rem)]")}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {editing ? (
          <motion.div
            key="edit"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            style={{ transformOrigin: "100% 50%" }}
            className="rounded-2xl rounded-br-sm border border-primary/40 bg-background p-2 ring-2 ring-primary/15"
          >
            <textarea
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the editor opens on purpose, from the edit button
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  save();
                }
                if (e.key === "Escape") setEditing(false);
              }}
              rows={2}
              aria-label="Edit your message"
              className="block w-full resize-none bg-transparent px-2 py-1 text-sm outline-none"
            />
            <div className="flex justify-end gap-1.5 pt-1">
              <Button size="sm" variant="ghost" className="h-7 rounded-full px-3" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" className="h-7 rounded-full px-3" disabled={!text.trim()} onClick={save}>
                Send
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="view" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }} style={{ transformOrigin: "100% 50%" }}>
            <div className="rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 text-sm leading-6">
              <MessageText text={turn.text} />
            </div>
            {turn.edited ? <p className="mt-1 pr-1 text-right text-[11px] text-muted-foreground">Edited</p> : null}
          </motion.div>
        )}
      </AnimatePresence>
      {editable && !editing ? (
        // Out of the flow, beside the bubble, so it never moves the message.
        <div className="absolute -left-9 top-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            small
            label="Edit"
            icon={<Pencil className="size-3.5" />}
            onClick={() => {
              setText(turn.text);
              setEditing(true);
            }}
          />
        </div>
      ) : null}
    </motion.div>
  );
}

/** Decisions so far; once the assistant settles the unclear ones, two of them move to excluded. */
function countUpTo(done: number, settled?: boolean) {
  const counts = { include: 0, exclude: 0, unsure: 0 };
  for (const d of SCREEN_ORDER.slice(0, done) as Decision[]) counts[d]++;
  if (settled) {
    counts.unsure -= SETTLED;
    counts.exclude += SETTLED;
  }
  return counts;
}

function Thinking() {
  return (
    <div className="flex h-9 items-center gap-2 pl-1 text-sm">
      <LogoMark size={18} working />
      <WorkingText>Thinking</WorkingText>
    </div>
  );
}

function Empty({ view }: { view: string }) {
  return (
    <div className="space-y-5 pt-2">
      <div className="space-y-1">
        <p className="text-base font-semibold">Ask about anything here</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          I can see the page you&apos;re on and use everything you can: search, screen, extract, collect and publish. Type @ to point at something exact.
        </p>
      </div>
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 pl-1 text-xs font-medium text-muted-foreground">
          <Eye className="size-3.5" /> What I can see
        </p>
        <RunMap
          steps={[
            { kind: "navigate", title: view, detail: "The page you're on", status: "done" },
            ...ACCOUNT.map((a): Step => ({ kind: a.kind, title: a.title, detail: a.latest, status: "done" })),
          ]}
          plain
        />
      </div>
    </div>
  );
}

function Header({
  title,
  onHistory,
  onShare,
  onRestart,
  onCollapse,
}: {
  title: string;
  onHistory: () => void;
  onShare: () => void;
  onRestart: () => void;
  onCollapse: () => void;
}) {
  return (
    <div className="border-b border-border/50 px-4 pb-3 pt-3.5">
      <div className="flex items-center gap-2.5">
        {/* The logo itself sits on the panel, above this spacer, so it can fly into the launcher. */}
        <span className="size-9 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={title}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="truncate text-sm font-semibold"
            >
              {title}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="flex items-center">
          <IconButton label="Chats" icon={<MessagesSquare className="size-4" />} onClick={onHistory} />
          <IconButton label="Share this chat" icon={<UserPlus className="size-4" />} onClick={onShare} />
          <IconButton label="New chat" icon={<SquarePen className="size-4" />} onClick={onRestart} />
          <IconButton label="Fold into a bubble  ⌘J" icon={<PictureInPicture2 className="size-4" />} onClick={onCollapse} />
        </div>
      </div>
    </div>
  );
}

/**
 * The chat's model and effort, beside Send, on the shared model picker with each
 * preset's chat model first. It starts on the Balanced preset's chat model.
 */
function ModelPill() {
  const tm = useTranslations("settingsAi");
  const presetModel = usePresetModels();
  const [picked, setPicked] = useState<PickedModel | null>(null);
  const model = picked ?? presetModel?.("balanced", "chat") ?? null;
  const presets: PresetPick[] = presetModel
    ? PRESET_KEYS.flatMap((preset) => {
        const m = presetModel(preset, "chat");
        return m ? [{ id: preset, models: [m], onSelect: () => setPicked(m) }] : [];
      })
    : [];
  const effort = model ? effortOf(model) : null;
  const Brand = getModelIcon(model?.id ?? "");
  return (
    <ModelPicker
      align="end"
      side="top"
      tasks={["chat"]}
      presets={presets}
      efforts
      current={model ?? undefined}
      onChange={(m, e) => setPicked(e ? { ...m, effort: e } : m)}
      trigger={
        // Right-aligned, so while the presets load nothing beside it moves when it fills in.
        <button
          type="button"
          aria-label={model ? [stripProviderPrefix(model.name), effort && tm(`efforts.${effort}`)].filter(Boolean).join(", ") : "Model"}
          className={cn(
            "ml-auto flex h-8 min-w-0 items-center gap-2 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground",
            !model && "pointer-events-none opacity-0",
          )}
        >
          <Brand className="size-3.5 shrink-0 text-foreground/80" />
          <TooltipHint label={model ? stripProviderPrefix(model.name) : ""} onlyWhenClipped>
            <span className="min-w-0 truncate">{model ? stripProviderPrefix(model.name) : ""}</span>
          </TooltipHint>
          {model?.reasoningEfforts && effort ? (
            <span className="shrink-0">
              <EffortMeter levels={model.reasoningEfforts} level={effort} filled="bg-current" small />
            </span>
          ) : null}
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      }
    />
  );
}

function IconButton({ label, icon, onClick, small }: { label: string; icon: ReactNode; onClick?: () => void; small?: boolean }) {
  return (
    <TooltipHint label={label}>
      <button
        type="button"
        aria-label={label.split("  ")[0]}
        onClick={onClick}
        className={cn(
          "flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground",
          small ? "size-7" : "size-8",
        )}
      >
        {icon}
      </button>
    </TooltipHint>
  );
}

/**
 * What the running reply has spent on its own AI use, against its per-reply cap. At the
 * cap the reply pauses here until the person allows more.
 */
function ReplyMeter({ reply, onAllowMore }: { reply: Reply; onAllowMore: () => void }) {
  // One cell: the meter and the pause cross-fade, so the row never changes size.
  return (
    <div className="grid h-8 items-center text-xs [&>*]:col-start-1 [&>*]:row-start-1">
      <motion.div initial={false} animate={{ opacity: reply.paused ? 0 : 1 }} inert={reply.paused} className="flex items-center gap-2 pl-1">
        <Coins className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">This reply</span>
        <span className="h-1 w-16 overflow-hidden rounded-full bg-foreground/10">
          <motion.span
            className="block h-full rounded-full bg-primary"
            initial={false}
            animate={{ width: `${Math.min(1, reply.spent / reply.cap) * 100}%` }}
            transition={{ duration: 0.3, ease: EASE }}
          />
        </span>
        <span className="tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{reply.spent}</span> of {reply.cap} credits
        </span>
      </motion.div>
      <motion.div initial={false} animate={{ opacity: reply.paused ? 1 : 0 }} inert={!reply.paused} className="flex items-center gap-2 pl-1">
        <CirclePause className="size-3.5 text-amber-600 dark:text-amber-400" />
        <span className="font-medium text-amber-700 dark:text-amber-400">Paused at this reply's {reply.cap}-credit cap</span>
        <Button size="sm" variant="secondary" className="h-7 rounded-full px-3" onClick={onAllowMore}>
          Allow {REPLY_CAP} more
        </Button>
      </motion.div>
    </div>
  );
}

function Footer({
  suggestion,
  done,
  onSuggestion,
  onRestart,
  composer,
  draft,
  setDraft,
  busy,
  asking,
  onSend,
  onStop,
  reply,
  onAllowMore,
  always,
  onStopAlways,
  view,
}: {
  suggestion: string | null;
  done: boolean;
  onSuggestion: (s: string) => void;
  onRestart: () => void;
  composer: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  busy: boolean;
  /** The assistant asked something; a typed message answers it. */
  asking: boolean;
  onSend: () => void;
  onStop: () => void;
  /** The running reply's own spending, shown while it runs. */
  reply: Reply | null;
  onAllowMore: () => void;
  /** Credits are allowed for this chat; the chip turns that off. */
  always: boolean;
  onStopAlways: () => void;
  view: string;
}) {
  // While a reply runs, Send becomes Stop, unless there's a typed answer to send.
  const stopping = busy && !(asking && draft.trim());
  return (
    <div className="space-y-2 p-3 pt-0">
      <div className="flex h-8 items-center gap-2">
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            {reply ? (
              <motion.div
                key="reply"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                <ReplyMeter reply={reply} onAllowMore={onAllowMore} />
              </motion.div>
            ) : suggestion ? (
              <motion.button
                key={suggestion}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease: EASE }}
                onClick={() => onSuggestion(suggestion)}
                className="flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 text-xs font-medium text-foreground/80 hover:border-border hover:bg-muted/50"
              >
                <Sparkles className="size-3 shrink-0 text-primary" />
                <span className="truncate">
                  <MessageText text={suggestion} />
                </span>
              </motion.button>
            ) : done ? (
              <motion.button
                key="again"
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease: EASE }}
                onClick={onRestart}
                className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 text-xs font-medium text-foreground/80 hover:bg-muted/50"
              >
                <RotateCcw className="size-3" /> Play it again
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
        <AnimatePresence initial={false}>
          {always ? (
            <motion.span
              key="always"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: "spring", stiffness: 480, damping: 32 }}
              className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary/10 pl-2.5 pr-1 text-xs font-medium text-primary"
            >
              <Coins className="size-3" /> Credits allowed
              <TooltipHint label="Ask before spending credits again">
                <button
                  type="button"
                  aria-label="Ask before spending credits again"
                  onClick={onStopAlways}
                  className="flex size-5 items-center justify-center rounded-full hover:bg-primary/15"
                >
                  <X className="size-3" />
                </button>
              </TooltipHint>
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
      <div className="rounded-2xl border border-border/60 bg-background shadow-xs focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
        <MentionComposer
          composer={composer}
          draft={draft}
          setDraft={setDraft}
          onSend={onSend}
          placeholder={asking ? "Or type a name for a new collection" : "Ask, or type @ to point at something"}
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <span className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-muted/60 px-2.5 text-xs text-muted-foreground">
            <Eye className="size-3" /> Sees {view}
          </span>
          <ModelPill />
          <TooltipHint label={stopping ? "Stop" : "Send"}>
            <button
              type="button"
              aria-label={stopping ? "Stop" : "Send"}
              onClick={stopping ? onStop : onSend}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={stopping ? "stop" : "send"}
                  initial={{ opacity: 0, scale: 0.4, rotate: stopping ? -90 : 90 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.4 }}
                  transition={{ type: "spring", stiffness: 520, damping: 30 }}
                  className="flex"
                >
                  {stopping ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-4" />}
                </motion.span>
              </AnimatePresence>
            </button>
          </TooltipHint>
        </div>
      </div>
    </div>
  );
}
