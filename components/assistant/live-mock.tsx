"use client";

// MOCK (branch mock/live-activities): the assistant's panel with scripted data, to agree on
// live job cards docked at the bottom of the chat, the Thinking row, the compact extraction
// card and running jobs in the Chats sheet. It reuses the real panel's pieces; nothing here
// reads or writes Convex.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { useFormatter, useNow } from "next-intl";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger, useReasoning } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { ChevronDown } from "@/components/icons";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { EDGE_FADE } from "@/components/ui/scroll-area";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { ExtractionCard, JOB_CARD_H, ScreeningCard, type Extraction, type Screening } from "./job-cards";
import { OrbitMark } from "./orbit-mark";
import { CHIP_HANG, Footer, Header, PANEL_W, UserBubble } from "./panel";
import { WorkingText } from "./parts";
import { ChatRow, Dim, SHEET_SPRING, Sheet, SheetHeader, stackedUnder, type Chat } from "./sheets";
import { RunMap, type StepItem } from "./steps";

type Variant = "now" | "shimmer" | "reasoning";
type Job = (Screening & { started: number }) | (Extraction & { started: number });

const GAP = 8;
/** How far a card behind the front one shows above it while the stack is folded. */
const PEEK = 16;
/** The "Show less" row above an opened stack. */
const LESS_H = 28;

const T0 = Date.now();
const screening = (): Job => ({ kind: "screening", jobId: "mock-screening" as Id<"screeningJobs">, status: "processing", label: "Loot boxes", total: 1000, included: 212, excluded: 7, unclear: 51, failed: 0, credits: 272, started: 1 });
const extraction = (): Job => ({ kind: "extraction", jobId: "mock-extraction" as Id<"extractionJobs">, status: "extracting", name: "Study design and sample size", total: 60, done: 21, failed: 1, credits: 64, questions: [], rows: [], started: 2 });
const another = (): Job => ({ kind: "screening", jobId: "mock-screening-2" as Id<"screeningJobs">, status: "processing", label: "Gambling harms", total: 240, included: 0, excluded: 0, unclear: 0, failed: 0, credits: 0, started: 3 });

const running = (job: Job) => job.status === "processing" || job.status === "extracting";

/** Moves each running job on by a beat, as the real ones fill in. */
function tick(job: Job): Job {
  if (!running(job)) return job;
  if (job.kind === "screening") {
    const done = job.included + job.excluded + job.unclear + job.failed;
    const step = Math.min(job.total - done, 2 + Math.floor(Math.random() * 4));
    const roll = Math.random();
    const next = { ...job, credits: job.credits + step };
    if (roll < 0.76) next.included += step;
    else if (roll < 0.8) next.excluded += step;
    else next.unclear += step;
    if (done + step >= job.total) next.status = "completed";
    return next;
  }
  if (Math.random() < 0.6) return job;
  const failed = Math.random() < 0.05 ? 1 : 0;
  const done = Math.min(job.total, job.done + 1);
  return { ...job, done, failed: job.failed + failed, credits: job.credits + 3, status: done >= job.total ? "completed" : job.status };
}

const step = (id: string, action: string, extra: Partial<StepItem>): StepItem =>
  ({ id, role: "step", order: 1, action, status: "done", canAnswer: false, canUndo: false, undone: false, at: T0, ...extra }) as StepItem;

const STEPS: StepItem[] = [
  step("s1", "research/searches:get", { subject: "loot boxes microtransactions gambling", count: 1000 }),
  step("s2", "screening/start:screen", { subject: "Loot boxes", credits: 1000 }),
  step("s3", "extraction/start:extract", { subject: "Study design and sample size", credits: 180 }),
];

const ASK = "While those run, which of the included papers so far are randomised trials?";
const THOUGHT =
  "The person wants randomised trials among the included papers. The screening is at a few hundred of 1,000, so only what's been decided so far counts. " +
  "I'll read the included papers and look for trial designs in their abstracts: \"randomised\", \"RCT\", \"controlled trial\". " +
  "Then I'll list them with their sample sizes, and say the list will grow as the screening carries on.";
const ANSWER =
  "So far **3** of the included papers are randomised trials:\n\n" +
  "1. *Loot box exposure and gambling intentions: a randomised experiment* (2022), 1,204 adolescents\n" +
  "2. *Effects of loot box disclosure labels on spending* (2023), 618 adults\n" +
  "3. *Priming with prize mechanics in mobile games* (2021), 302 students\n\n" +
  "The screening has more papers to decide, so I'll check again once it finishes.";

export function LiveMock() {
  const [jobs, setJobs] = useState<Job[]>(() => [screening(), extraction()]);
  const [variant, setVariant] = useState<Variant>("reasoning");
  // The follow-up question: nothing yet, thinking (with its reasoning so far), then answering.
  const [ask, setAsk] = useState<{ phase: "thinking" | "answering"; thought: string; answer: string; started: number; done?: boolean } | null>(null);
  const [history, setHistory] = useState(false);
  const [draft, setDraft] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);

  // A timer: the jobs fill in as real ones do.
  useEffect(() => {
    const timer = setInterval(() => setJobs((all) => all.map(tick)), 450);
    return () => clearInterval(timer);
  }, []);

  // A timer: the follow-up's reasoning streams in, then its answer.
  useEffect(() => {
    if (!ask || ask.done) return;
    const timer = setInterval(() => {
      setAsk((now) => {
        if (!now) return now;
        if (now.phase === "thinking") {
          const thought = THOUGHT.slice(0, now.thought.length + 3);
          return thought.length >= THOUGHT.length ? { ...now, thought, phase: "answering" } : { ...now, thought };
        }
        const answer = ANSWER.slice(0, now.answer.length + 4);
        return { ...now, answer, done: answer.length >= ANSWER.length };
      });
    }, 30);
    return () => clearInterval(timer);
  }, [ask?.done, ask === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => {
    setDraft("");
    setAsk({ phase: "thinking", thought: "", answer: "", started: Date.now() });
  };
  const docked = jobs.filter(running).sort((a, b) => b.started - a.started);
  const ended = jobs.filter((job) => !running(job));
  const busy = ask !== null && !ask.done;

  return (
    <MotionConfig reducedMotion="user">
      <aside className="fixed bottom-4 right-4 top-4 z-40 max-w-[calc(100vw-1.5rem)]" style={{ width: PANEL_W, borderRadius: 18 }} aria-label="Assistant (mock)">
        <motion.div
          className="absolute inset-0 flex flex-col overflow-hidden rounded-[18px] border border-border/70 bg-card shadow-[0_24px_80px_-24px_rgb(0_0_0/0.55),0_0_0_1px_rgb(255_255_255/0.03)]"
          style={{ transformOrigin: "0% 50%" }}
          initial={false}
          animate={stackedUnder(history ? 1 : 0)}
          transition={SHEET_SPRING}
        >
          <span className="absolute left-4 top-3.5 z-10 flex size-9 items-center justify-center rounded-xl bg-primary/10">
            <OrbitMark size={24} motion={busy ? "thinking" : "idle"} />
          </span>
          <Header title="Loot box screening" onHistory={() => setHistory(true)} onShare={() => {}} onSpending={() => {}} onRestart={() => {}} onFold={() => {}} />
          <LayoutGroup>
            <div className="relative flex min-h-0 flex-1 flex-col">
              <Thread variant={variant} ask={ask} ended={ended} dockH={dockHeight(docked.length)} />
              <Dock jobs={docked} />
            </div>
          </LayoutGroup>
          <Footer
            composer={composer}
            draft={draft}
            setDraft={setDraft}
            picked={[]}
            onPick={() => {}}
            busy={busy}
            summarizing={false}
            canWrite
            onSend={send}
            onStop={() => setAsk(null)}
            onComposerFocus={() => {}}
            model={null}
            onModel={() => {}}
            presetModel={undefined}
            meter={null}
            allowance={{ cap: 1500 }}
            onStopAllowance={() => {}}
            onCarryOn={() => {}}
            onSpending={() => {}}
          />
          <Dim on={history} />
        </motion.div>
        <AnimatePresence>
          {history ? (
            <Sheet key="history" index={0} depth={0}>
              <ChatsMock jobs={docked} onBack={() => setHistory(false)} />
            </Sheet>
          ) : null}
        </AnimatePresence>
      </aside>
      <Controls
        variant={variant}
        setVariant={setVariant}
        onAsk={send}
        onFinish={() => setJobs((all) => all.map((job) => (job.kind === "screening" && running(job) ? { ...job, included: job.total - job.excluded - job.unclear, credits: job.total, status: "completed" } : job)))}
        onAdd={() => setJobs((all) => (all.some((job) => job.jobId === "mock-screening-2") ? all : [...all, another()]))}
        onReplay={() => {
          setJobs([screening(), extraction()]);
          setAsk(null);
        }}
      />
    </MotionConfig>
  );
}

/** The dock's height: a folded stack is its front card with the peek of the ones behind. */
const dockHeight = (count: number) => (count === 0 ? 0 : JOB_CARD_H + Math.min(count - 1, 2) * PEEK + GAP);

/**
 * Running jobs, docked on the chat's bottom edge above the chips, the way a live activity
 * sits on a lock screen. One shows whole; more fold into a stack, newest in front, that opens
 * into a list when tapped. A job that ends leaves the dock and settles into the chat under the
 * steps that started it.
 */
function Dock({ jobs }: { jobs: Job[] }) {
  const [open, setOpen] = useState(false);
  const stacked = jobs.length > 1;
  const opened = open && stacked;
  const height = opened ? LESS_H + jobs.length * JOB_CARD_H + (jobs.length - 1) * GAP + GAP : dockHeight(jobs.length);
  return (
    <>
    {/* Opened, the chat behind the list fades back, and a tap on it folds the list again. */}
    <AnimatePresence>
      {opened ? (
        <motion.div
          key="scrim"
          aria-hidden
          className="absolute inset-0 z-10 bg-card/80"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          onClick={() => setOpen(false)}
        />
      ) : null}
    </AnimatePresence>
    <motion.div
      className="pointer-events-none absolute inset-x-3 z-10"
      style={{ bottom: CHIP_HANG + 6 }}
      initial={false}
      animate={{ height }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
    >
      {/* Opened, the chat behind it dims so the list reads as one layer. */}
      <AnimatePresence>
        {opened ? (
          <motion.button
            key="less"
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2, ease: EASE }}
            onClick={() => setOpen(false)}
            className="pointer-events-auto absolute right-0 top-0 flex h-7 items-center gap-1 rounded-full bg-card/90 px-3 text-xs font-medium text-foreground/80 shadow-xs ring-1 ring-border/60 backdrop-blur hover:text-foreground"
          >
            Show less <ChevronDown className="size-3" />
          </motion.button>
        ) : null}
      </AnimatePresence>
      {/* A card that leaves the dock has ended: it flies to its place in the chat (layoutId), so it has no exit of its own. */}
      {jobs.map((job, i) => {
          // Folded: the front card at the bottom, each one behind it a step up and a step smaller.
          const folded = { y: -i * PEEK, scale: 1 - i * 0.05, opacity: i > 2 ? 0 : 1 };
          const listed = { y: -i * (JOB_CARD_H + GAP), scale: 1, opacity: 1 };
          return (
            <motion.div
              key={job.jobId}
              layoutId={`job:${job.jobId}`}
              className={cn("pointer-events-auto absolute inset-x-0 bottom-0 origin-top rounded-2xl bg-card shadow-[0_10px_30px_-12px_rgb(0_0_0/0.35)]", stacked && !opened && i === 0 && "cursor-pointer")}
              style={{ height: JOB_CARD_H, zIndex: jobs.length - i }}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={opened ? listed : folded}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              onClickCapture={(event) => {
                // Folded, a tap anywhere but a control opens the stack.
                if (!stacked || opened || (event.target as HTMLElement).closest("a,button")) return;
                event.stopPropagation();
                setOpen(true);
              }}
            >
              <div inert={stacked && !opened && i > 0} className="h-full">
                <JobBody job={job} />
              </div>
            </motion.div>
          );
        })}
    </motion.div>
    </>
  );
}

function JobBody({ job }: { job: Job }) {
  return job.kind === "screening" ? <ScreeningCard job={job} mine /> : <ExtractionCard job={job} mine />;
}

function Thread({ variant, ask, ended, dockH }: { variant: Variant; ask: { phase: "thinking" | "answering"; thought: string; answer: string; started: number; done?: boolean } | null; ended: Job[]; dockH: number }) {
  return (
    <Conversation
      className="min-h-0 flex-1"
      style={{ maskImage: `linear-gradient(to bottom, transparent, black ${EDGE_FADE}px, black calc(100% - ${CHIP_HANG + EDGE_FADE}px), transparent calc(100% - ${CHIP_HANG}px))` }}
    >
      <ConversationContent className="gap-5 overflow-x-clip px-4 pt-4" style={{ paddingBottom: CHIP_HANG + EDGE_FADE + 8 + dockH, transition: "padding-bottom 0.35s cubic-bezier(0.22, 1, 0.36, 1)" }}>
        <UserBubble message={{ id: "m1", role: "user", order: 1, text: "Screen the 1,000 loot box papers in my search against my questions, and pull study design and sample size from the 60 I saved last week.", status: "done", mine: true, at: T0 }} />
        <div className="space-y-3">
          <RunMap threadId={"mock" as Id<"assistantThreads">} steps={STEPS} earlier={null} />
          {/* A job that ended settles here, under the steps that started it. */}
          {ended.map((job) => (
            <motion.div key={job.jobId} layoutId={`job:${job.jobId}`} className="rounded-2xl bg-card" style={{ height: JOB_CARD_H }} transition={{ type: "spring", stiffness: 380, damping: 36 }}>
              <JobBody job={job} />
            </motion.div>
          ))}
        </div>
        <div className="text-sm leading-relaxed text-foreground">
          <MessageResponse>Both are running. They stay pinned at the bottom of the chat while they work, and I&apos;ll write up what they found when they finish.</MessageResponse>
        </div>
        {ask ? (
          <>
            <UserBubble message={{ id: "m2", role: "user", order: 2, text: ASK, status: "done", mine: true, at: T0 }} />
            <Answer variant={variant} ask={ask} />
          </>
        ) : null}
      </ConversationContent>
    </Conversation>
  );
}

/** The follow-up's reply: thinking in the variant picked, then its text. */
function Answer({ variant, ask }: { variant: Variant; ask: { phase: "thinking" | "answering"; thought: string; answer: string; started: number; done?: boolean } }) {
  const thinking = ask.phase === "thinking";
  return (
    <div className="space-y-2">
      {variant === "reasoning" ? (
        <ReasoningRow thought={ask.thought} streaming={thinking} />
      ) : thinking ? (
        <div className="flex h-9 items-center gap-2 pl-1 text-sm">
          <OrbitMark size={18} motion="thinking" />
          {variant === "shimmer" ? <Shimmer as="span" duration={1.4} className="font-medium">Thinking</Shimmer> : <WorkingText>Thinking</WorkingText>}
        </div>
      ) : null}
      {ask.answer ? (
        <div className="text-sm leading-relaxed text-foreground">
          <MessageResponse isAnimating={!ask.done} parseIncompleteMarkdown={!ask.done}>
            {ask.answer}
          </MessageResponse>
        </div>
      ) : null}
    </div>
  );
}

/**
 * AI Elements' Reasoning: "Thinking" sweeps while the model's reasoning streams under it in a
 * window of four lines that follows the newest; it folds to "Thought for 6 seconds" once the
 * reply's text starts, and opens again on a click.
 */
function ReasoningRow({ thought, streaming }: { thought: string; streaming: boolean }) {
  return (
    <Reasoning isStreaming={streaming} className="mb-0">
      <ReasoningTrigger className="h-9 w-auto pl-1">
        <ThinkingLabel />
      </ReasoningTrigger>
      {/* While it streams, a window of four lines that keeps the newest in view and fades the older ones out at its top. */}
      <ReasoningContent className={cn("pl-7 pt-1 text-xs leading-5", streaming && "flex h-20 flex-col justify-end [mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]")}>
        {thought}
      </ReasoningContent>
    </Reasoning>
  );
}

/** The trigger's words: the assistant's mark, "Thinking" while it streams, then how long it took and a chevron that opens it again. */
function ThinkingLabel() {
  const { isStreaming, isOpen, duration } = useReasoning();
  return (
    <span className="flex items-center gap-2">
      <OrbitMark size={18} motion={isStreaming ? "thinking" : "idle"} />
      {isStreaming ? (
        <Shimmer as="span" duration={1.4} className="font-medium">
          Thinking
        </Shimmer>
      ) : (
        <>
          <span>Thought for {duration ?? "a few"} seconds</span>
          <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
        </>
      )}
    </span>
  );
}

/** The Chats sheet, with the chat's running jobs on its row in Now. */
function ChatsMock({ jobs, onBack }: { jobs: Job[]; onBack: () => void }) {
  const format = useFormatter();
  const now = useNow().getTime();
  const when = (at: number) => format.dateTime(at, { hour: "numeric", minute: "2-digit" });
  const chat = (id: string, title: string, extra: Partial<Chat>): Chat =>
    ({ _id: id, title, lastMessageAt: now - 60_000, createdAt: now, role: "owner", preview: "", writing: false, members: [], ...extra }) as Chat;
  const listed = jobs.map((job) => ({
    id: job.jobId,
    kind: job.kind,
    done: job.kind === "screening" ? job.included + job.excluded + job.unclear + job.failed : job.done,
    total: job.total,
  }));
  const nowChats = [
    ...(listed.length ? [chat("c1", "Loot box screening", { jobs: listed, preview: "Both are running." })] : []),
    chat("c2", "Gambling harms in adolescents", { writing: true }),
  ];
  const earlier = [
    ...(listed.length ? [] : [chat("c1", "Loot box screening", { preview: "Both finished: 742 included, 18 excluded, 240 unclear." })]),
    chat("c3", "Tutoring at scale, meta-analyses", { preview: "Here are the 12 meta-analyses since 2015, sorted by effect size.", lastMessageAt: now - 3 * 3_600_000 }),
    chat("c4", "Climate adaptation query", { preview: "I tightened the query to 98,500 papers.", lastMessageAt: now - 26 * 3_600_000 }),
  ];
  let row = 0;
  return (
    <>
      <SheetHeader title="Chats" detail={`${nowChats.length} happening now`} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-3">
        {[
          { id: "now", label: "Now", chats: nowChats },
          { id: "today", label: "Earlier", chats: earlier },
        ].map((group) => (
          <section key={group.id} className="mb-4 space-y-1">
            <h3 className="px-3 pb-0.5 text-xs font-medium text-muted-foreground">{group.label}</h3>
            {group.chats.map((c) => (
              <ChatRow key={c._id} chat={c} index={row++} current={c._id === "c1"} when={when(c.lastMessageAt)} onOpen={onBack} onShare={() => {}} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

/** The mock's own controls, outside the panel. */
function Controls({ variant, setVariant, onAsk, onFinish, onAdd, onReplay }: { variant: Variant; setVariant: (v: Variant) => void; onAsk: () => void; onFinish: () => void; onAdd: () => void; onReplay: () => void }) {
  const button = "h-8 rounded-full px-3 text-xs font-medium text-foreground/80 hover:bg-muted hover:text-foreground";
  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-1 rounded-2xl border border-border/70 bg-card p-1.5 shadow-lg">
      <span className="px-2 text-xs font-semibold text-muted-foreground">Mock</span>
      <Segmented
        label="Thinking"
        value={variant}
        onChange={setVariant}
        options={[
          { id: "now", label: "Thinking now" },
          { id: "shimmer", label: "Shimmer" },
          { id: "reasoning", label: "Reasoning" },
        ]}
      />
      <button type="button" className={button} onClick={onAsk}>
        Ask a follow-up
      </button>
      <button type="button" className={button} onClick={onAdd}>
        Start a third job
      </button>
      <button type="button" className={button} onClick={onFinish}>
        Finish the screening
      </button>
      <button type="button" className={button} onClick={onReplay}>
        Replay
      </button>
    </div>
  );
}
