"use client";

// Mock of the research assistant docked beside a results page. A scripted run
// stands in for the model: each prompt plays its steps, and the page beside it
// changes through the same state, the way a Convex record would update it.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Coins, Eye, Plus, RotateCcw, Sparkles, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TooltipHint } from "@/components/ui/tooltip";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { OpenAIIcon } from "@/components/icons/provider-icons";
import { EffortMeter } from "@/components/models/meters";
import { EASE } from "@/components/settings/model-map";
import { ResultsPane, type PageState } from "./results-pane";
import { ApprovalCard, CollectionCard, JobCard, KindTile, RunMap, VersionBars, type Step } from "./run-map";
import { COLLECTION_NAME, KIND, ORIGINAL_COUNT, TIGHT_COUNT, TIGHT_PAPERS, SCREEN_TOTALS, type Decision } from "./data";

type Card =
  | { type: "approval"; status: "pending" | "allowed" | "declined" }
  | { type: "job"; done: number }
  | { type: "collection"; undone: boolean };
type Turn =
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; steps: Step[]; text: string; shown: number; cards: Card[] };

const PROMPTS = [
  "Tighten this to structured pedagogy studies in sub-Saharan Africa",
  "Screen them. Keep trials and quasi-experiments in primary schools",
  "Save the included ones to a new collection",
];

const START: PageState = { optimized: false, highlight: false, decided: 0, collected: false };

/** Decisions in the order the screening makes them: the 8 on the page first, then the other 16. */
const ORDER: Decision[] = (() => {
  const shown = TIGHT_PAPERS.map((p) => p.decision);
  const left = { ...SCREEN_TOTALS };
  for (const d of shown) left[d]--;
  const rest: Decision[] = [];
  while (rest.length < 16) {
    for (const d of ["exclude", "include", "exclude", "unsure", "include"] as Decision[]) {
      if (left[d] > 0 && rest.length < 16) {
        rest.push(d);
        left[d]--;
      }
    }
  }
  return [...shown, ...rest];
})();

class Stopped extends Error {}

export function AssistantMock() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [page, setPage] = useState<PageState>(START);
  const [always, setAlways] = useState(false);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState(0);
  const [draft, setDraft] = useState("");
  const [attached, setAttached] = useState<Array<keyof typeof KIND>>(["search"]);
  const run = useRef(0);
  const decide = useRef<((choice: "once" | "always" | "no") => void) | null>(null);
  const ids = useRef(0);

  // Timers are the only outside system here: stop the scripted run when the page unmounts.
  useEffect(() => () => void run.current++, []);

  const wait = (token: number, ms: number) =>
    new Promise<void>((resolve, reject) => setTimeout(() => (token === run.current ? resolve() : reject(new Stopped())), ms));
  const patch = (id: number, fn: (t: Extract<Turn, { kind: "assistant" }>) => Partial<Extract<Turn, { kind: "assistant" }>>) =>
    setTurns((all) => all.map((t) => (t.kind === "assistant" && t.id === id ? { ...t, ...fn(t) } : t)));
  const setStep = (id: number, i: number, step: Partial<Step>) =>
    patch(id, (t) => ({ steps: t.steps.map((s, j) => (j === i ? { ...s, ...step } : s)) }));
  const addStep = (id: number, step: Step) => patch(id, (t) => ({ steps: [...t.steps, step] }));
  const setCard = (id: number, i: number, card: Card) => patch(id, (t) => ({ cards: t.cards.map((c, j) => (j === i ? card : c)) }));
  const addCard = (id: number, card: Card) => patch(id, (t) => ({ cards: [...t.cards, card] }));
  const stream = async (token: number, id: number, text: string) => {
    patch(id, () => ({ text, shown: 0 }));
    const words = text.split(/(?<= )/);
    let shown = 0;
    for (const w of words) {
      await wait(token, 26);
      shown += w.length;
      const n = shown;
      patch(id, () => ({ shown: n }));
    }
  };

  const undoSearch = (id: number) => {
    run.current++;
    setBusy(false);
    setPage(START);
    setNext(0);
    setAttached(["search"]);
    setStep(id, 2, { status: "undone", onUndo: undefined });
  };

  const optimize = async (token: number, id: number) => {
    addStep(id, { kind: "search", title: "Reading your search", detail: "Keywords and filters", status: "working" });
    await wait(token, 1100);
    setStep(id, 0, { title: "Read your search", detail: <span className="tabular-nums">{ORIGINAL_COUNT} results, 6 on this page</span>, status: "done" });
    addStep(id, { kind: "versions", title: "Trying tighter versions", detail: "Running each one against OpenAlex", status: "working" });
    await wait(token, 1700);
    setStep(id, 1, { title: "Tried 3 versions", detail: <VersionBars />, status: "done" });
    addStep(id, { kind: "write", title: "Updating your search", detail: "Query and 2 filters", status: "working" });
    await wait(token, 700);
    setPage({ ...START, optimized: true, highlight: true });
    await wait(token, 500);
    setStep(id, 2, { title: "Updated your search", detail: <span className="tabular-nums">{ORIGINAL_COUNT} → {TIGHT_COUNT} results</span>, status: "done", onUndo: () => undoSearch(id) });
    await stream(
      token,
      id,
      "Most of the first page was off-topic: reading software, middle-school reform, Latin America. I added the other names this approach goes by, kept articles from 2015 on, and limited it to African countries. That leaves 24, and the first page is on target now.",
    );
    await wait(token, 1200);
    setPage((p) => ({ ...p, highlight: false }));
  };

  const screen = async (token: number, id: number) => {
    addStep(id, { kind: "screening", title: "Setting up a screening", detail: "2 questions for 24 papers", status: "working" });
    await wait(token, 1000);
    setStep(id, 0, { title: "Set up a screening", detail: "2 questions for 24 papers", status: "done" });
    let choice: "once" | "always" | "no" = "always";
    if (!always) {
      addCard(id, { type: "approval", status: "pending" });
      choice = await new Promise((resolve) => {
        decide.current = resolve;
      });
      decide.current = null;
      if (token !== run.current) throw new Stopped();
      if (choice === "no") setCard(id, 0, { type: "approval", status: "declined" });
    }
    if (choice === "no") {
      await stream(token, id, "Okay, I haven't screened anything. Your search is unchanged.");
      return false;
    }
    if (choice === "always") setAlways(true);
    setAttached((a) => [...a, "screening"]);
    // The approval card becomes the running job, in the same place.
    if (always) addCard(id, { type: "job", done: 0 });
    else setCard(id, 0, { type: "job", done: 0 });
    await wait(token, 400);
    for (let done = 1; done <= 24; done++) {
      await wait(token, 210);
      setCard(id, 0, { type: "job", done });
      setPage((p) => ({ ...p, decided: Math.min(done, TIGHT_PAPERS.length) }));
    }
    await wait(token, 500);
    await stream(
      token,
      id,
      "9 of the 24 are trials or quasi-experiments in primary schools. 11 are reviews, policy analyses or other designs. 4 weren't clear from the abstract, so I marked them for you to check.",
    );
    return true;
  };

  const collect = async (token: number, id: number) => {
    addStep(id, { kind: "collection", title: "Creating a collection", detail: COLLECTION_NAME, status: "working" });
    await wait(token, 900);
    setStep(id, 0, { title: "Created a collection", detail: COLLECTION_NAME, status: "done" });
    addStep(id, { kind: "collection", title: "Adding the included papers", detail: "From the screening", status: "working" });
    await wait(token, 900);
    setStep(id, 1, { title: "Added 9 papers", detail: "From the screening", status: "done" });
    setPage((p) => ({ ...p, collected: true }));
    setAttached((a) => [...a, "collection"]);
    addCard(id, { type: "collection", undone: false });
    await wait(token, 300);
    await stream(token, id, "Done. The 9 included papers are in the new collection, and it's attached to this chat.");
  };

  const send = async (text: string) => {
    if (busy || next >= PROMPTS.length || !text.trim()) return;
    const token = ++run.current;
    const step = next;
    const user = ++ids.current;
    const id = ++ids.current;
    setDraft("");
    setBusy(true);
    setTurns((all) => [...all, { kind: "user", id: user, text }, { kind: "assistant", id, steps: [], text: "", shown: 0, cards: [] }]);
    try {
      await wait(token, 450);
      if (step === 0) await optimize(token, id);
      if (step === 1 && !(await screen(token, id))) return;
      if (step === 2) await collect(token, id);
      setNext(step + 1);
    } catch (error) {
      if (!(error instanceof Stopped)) throw error;
    } finally {
      if (token === run.current) setBusy(false);
    }
  };

  const restart = () => {
    run.current++;
    decide.current = null;
    setTurns([]);
    setPage(START);
    setAlways(false);
    setBusy(false);
    setNext(0);
    setDraft("");
    setAttached(["search"]);
  };

  const undoCollection = (id: number) => {
    setPage((p) => ({ ...p, collected: false }));
    setAttached((a) => a.filter((k) => k !== "collection"));
    setCard(id, 0, { type: "collection", undone: true });
  };

  const suggestion = !busy && next < PROMPTS.length ? PROMPTS[next] : null;

  return (
    <div className="flex min-h-dvh gap-3 p-3 sm:p-4">
      <div className="min-w-0 flex-1 py-2">
        <ResultsPane page={page} onUndo={() => {
          const last = [...turns].reverse().find((t) => t.kind === "assistant" && t.steps[2]?.kind === "write");
          if (last) undoSearch(last.id);
        }} />
      </div>

      <aside className="sticky top-4 flex h-[calc(100dvh-2rem)] w-[440px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <Header attached={attached} always={always} onStopAlways={() => setAlways(false)} onRestart={restart} />

        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-5 px-4 py-4">
            {turns.length === 0 ? <Empty /> : null}
            {turns.map((t) =>
              t.kind === "user" ? (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="ml-10 self-end rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 text-sm"
                >
                  {t.text}
                </motion.div>
              ) : (
                <div key={t.id} className="space-y-3">
                  {t.steps.length ? <RunMap steps={t.steps} /> : <Thinking />}
                  <AnimatePresence mode="popLayout" initial={false}>
                    {t.cards.map((c, i) => (
                      <motion.div
                        key={`${i}-${c.type}`}
                        layout
                        initial={{ opacity: 0, scale: 0.97, y: 6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={{ duration: 0.4, ease: EASE }}
                      >
                        {c.type === "approval" ? (
                          <ApprovalCard
                            status={c.status}
                            onAllow={() => decide.current?.("once")}
                            onAlways={() => decide.current?.("always")}
                            onDecline={() => decide.current?.("no")}
                          />
                        ) : c.type === "job" ? (
                          <JobCard done={c.done} total={24} counts={countUpTo(c.done)} />
                        ) : (
                          <CollectionCard undone={c.undone} onUndo={() => undoCollection(t.id)} />
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {t.text ? (
                    <p className="text-sm leading-relaxed text-foreground">
                      {t.text.slice(0, t.shown)}
                      {t.shown < t.text.length ? <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-pulse bg-primary" /> : null}
                    </p>
                  ) : null}
                </div>
              ),
            )}
          </ConversationContent>
        </Conversation>

        <div className="space-y-2 p-3 pt-0">
          <div className="h-8">
            <AnimatePresence mode="wait" initial={false}>
              {suggestion ? (
                <motion.button
                  key={suggestion}
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  onClick={() => void send(suggestion)}
                  className="flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 text-xs font-medium text-foreground/80 hover:border-border hover:bg-muted/50"
                >
                  <Sparkles className="size-3 shrink-0 text-primary" /> <span className="truncate">{suggestion}</span>
                </motion.button>
              ) : !busy && next >= PROMPTS.length ? (
                <motion.button
                  key="again"
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  onClick={restart}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 text-xs font-medium text-foreground/80 hover:bg-muted/50"
                >
                  <RotateCcw className="size-3" /> Play it again
                </motion.button>
              ) : null}
            </AnimatePresence>
          </div>
          <Composer
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            onSend={() => void send(draft.trim() || suggestion || "")}
            view={page.optimized ? "Results, page 1 of 3" : "Results, page 1 of 36"}
          />
        </div>
      </aside>
    </div>
  );
}

function countUpTo(done: number) {
  const counts = { include: 0, exclude: 0, unsure: 0 };
  for (const d of ORDER.slice(0, done)) counts[d]++;
  return counts;
}

function Thinking() {
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex h-9 items-center gap-2 pl-1 text-sm text-muted-foreground">
      <motion.span
        animate={reduceMotion ? undefined : { rotate: 360 }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
        className="flex text-primary"
      >
        <Sparkles className="size-4" />
      </motion.span>
      Thinking
    </div>
  );
}

function Empty() {
  return (
    <div className="space-y-5 pt-2">
      <div className="space-y-1">
        <p className="text-base font-semibold">Ask about this search</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          I can see the page you&apos;re on. Ask a question, or tell me what to change and I&apos;ll change it here.
        </p>
      </div>
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 pl-1 text-xs font-medium text-muted-foreground">
          <Eye className="size-3.5" /> What I can see
        </p>
        <RunMap
          steps={[
            { kind: "search", title: "structured pedagogy early grade reading", detail: "Keywords, title and abstract", status: "done" },
            { kind: "versions", title: "215 results", detail: "Page 1 of 36, 6 papers showing", status: "done" },
            { kind: "write", title: "No filters", detail: "Any year, any type, any country", status: "done" },
          ]}
          plain
        />
      </div>
    </div>
  );
}

const CHIP_LABEL: Partial<Record<keyof typeof KIND, string>> = {
  search: "structured pedagogy early grade reading",
  screening: "Screening, 24 papers",
  collection: COLLECTION_NAME,
};

function Header({
  attached,
  always,
  onStopAlways,
  onRestart,
}: {
  attached: Array<keyof typeof KIND>;
  always: boolean;
  onStopAlways: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="space-y-3 border-b border-border/50 px-4 pb-3 pt-4">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="size-3.5" />
        </span>
        <p className="text-sm font-semibold">Assistant</p>
        <div className="ml-auto flex items-center gap-1">
          <ModelChip />
          <IconButton label="Share this chat" icon={<UserPlus className="size-4" />} />
          <IconButton label="Start over" icon={<RotateCcw className="size-4" />} onClick={onRestart} />
        </div>
      </div>
      <LayoutGroup>
        <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none]">
          <AnimatePresence initial={false}>
            {attached.map((k) => (
              <motion.span
                layout
                key={k}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: "spring", stiffness: 480, damping: 32 }}
                className="flex h-7 max-w-[13rem] shrink-0 items-center gap-1.5 rounded-full bg-muted/60 pl-1 pr-2.5 text-xs font-medium"
              >
                <KindTile kind={k} size="sm" />
                <TooltipHint label={CHIP_LABEL[k] ?? ""} onlyWhenClipped>
                  <span className="truncate">{CHIP_LABEL[k]}</span>
                </TooltipHint>
              </motion.span>
            ))}
            {always ? (
              <motion.span
                layout
                key="always"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: "spring", stiffness: 480, damping: 32 }}
                className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary/10 pl-2.5 pr-1 text-xs font-medium text-primary"
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
          <motion.span layout className="shrink-0">
            <IconButton label="Attach" icon={<Plus className="size-3.5" />} small />
          </motion.span>
        </div>
      </LayoutGroup>
    </div>
  );
}

function ModelChip() {
  return (
    <button type="button" className="flex h-8 items-center gap-2 rounded-full pl-1 pr-3 text-xs font-medium hover:bg-muted/60">
      <span className="flex size-6 items-center justify-center rounded-full" style={{ backgroundColor: "color-mix(in oklab, #34d399 18%, transparent)", color: "#34d399" }}>
        <OpenAIIcon className="size-3.5" />
      </span>
      GPT-6 Luna
      <span className="text-muted-foreground">
        <EffortMeter levels={["low", "medium", "high"]} level="medium" filled="bg-current" />
      </span>
    </button>
  );
}

function IconButton({ label, icon, onClick, small }: { label: string; icon: ReactNode; onClick?: () => void; small?: boolean }) {
  return (
    <TooltipHint label={label}>
      <button
        type="button"
        aria-label={label}
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

function Composer({
  draft,
  setDraft,
  busy,
  onSend,
  view,
}: {
  draft: string;
  setDraft: (v: string) => void;
  busy: boolean;
  onSend: () => void;
  view: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background shadow-xs focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        rows={2}
        placeholder="Ask, or tell me what to change"
        aria-label="Message the assistant"
        className="block w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <span className="flex h-7 items-center gap-1.5 rounded-full bg-muted/60 px-2.5 text-xs text-muted-foreground">
          <Eye className="size-3" /> Sees {view}
        </span>
        <TooltipHint label="Send">
          <button
            type="button"
            aria-label="Send"
            disabled={busy}
            onClick={onSend}
            className="ml-auto flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </TooltipHint>
      </div>
    </div>
  );
}
