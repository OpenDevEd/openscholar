"use client";

// Mock of the research assistant. It lives in the layout, so it stays with the user
// across pages: a scripted run stands in for the model, and the pages beside it
// render from the state it changes, the way a Convex record would update them.
// The panel folds into a launcher that would follow the user to every page.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowUp, Coins, Eye, MessagesSquare, PictureInPicture2, Plus, RotateCcw, Search, Settings2, Sparkles, SquarePen, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TooltipHint } from "@/components/ui/tooltip";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { OpenAIIcon } from "@/components/icons/provider-icons";
import { EffortMeter } from "@/components/models/meters";
import { Segmented } from "@/components/settings/parts";
import { StatusIcon } from "@/components/evidence-libraries/configuration/status-chip";
import { EASE } from "@/components/settings/model-map";
import type { PageState } from "./results-pane";
import { ApprovalCard, CollectionCard, JobCard, KindTile, RunMap, VersionBars, WorkingText, type Ask, type Step } from "./run-map";
import { LogoMark } from "./logo-mark";
import { Dim, EdgeGlow, HistorySheet, SHEET_SPRING, Sheet, ShareSheet, stackedUnder, type SheetKind } from "./sheets";
import { Cite, EXTRACT_CELLS, ExtractionCard } from "./extraction";
import { LIBRARY_START, MockContext, type LibraryState } from "./context";
import {
  COLLECTED, COLLECTION_NAME, EXTRACT_CREDITS, KIND, LIBRARY, ORIGINAL_COUNT, SCREEN_CREDITS, SCREEN_ORDER, TIGHT_COUNT, TIGHT_PAPERS,
  type Decision,
} from "./data";

type Card =
  | { type: "approval"; ask: Ask; status: "pending" | "allowed" | "declined" }
  | { type: "job"; done: number }
  | { type: "extract"; filled: number }
  | { type: "collection"; undone: boolean }
  | { type: "publish"; stage: number };
type AssistantTurn = { kind: "assistant"; id: number; steps: Step[]; text: string; shown: number; cards: Card[] };
type Turn = { kind: "user"; id: number; text: string } | AssistantTurn;
type Choice = "once" | "always" | "no";

const PROMPTS = [
  "Tighten this to structured pedagogy studies in sub-Saharan Africa",
  "Screen them. Keep trials and quasi-experiments in primary schools",
  "Save the included ones to a new collection",
  "Compare the designs and samples in these studies",
  "Feature them on our Evidence Library's homepage",
  "Publish it",
];
const TITLE = "Structured pedagogy in sub-Saharan Africa";
const PANEL_W = 440;
const RESULTS = "/assistant-mock";
const LIBRARY_PAGE = "/assistant-mock/library";

const START: PageState = { optimized: false, highlight: false, decided: 0, collected: false };

const SCREEN_ASK: Ask = {
  kind: "screening",
  title: "Screen 24 papers",
  items: ["Is it a randomized or quasi-experimental study?", "Is it set in primary schools?"],
  credits: SCREEN_CREDITS,
  always: true,
  confirm: "Allow once",
  decline: "Don't screen",
};
const EXTRACT_ASK: Ask = {
  kind: "extraction",
  title: "Extract from 4 papers",
  items: ["Study design", "Country and grades", "Sample size"],
  credits: EXTRACT_CREDITS,
  always: true,
  confirm: "Allow once",
  decline: "Don't extract",
};
const PUBLISH_ASK: Ask = {
  kind: "publish",
  title: "Publish the new homepage",
  items: ["A tagline", "A description", `The featured collection “${COLLECTION_NAME}”`],
  always: false,
  confirm: "Publish",
  decline: "Don't publish",
};
const PUBLISH_STAGES = ["Checking the settings", "Building the library", "Rolling it out"];

class Stopped extends Error {}

export function AssistantMock({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const onLibrary = pathname.endsWith("/library");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [page, setPage] = useState<PageState>(START);
  const [library, setLibrary] = useState<LibraryState>(LIBRARY_START);
  const [always, setAlwaysState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState(0);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(true);
  // Sheets stacked over the panel, bottom first.
  const [sheets, setSheets] = useState<Array<{ kind: SheetKind; chat: string }>>([]);
  const [attached, setAttached] = useState<Array<keyof typeof KIND>>(["search"]);
  const run = useRef(0);
  const ids = useRef(0);
  // The pending approval answers only the run that asked for it.
  const decide = useRef<{ token: number; resolve: (choice: Choice) => void } | null>(null);
  // Read at the approval gate, so revoking mid-step counts.
  const alwaysRef = useRef(false);
  // The turn whose collection is on the page; an older card's undo does nothing.
  const collectionOwner = useRef<number | null>(null);
  const libraryOwner = useRef<number | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const where = useRef(pathname);
  where.current = pathname;

  // Timers are an outside system: stop the scripted run when the layout unmounts.
  useEffect(() => () => void run.current++, []);
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
  const attach = (kind: keyof typeof KIND) => setAttached((a) => (a.includes(kind) ? a : [...a, kind]));
  const wait = (token: number, ms: number) =>
    new Promise<void>((resolve, reject) => setTimeout(() => (token === run.current ? resolve() : reject(new Stopped())), ms));
  const patch = (id: number, fn: (t: AssistantTurn) => Partial<AssistantTurn>) =>
    setTurns((all) => all.map((t) => (t.kind === "assistant" && t.id === id ? { ...t, ...fn(t) } : t)));
  const setStep = (id: number, i: number, step: Partial<Step>) =>
    patch(id, (t) => ({ steps: t.steps.map((s, j) => (j === i ? { ...s, ...step } : s)) }));
  const addStep = (id: number, step: Step) => patch(id, (t) => ({ steps: [...t.steps, step] }));
  const setCard = (id: number, i: number, card: Card) => patch(id, (t) => ({ cards: t.cards.map((c, j) => (j === i ? card : c)) }));
  const addCard = (id: number, card: Card) => patch(id, (t) => ({ cards: [...t.cards, card] }));
  const stream = async (token: number, id: number, text: string) => {
    patch(id, () => ({ text, shown: 0 }));
    let shown = 0;
    for (const w of text.split(/(?<= )/)) {
      await wait(token, 26);
      shown += w.length;
      const n = shown;
      patch(id, () => ({ shown: n }));
    }
  };
  /** Types a value into a library field, the way the page would show a live edit. */
  const typeInto = async (token: number, field: "tagline" | "description", text: string) => {
    for (let n = 1; n <= text.length; n += 3) {
      await wait(token, 14);
      const value = text.slice(0, n);
      setLibrary((l) => ({ ...l, [field]: value }));
    }
    setLibrary((l) => ({ ...l, [field]: text }));
  };
  /** Opens a page for the user; a browser-side step that stores nothing. */
  const go = async (token: number, id: number, href: string, title: string) => {
    if (where.current === href) return false;
    addStep(id, { kind: "navigate", title: `Opening ${title}`, detail: "In this tab", status: "working" });
    await wait(token, 600);
    router.push(href);
    await wait(token, 500);
    patch(id, (t) => ({ steps: t.steps.map((s) => (s.kind === "navigate" && s.status === "working" ? { ...s, title: `Opened ${title}`, status: "done" } : s)) }));
    return true;
  };
  /**
   * Shows the approval card and waits for an answer. A credits ask is skipped once the
   * user has allowed credits for this chat; publishing asks every time.
   */
  const approve = async (token: number, id: number, ask: Ask): Promise<{ choice: Choice; asked: boolean }> => {
    if (ask.always && alwaysRef.current) return { choice: "always", asked: false };
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
  /** Stops the running script: pending approvals close, and records made on the old search go. */
  const cancelRun = () => {
    run.current++;
    decide.current = null;
    collectionOwner.current = null;
    setBusy(false);
    setTurns((all) =>
      all.map((t) =>
        t.kind === "assistant"
          ? {
              ...t,
              cards: t.cards.map((c): Card =>
                c.type === "approval" && c.status === "pending" ? { ...c, status: "declined" } : c.type === "collection" ? { ...c, undone: true } : c,
              ),
            }
          : t,
      ),
    );
  };

  const undoSearch = (id: number) => {
    cancelRun();
    setPage(START);
    setNext(0);
    setAttached(["search"]);
    patch(id, (t) => ({ steps: t.steps.map((s) => (s.kind === "write" ? { ...s, status: "undone", onUndo: undefined } : s)) }));
  };

  const optimize = async (token: number, id: number) => {
    // Steps after an "Opened …" step shift down by one.
    const at = (await go(token, id, RESULTS, "your search")) ? 1 : 0;
    addStep(id, { kind: "search", title: "Reading your search", detail: "Keywords and filters", status: "working" });
    await wait(token, 1100);
    setStep(id, at, { title: "Read your search", detail: <span className="tabular-nums">{ORIGINAL_COUNT} results, 6 on this page</span>, status: "done" });
    addStep(id, { kind: "versions", title: "Trying tighter versions", detail: "Running each one against OpenAlex", status: "working" });
    await wait(token, 1700);
    setStep(id, at + 1, { title: "Tried 3 versions", detail: <VersionBars />, status: "done" });
    addStep(id, { kind: "write", title: "Updating your search", detail: "Query and 2 filters", status: "working" });
    await wait(token, 700);
    setPage({ ...START, optimized: true, highlight: true });
    await wait(token, 500);
    setStep(id, at + 2, { title: "Updated your search", detail: <span className="tabular-nums">{ORIGINAL_COUNT} → {TIGHT_COUNT} results</span>, status: "done", onUndo: () => undoSearch(id) });
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
    const { choice, asked } = await approve(token, id, SCREEN_ASK);
    if (choice === "no") {
      await stream(token, id, "Okay, I haven't screened anything. Your search is unchanged.");
      return false;
    }
    attach("screening");
    startJob(id, asked, { type: "job", done: 0 });
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
      "5 of the 24 are trials or quasi-experiments in primary schools, and one of those is listed twice. 16 are reviews, case studies, surveys or policy analyses. 3 need you: one has no abstract, and two report on a trial without being one.",
    );
    return true;
  };

  const collect = async (token: number, id: number) => {
    addStep(id, { kind: "collection", title: "Creating a collection", detail: COLLECTION_NAME, status: "working" });
    await wait(token, 900);
    setStep(id, 0, { title: "Created a collection", detail: COLLECTION_NAME, status: "done" });
    addStep(id, { kind: "collection", title: "Adding the included studies", detail: "From the screening", status: "working" });
    await wait(token, 900);
    setStep(id, 1, { title: `Added ${COLLECTED} studies`, detail: "One was listed twice, so it's in once", status: "done" });
    collectionOwner.current = id;
    setPage((p) => ({ ...p, collected: true }));
    attach("collection");
    addCard(id, { type: "collection", undone: false });
    await wait(token, 300);
    await stream(token, id, "Done. The 4 included studies are in the new collection, and it's attached to this chat.");
  };

  const extract = async (token: number, id: number) => {
    addStep(id, { kind: "extraction", title: "Setting up an extraction", detail: "3 fields for 4 papers", status: "working" });
    await wait(token, 1000);
    setStep(id, 0, { title: "Set up an extraction", detail: "3 fields for 4 papers", status: "done" });
    const { choice, asked } = await approve(token, id, EXTRACT_ASK);
    if (choice === "no") {
      await stream(token, id, "Okay, I haven't extracted anything.");
      return false;
    }
    attach("extraction");
    startJob(id, asked, { type: "extract", filled: 0 });
    await wait(token, 400);
    for (let filled = 1; filled <= EXTRACT_CELLS; filled++) {
      await wait(token, 360);
      setCard(id, 0, { type: "extract", filled });
    }
    await wait(token, 500);
    await stream(
      token,
      id,
      "Three of the four can be compared. The Kenya trial found the full package worked best: coaching, a book for every pupil and structured lesson plans [1]. Ghana's bilingual programme lifted every reading skill it measured, by up to 0.43 SD, and more where teachers and pupils share a first language [3]. The Ghana teacher-training study found a clear gain in numeracy and a smaller one in literacy [4]. The storybook trial has no abstract, so I need its PDF to include it [2].",
    );
    return true;
  };

  const undoLibrary = () => {
    const owner = libraryOwner.current;
    if (owner === null) return;
    libraryOwner.current = null;
    setLibrary(LIBRARY_START);
    setAttached((a) => a.filter((k) => k !== "library"));
    setNext((n) => Math.min(n, 4));
    patch(owner, (t) => ({ steps: t.steps.map((s) => (s.kind === "library" ? { ...s, status: "undone", onUndo: undefined } : s)) }));
  };

  const feature = async (token: number, id: number) => {
    const base = (await go(token, id, LIBRARY_PAGE, "your library's settings")) ? 1 : 0;
    addStep(id, { kind: "library", title: "Reading the draft", detail: LIBRARY.name, status: "working" });
    await wait(token, 900);
    setStep(id, base, { title: "Read the draft", detail: "No tagline or description yet", status: "done" });
    addStep(id, { kind: "library", title: "Writing the homepage text", detail: "Tagline and description", status: "working" });
    libraryOwner.current = id;
    setLibrary((l) => ({ ...l, highlight: true, changed: true }));
    attach("library");
    await typeInto(token, "tagline", LIBRARY.tagline);
    await typeInto(token, "description", LIBRARY.description);
    setStep(id, base + 1, { title: "Wrote the homepage text", detail: "Tagline and description", status: "done" });
    addStep(id, { kind: "library", title: "Featuring the collection", detail: COLLECTION_NAME, status: "working" });
    await wait(token, 700);
    setLibrary((l) => ({ ...l, collections: [COLLECTION_NAME] }));
    setStep(id, base + 2, { title: "Featured the collection", detail: COLLECTION_NAME, status: "done", onUndo: undoLibrary });
    await stream(token, id, "It's saved as a draft, so visitors don't see it yet. Publishing makes it live.");
    await wait(token, 1500);
    setLibrary((l) => ({ ...l, highlight: false }));
  };

  const publish = async (token: number, id: number) => {
    await go(token, id, LIBRARY_PAGE, "your library's settings");
    addStep(id, { kind: "publish", title: "Checking the draft", detail: "Every section", status: "working" });
    await wait(token, 900);
    patch(id, (t) => ({ steps: t.steps.map((s) => (s.kind === "publish" ? { ...s, title: "Checked the draft", detail: "Ready to publish", status: "done" } : s)) }));
    const { choice } = await approve(token, id, PUBLISH_ASK);
    if (choice === "no") {
      await stream(token, id, "Okay, it stays a draft.");
      return false;
    }
    setCard(id, 0, { type: "publish", stage: 0 });
    setLibrary((l) => ({ ...l, status: "publishing" }));
    for (let stage = 1; stage <= PUBLISH_STAGES.length; stage++) {
      await wait(token, 1300);
      setCard(id, 0, { type: "publish", stage });
    }
    setLibrary((l) => ({ ...l, status: "live", changed: false }));
    await stream(token, id, `It's live at ${LIBRARY.address}, with the new homepage and the collection featured first.`);
    return true;
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
      if (step === 3 && !(await extract(token, id))) return;
      if (step === 4) await feature(token, id);
      if (step === 5 && !(await publish(token, id))) return;
      setNext(step + 1);
    } catch (error) {
      if (!(error instanceof Stopped)) throw error;
    } finally {
      if (token === run.current) setBusy(false);
    }
  };

  const answer = (choice: Choice) => {
    const pending = decide.current;
    if (!pending || pending.token !== run.current) return;
    // The buttons are about to go; keep keyboard focus in the chat.
    composer.current?.focus();
    pending.resolve(choice);
  };

  const restart = () => {
    cancelRun();
    libraryOwner.current = null;
    setTurns([]);
    setPage(START);
    setLibrary(LIBRARY_START);
    setAlways(false);
    setNext(0);
    setDraft("");
    setAttached(["search"]);
  };

  const undoCollection = (id: number) => {
    if (collectionOwner.current !== id) return;
    collectionOwner.current = null;
    setPage((p) => ({ ...p, collected: false }));
    setAttached((a) => a.filter((k) => k !== "collection"));
    patch(id, (t) => ({ cards: t.cards.map((c) => (c.type === "collection" ? { ...c, undone: true } : c)) }));
  };

  const push = (kind: SheetKind, chat: string) => setSheets((all) => [...all, { kind, chat }]);
  const pop = () => setSheets((all) => all.slice(0, -1));
  const fold = () => {
    setSheets([]);
    setOpen(false);
  };
  const depth = sheets.length;
  const chatTitle = turns.length ? TITLE : "New chat";

  const cards = turns.flatMap((t) => (t.kind === "assistant" ? t.cards : []));
  const screening = cards.find((c): c is Extract<Card, { type: "job" }> => c.type === "job");
  const extraction = cards.find((c): c is Extract<Card, { type: "extract" }> => c.type === "extract");
  const running =
    extraction && extraction.filled < EXTRACT_CELLS
      ? extraction.filled / EXTRACT_CELLS
      : screening && screening.done < 24
        ? screening.done / 24
        : null;
  const suggestion = !busy && next < PROMPTS.length ? PROMPTS[next] : null;
  const view = onLibrary ? "Library settings, Identity" : page.optimized ? "Results, page 1 of 3" : "Results, page 1 of 36";
  const undoSearchFromPage = () => {
    const last = [...turns].reverse().find((t): t is AssistantTurn => t.kind === "assistant" && t.steps.some((s) => s.kind === "write"));
    if (last) undoSearch(last.id);
  };

  return (
    <MotionConfig reducedMotion="user">
      <MockContext.Provider value={{ page, library, undoSearch: undoSearchFromPage, undoLibrary }}>
        <EdgeGlow open={open} working={busy} />
        <div className="flex min-h-dvh gap-3 overflow-x-clip p-3 sm:p-4">
          <div className="min-w-0 flex-1 py-2">
            <div className="mx-auto mb-4 flex w-full max-w-5xl justify-center">
              <Segmented
                label="Page"
                value={onLibrary ? "library" : "results"}
                onChange={(v) => router.push(v === "library" ? LIBRARY_PAGE : RESULTS)}
                options={[
                  { id: "results", label: "Search results", icon: Search },
                  { id: "library", label: "Library settings", icon: Settings2 },
                ]}
              />
            </div>
            {children}
          </div>

          {/* The dock's width animates, so the page beside it recenters smoothly instead of jumping. */}
          <motion.div
            className="relative z-10 shrink-0"
            initial={false}
            animate={{ width: open ? PANEL_W : 0 }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <div className="sticky top-4 h-[calc(100dvh-2rem)]">
              <AnimatePresence>
                {open ? (
                  <motion.aside
                    key="panel"
                    layoutId="assistant-shell"
                    // Measure only when the panel opens or folds, never on other re-renders.
                    layoutDependency={open}
                    transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.9 }}
                    className="absolute right-0 top-0 h-full"
                    style={{ width: PANEL_W, borderRadius: 16 }}
                    aria-label="OpenScholar assistant"
                  >
                    <motion.div
                      className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm"
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
                          transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.9 }}
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
                          onHistory={() => push("history", chatTitle)}
                          onShare={() => push("share", chatTitle)}
                          attached={attached}
                          always={always}
                          onStopAlways={() => setAlways(false)}
                          onRestart={restart}
                          onCollapse={fold}
                        />
                        <Thread turns={turns} onAnswer={answer} onUndoCollection={undoCollection} busy={busy} onLibrary={onLibrary} />
                        <Footer
                          suggestion={suggestion}
                          done={!busy && next >= PROMPTS.length}
                          onSuggestion={(s) => void send(s)}
                          onRestart={restart}
                          composer={composer}
                          draft={draft}
                          setDraft={setDraft}
                          busy={busy}
                          onSend={() => void send(draft.trim() || suggestion || "")}
                          view={view}
                        />
                      </motion.div>
                      <Dim on={depth > 0} />
                    </motion.div>
                    <AnimatePresence>
                      {sheets.map((sheet, i) => (
                        <Sheet key={`${i}-${sheet.kind}`} index={i} depth={depth - 1 - i}>
                          {sheet.kind === "history" ? (
                            <HistorySheet onBack={pop} onShare={(chat) => push("share", chat)} />
                          ) : (
                            <ShareSheet chat={sheet.chat} onBack={pop} />
                          )}
                        </Sheet>
                      ))}
                    </AnimatePresence>
                  </motion.aside>
                ) : null}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>

        <AnimatePresence>
          {!open ? <Launcher key="launcher" working={busy} progress={running} onOpen={() => setOpen(true)} /> : null}
        </AnimatePresence>
      </MockContext.Provider>
    </MotionConfig>
  );
}

/** A publish in progress: each stage checks off, then the library is live. */
function PublishCard({ stage }: { stage: number }) {
  const live = stage >= PUBLISH_STAGES.length;
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
      <div className="flex items-center gap-3">
        <KindTile kind="publish" working={!live} />
        <p className="min-w-0 flex-1 text-sm font-semibold">
          {live ? "Published" : <WorkingText>Publishing the new homepage</WorkingText>}
        </p>
        {live ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">Live</span>
        ) : null}
      </div>
      <ol className="mt-3 space-y-2">
        {PUBLISH_STAGES.map((label, i) => (
          <li key={label} className="flex items-center gap-2.5 text-sm">
            <StatusIcon tone={i < stage ? "success" : i === stage ? "running" : "neutral"} label={i < stage ? "Done" : i === stage ? "Running" : "Waiting"} />
            <span className={cn(i > stage ? "text-muted-foreground" : "text-foreground/90")}>{label}</span>
          </li>
        ))}
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
  onAnswer,
  onUndoCollection,
  busy,
  onLibrary,
}: {
  turns: Turn[];
  onAnswer: (choice: Choice) => void;
  onUndoCollection: (id: number) => void;
  busy: boolean;
  onLibrary: boolean;
}) {
  return (
    <Conversation className="min-h-0 flex-1 [mask-image:linear-gradient(to_bottom,transparent,black_18px)]">
      <ConversationContent className="gap-5 overflow-x-clip px-4 py-4">
        {turns.length === 0 ? <Empty onLibrary={onLibrary} /> : null}
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
                        onAllow={() => onAnswer("once")}
                        onAlways={() => onAnswer("always")}
                        onDecline={() => onAnswer("no")}
                      />
                    ) : c.type === "job" ? (
                      <JobCard done={c.done} total={24} counts={countUpTo(c.done)} />
                    ) : c.type === "extract" ? (
                      <ExtractionCard filled={c.filled} />
                    ) : c.type === "publish" ? (
                      <PublishCard stage={c.stage} />
                    ) : (
                      <CollectionCard undone={c.undone} canUndo={!busy} onUndo={() => onUndoCollection(t.id)} />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {t.text ? <Reply text={t.text} shown={t.shown} /> : null}
            </div>
          ),
        )}
      </ConversationContent>
    </Conversation>
  );
}

function countUpTo(done: number) {
  const counts = { include: 0, exclude: 0, unsure: 0 };
  for (const d of SCREEN_ORDER.slice(0, done) as Decision[]) counts[d]++;
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

function Empty({ onLibrary }: { onLibrary: boolean }) {
  return (
    <div className="space-y-5 pt-2">
      <div className="space-y-1">
        <p className="text-base font-semibold">{onLibrary ? "Ask about this library" : "Ask about this search"}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          I can see the page you&apos;re on. Ask a question, or tell me what to change and I&apos;ll change it here.
        </p>
      </div>
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 pl-1 text-xs font-medium text-muted-foreground">
          <Eye className="size-3.5" /> What I can see
        </p>
        <RunMap
          steps={
            onLibrary
              ? [
                  { kind: "library", title: LIBRARY.name, detail: "Draft, not yet published", status: "done" },
                  { kind: "write", title: "No tagline or description", detail: "Identity section", status: "done" },
                  { kind: "collection", title: "2 featured collections", detail: "Home page", status: "done" },
                ]
              : [
                  { kind: "search", title: "structured pedagogy early grade reading", detail: "Keywords, title and abstract", status: "done" },
                  { kind: "versions", title: "215 results", detail: "Page 1 of 36, 6 papers showing", status: "done" },
                  { kind: "write", title: "No filters", detail: "Any year, any type, any country", status: "done" },
                ]
          }
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
  extraction: "Extraction, 4 papers",
  library: LIBRARY.name,
};

function Header({
  title,
  onHistory,
  onShare,
  attached,
  always,
  onStopAlways,
  onRestart,
  onCollapse,
}: {
  title: string;
  onHistory: () => void;
  onShare: () => void;
  attached: Array<keyof typeof KIND>;
  always: boolean;
  onStopAlways: () => void;
  onRestart: () => void;
  onCollapse: () => void;
}) {
  return (
    <div className="space-y-3 border-b border-border/50 px-4 pb-3 pt-3.5">
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
          <ModelChip />
        </div>
        <div className="flex items-center">
          <IconButton label="Chats" icon={<MessagesSquare className="size-4" />} onClick={onHistory} />
          <IconButton label="Share this chat" icon={<UserPlus className="size-4" />} onClick={onShare} />
          <IconButton label="New chat" icon={<SquarePen className="size-4" />} onClick={onRestart} />
          <IconButton label="Fold into a bubble  ⌘J" icon={<PictureInPicture2 className="size-4" />} onClick={onCollapse} />
        </div>
      </div>
      <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none]">
        <AnimatePresence initial={false}>
          {attached.map((k) => (
            <motion.span
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
        <span className="shrink-0">
          <IconButton label="Attach" icon={<Plus className="size-3.5" />} small />
        </span>
      </div>
    </div>
  );
}

function ModelChip() {
  return (
    <button type="button" className="-ml-1 flex h-5 items-center gap-1.5 rounded-full px-1 text-xs text-muted-foreground hover:text-foreground">
      <span className="flex" style={{ color: "#34d399" }}>
        <OpenAIIcon className="size-3" />
      </span>
      GPT-6 Luna
      <span className="ml-1 flex items-center gap-1">
        <EffortMeter levels={["low", "medium", "high"]} level="medium" filled="bg-current" /> Medium
      </span>
    </button>
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

function Footer({
  suggestion,
  done,
  onSuggestion,
  onRestart,
  composer,
  draft,
  setDraft,
  busy,
  onSend,
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
  onSend: () => void;
  view: string;
}) {
  return (
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
              onClick={() => onSuggestion(suggestion)}
              className="flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 text-xs font-medium text-foreground/80 hover:border-border hover:bg-muted/50"
            >
              <Sparkles className="size-3 shrink-0 text-primary" /> <span className="truncate">{suggestion}</span>
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
      <div className="rounded-2xl border border-border/60 bg-background shadow-xs focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
        <textarea
          ref={composer}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
    </div>
  );
}
