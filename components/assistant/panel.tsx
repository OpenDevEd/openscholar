"use client";

// The research assistant (#324, #346): a panel that hovers above every page of the app
// and folds into a launcher. The mock on branch mock/research-assistant is its spec.
// This is the chat itself. The run map, the cards, the sheets, the @ picker and the
// spending controls arrive with the issues that build what they show.

import { Component, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useSmoothText } from "@convex-dev/agent/react";
import { insertAtTop, useConvex, useConvexAuth, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { ArrowUp, ChevronDown, CircleAlert, CircleStop, Eye, MessagesSquare, PictureInPicture2, Square, SquarePen, UserPlus } from "@/components/icons";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import { CHAT_LINK_SAFETY } from "@/components/extraction/chat/link-safety-dialog";
import { getModelIcon } from "@/components/icons/provider-icons";
import { EffortMeter } from "@/components/models/meters";
import { ModelPicker } from "@/components/models/model-picker";
import { EASE, effortOf, toMapModel, usePresetModels, type PickedModel, type PresetPick } from "@/components/settings/model-map";
import { EDGE_FADE } from "@/components/ui/scroll-area";
import { TooltipHint } from "@/components/ui/tooltip";
import { PRESET_KEYS } from "@/lib/ai/tasks";
import type { Effort } from "@/lib/ai/core/call-options";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { PRESENCE_HEARTBEAT_MS } from "@/lib/assistant/presence";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { OrbitMark, type OrbitClock } from "./orbit-mark";
import { observeActivity, restingObservation, type Activity, type OrbitMotion } from "@/lib/assistant/activity";
import { Steps, type StepItem } from "./steps";
import { IconButton, WorkingText } from "./parts";
import { Dim, HistorySheet, SHEET_SPRING, ShareSheet, Sheet, stackedUnder, type OpenSheet } from "./sheets";

type ThreadId = Id<"assistantThreads">;
type Item = FunctionReturnType<typeof api.assistant.replies.messages>["page"][number];
type Message = Exclude<Item, StepItem>;
type Live = NonNullable<FunctionReturnType<typeof api.assistant.replies.live>["reply"]>;

const PANEL_W = 440;
/** How far the chips above the composer hang over the thread: half their height. */
const CHIP_HANG = 16;
const SHELL_SPRING = { type: "spring" as const, stiffness: 380, damping: 36, mass: 0.9 };
const FIRST_MESSAGES = 30;
const TITLE_MAX = 60;
/** The ID of a message shown ahead of the server's copy of it. */
const SENDING = "sending:";
/** The one message that can be on its way in a chat: its bubble keeps this ID until the server's copy takes its place. */
const SENDING_ID = `${SENDING}message`;
/** The key a chat that hasn't started keeps its draft under. */
const NEW = "new";
/** Two failures closer together than this are a loop, not a lost chat. */
const LOOP_MS = 2_000;

/** What is typed and not yet sent, a draft per chat, so one chat's never lands in another. */
type Drafts = { of: (id: ThreadId | null) => string; set: (id: ThreadId | null, text: string | ((now: string) => string)) => void };

/** A new chat is named after its first message's first line, cut between characters, never inside one. */
function titleFrom(text: string) {
  const line = [...text.trim().split("\n")[0]!.replace(/\s+/g, " ")];
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).join("").trimEnd()}…` : line.join("");
}

export function AssistantPanel() {
  const enabled = useFeatureFlag("assistant.enabled");
  const { isAuthenticated } = useConvexAuth();
  // A link to a chat (`?chat=`) opens the panel on it. Nothing renders before the session is known, so the server never reads this.
  const [linked] = useState(() => (typeof window === "undefined" ? null : (new URLSearchParams(window.location.search).get("chat") as ThreadId | null)));
  const [open, setOpen] = useState(linked !== null);
  const [threadId, setThreadId] = useState<ThreadId | null>(linked);
  // Kept here, above the panel, so folding it away keeps what was typed.
  const [typed, setTyped] = useState<Record<string, string>>({});
  if (!enabled || !isAuthenticated) return null;
  const drafts: Drafts = {
    of: (id) => typed[id ?? NEW] ?? "",
    set: (id, text) => setTyped((all) => ({ ...all, [id ?? NEW]: typeof text === "function" ? text(all[id ?? NEW] ?? "") : text })),
  };
  return (
    <Lost onLost={() => setThreadId(null)}>
      <Overlay open={open} setOpen={setOpen} threadId={threadId} setThreadId={setThreadId} drafts={drafts} />
    </Lost>
  );
}

/**
 * A chat that was deleted, or is no longer shared with you, fails its reads, in the panel
 * or in a sheet open on it. The panel then starts over on a new chat, with its sheets
 * closed, instead of taking the page down with it.
 */
class Lost extends Component<{ onLost: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private failedAt = 0;
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // Failing again straight after starting over isn't a lost chat, so the panel stays away rather than loop.
    const again = Date.now() - this.failedAt < LOOP_MS;
    this.failedAt = Date.now();
    if (again) return;
    this.props.onLost();
    this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Overlay({
  open,
  setOpen,
  threadId,
  setThreadId,
  drafts,
}: {
  open: boolean;
  setOpen: (update: (open: boolean) => boolean) => void;
  threadId: ThreadId | null;
  setThreadId: (id: ThreadId | null) => void;
  drafts: Drafts;
}) {
  const t = useTranslations("assistant");
  // Read here, not in the chat, so the launcher shows a reply being written while the panel is folded.
  const snapshot = useQuery(api.assistant.replies.live, threadId ? { threadId } : "skip");
  const live = snapshot?.reply ?? null;
  const activity: Activity = snapshot?.activity ?? { phase: "idle", order: null };
  const [observed, setObserved] = useState(restingObservation);
  const next = observeActivity(observed, threadId, activity);
  if (next !== observed) setObserved(next);
  const [sendingFor, setSendingFor] = useState<{ threadId: ThreadId | null } | null>(null);
  const sending = sendingFor !== null && sendingFor.threadId === threadId;
  const [focused, setFocused] = useState(false);
  const clock = useRef<OrbitClock>(null);
  const working = sending || (live !== null && !live.asking && !live.stopping);
  const resting: OrbitMotion = focused ? "listening" : "idle";
  const orbit: OrbitMotion = sending ? "thinking"
    : activity.phase === "waiting" ? "listening"
    : activity.phase === "stopping" || activity.phase === "stopped" || activity.phase === "failed" ? "still"
    : activity.phase === "complete" ? next.complete ? "complete" : resting
    : activity.phase === "idle" ? resting : activity.phase;
  const completed = useCallback(() => setObserved((current) => current.complete ? { ...current, complete: false } : current), []);
  // Sheets stacked over the panel, bottom first.
  const [sheets, setSheets] = useState<OpenSheet[]>([]);
  const depth = sheets.length;
  const push = (sheet: OpenSheet) => setSheets((all) => [...all, sheet]);
  const pop = () => setSheets((all) => all.slice(0, -1));
  // A keyboard shortcut is an outside system: ⌘J or Ctrl+J opens and closes the panel, and Escape closes the top sheet.
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
  }, [setOpen]);
  const fold = () => {
    setFocused(false);
    setSheets([]);
    setOpen(() => false);
  };

  return (
    <MotionConfig reducedMotion="user">
      <span className="sr-only" role="status">{t(`activity.${sending ? "thinking" : activity.phase}`)}</span>
      <EdgeGlow open={open} working={working} />
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
            aria-label={t("label")}
          >
            {threadId ? <Here threadId={threadId} /> : null}
            <motion.div
              className="absolute inset-0 flex flex-col overflow-hidden rounded-[18px] border border-border/70 bg-card shadow-[0_24px_80px_-24px_rgb(0_0_0/0.55),0_0_0_1px_rgb(255_255_255/0.03)]"
              style={{ transformOrigin: "0% 50%" }}
              initial={false}
              animate={stackedUnder(depth)}
              transition={SHEET_SPRING}
            >
              <TooltipHint label={`${t("foldHint")}  ⌘J`}>
                <motion.button
                  type="button"
                  layoutId="assistant-logo"
                  layoutDependency={open}
                  onClick={fold}
                  aria-label={t("fold")}
                  transition={SHELL_SPRING}
                  className="absolute left-4 top-3.5 z-10 flex size-9 items-center justify-center rounded-xl bg-primary/10 hover:bg-primary/15"
                >
                  <OrbitMark size={24} motion={orbit} clock={clock} onComplete={completed} />
                </motion.button>
              </TooltipHint>
              <motion.div
                className="flex min-h-0 flex-1 flex-col"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.16, duration: 0.25 } }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
              >
                <Chat
                  threadId={threadId}
                  setThreadId={setThreadId}
                  drafts={drafts}
                  live={live}
                  sending={sending}
                  onSending={setSendingFor}
                  onComposerFocus={setFocused}
                  onFold={fold}
                  onHistory={() => push({ kind: "history" })}
                  onShare={(id, title, role) => push({ kind: "share", threadId: id, title, role })}
                />
              </motion.div>
              <Dim on={depth > 0} />
            </motion.div>
            <AnimatePresence>
              {sheets.map((sheet, i) => (
                <Sheet key={`${i}-${sheet.kind}`} index={i} depth={depth - 1 - i}>
                  {sheet.kind === "history" ? (
                    <HistorySheet
                      current={threadId}
                      onBack={pop}
                      onOpen={(id) => {
                        setThreadId(id);
                        pop();
                      }}
                      onNew={() => {
                        setThreadId(null);
                        pop();
                      }}
                      onShare={(id, title, role) => push({ kind: "share", threadId: id, title, role })}
                    />
                  ) : (
                    <ShareSheet threadId={sheet.threadId} title={sheet.title} role={sheet.role} onBack={pop} />
                  )}
                </Sheet>
              ))}
            </AnimatePresence>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>{!open ? <Launcher key="launcher" orbit={orbit} clock={clock} onComplete={completed} onOpen={() => setOpen(() => true)} /> : null}</AnimatePresence>
    </MotionConfig>
  );
}

/** Keeps the person in the chat's room while the panel has it open, so the others in it see they're there. */
function Here({ threadId }: { threadId: ThreadId }) {
  const heartbeat = useMutation(api.assistant.presence.heartbeat);
  const leave = useMutation(api.assistant.presence.leave);
  // A timer is an outside system: a beat now, one every PRESENCE_HEARTBEAT_MS, and leaving when the chat closes.
  // A tab that closes just stops beating, and the room drops it after 2.5 beats.
  useEffect(() => {
    const sessionId = crypto.randomUUID();
    let token: string | null = null;
    let left = false;
    const beat = () =>
      heartbeat({ threadId, sessionId }).then(
        (sessionToken) => {
          token = sessionToken;
          // The chat closed while this beat was on its way.
          if (left) leave({ sessionToken }).catch(() => {});
        },
        () => {},
      );
    void beat();
    const timer = setInterval(beat, PRESENCE_HEARTBEAT_MS);
    return () => {
      left = true;
      clearInterval(timer);
      if (token) leave({ sessionToken: token }).catch(() => {});
    };
  }, [threadId, heartbeat, leave]);
  return null;
}

function Chat({
  threadId,
  setThreadId,
  drafts,
  live,
  sending,
  onSending,
  onComposerFocus,
  onFold,
  onHistory,
  onShare,
}: {
  threadId: ThreadId | null;
  setThreadId: (id: ThreadId | null) => void;
  drafts: Drafts;
  live: Live | null;
  sending: boolean;
  onSending: (request: { threadId: ThreadId | null } | null) => void;
  onComposerFocus: (focused: boolean) => void;
  onFold: () => void;
  onHistory: () => void;
  onShare: (id: ThreadId, title: string, role: "owner" | "write" | "read") => void;
}) {
  const t = useTranslations("assistant");
  const toast = useAppToast();
  const thread = useQuery(api.assistant.threads.get, threadId ? { threadId } : "skip");
  const { results, status, loadMore } = usePaginatedQuery(api.assistant.replies.messages, threadId ? { threadId } : "skip", { initialNumItems: FIRST_MESSAGES });
  const presetModel = usePresetModels();
  // The model picked before the chat exists; once it does, the chat keeps its own.
  const [picked, setPicked] = useState<PickedModel | null>(null);
  const draft = drafts.of(threadId);
  // A new chat's first message, shown from the moment it's sent until the server's copy of it loads.
  const [first, setFirst] = useState<{ threadId: ThreadId | null; text: string } | null>(null);
  // The chat the open new chat became when its first message was sent. It's the thread already on screen, so the thread isn't built again for it.
  const [born, setBorn] = useState<ThreadId | null>(null);
  // The chat being made, so sending and sharing a chat that hasn't started both end up in the same one.
  const making = useRef<Promise<ThreadId> | null>(null);
  // The message on its way to the server, and the chat it's for: Stop pressed before its reply shows waits for it.
  const outgoing = useRef<Promise<ThreadId | null> | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const convex = useConvex();

  const create = useMutation(api.assistant.threads.create);
  const setModel = useMutation(api.assistant.threads.setModel);
  const stopReply = useMutation(api.assistant.replies.stop);
  // The message shows the moment it's sent, ahead of the server's copy.
  const sendMessage = useMutation(api.assistant.replies.send).withOptimisticUpdate((localQueryStore, args) =>
    insertAtTop({
      paginatedQuery: api.assistant.replies.messages,
      argsToMatch: { threadId: args.threadId },
      localQueryStore,
      // Convex works this out again on every update until the send lands. The same ID each time keeps it one bubble, which rises in once.
      item: { id: SENDING_ID, role: "user", order: Number.MAX_SAFE_INTEGER, text: args.text, status: "done", mine: true, at: 0 },
    }),
  );

  const model: PickedModel | null = threadId ? (thread?.model ? toMapModel(thread.model, thread.effort) : null) : (picked ?? presetModel?.("balanced", "chat") ?? null);
  const pickModel = (next: PickedModel, effort: Effort | undefined) => {
    if (!threadId) return setPicked(effort ? { ...next, effort } : next);
    setModel({ threadId, modelId: next._id, effort }).catch((error) => toast.error(t("modelFailed"), getErrorMessage(error, "")));
  };

  const busy = sending || live !== null;
  const canWrite = thread?.role !== "read";
  /** The open chat, made on the model the composer shows if it hasn't started. */
  const started = (title?: string) => {
    if (threadId) return Promise.resolve(threadId);
    making.current ??= create({ ...(title ? { title } : {}), ...(model ? { modelId: model._id, ...(model.effort ? { effort: model.effort } : {}) } : {}) })
      .then((id) => {
        setBorn(id);
        setThreadId(id);
        return id;
      })
      .finally(() => {
        making.current = null;
      });
    return making.current;
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !canWrite) return;
    const from = threadId;
    drafts.set(from, "");
    onSending({ threadId: from });
    if (!from) setFirst({ threadId: null, text });
    const sent = (async () => {
      const id = await started(titleFrom(text));
      onSending({ threadId: id });
      if (!from) setFirst({ threadId: id, text });
      // Where it's sent from goes with it, so "this" and "here" mean the page the person is on.
      await sendMessage({ threadId: id, text, view: window.location.pathname + window.location.search });
      return id;
    })();
    outgoing.current = sent.catch(() => null);
    try {
      await sent;
    } catch (error) {
      // The message goes back in the box it came from, unless something new was typed there meanwhile.
      drafts.set(from, (now) => now || text);
      setFirst(null);
      toast.error(t("sendFailed"), getErrorMessage(error, ""));
    } finally {
      onSending(null);
    }
  };
  const stop = async () => {
    if (threadId && live) return void stopReply({ threadId, attemptId: live.attemptId }).catch(() => {});
    // Pressed while the message is still on its way: once it has arrived, its reply is the one to stop.
    const id = await outgoing.current;
    const reply = id && (await convex.query(api.assistant.replies.live, { threadId: id }).catch(() => null));
    if (id && reply?.reply) await stopReply({ threadId: id, attemptId: reply.reply.attemptId }).catch(() => {});
  };
  const restart = () => {
    setBorn(null);
    setThreadId(null);
    composer.current?.focus();
  };
  // Sharing a chat that hasn't started makes it first, so there's something to share.
  const share = () =>
    started().then(
      (id) => onShare(id, thread?.title ?? t("newChat"), thread?.role ?? "owner"),
      (error) => toast.error(t("shareFailed"), getErrorMessage(error, "")),
    );
  const messages = [...results].reverse();
  const sent: Message[] =
    first && first.threadId === threadId && results.length === 0
      ? [{ id: SENDING_ID, role: "user", order: Number.MAX_SAFE_INTEGER, text: first.text, status: "done", mine: true, at: 0 }]
      : [];

  return (
    <>
      <Header title={threadId ? (thread?.title ?? "") : t("newChat")} onHistory={onHistory} onShare={share} onRestart={restart} onFold={onFold} />
      <Thread
        // A different chat starts at its own newest message. A new chat that has just become a real one is the same thread.
        key={threadId === null || threadId === born ? NEW : threadId}
        threadId={threadId}
        messages={[...messages, ...sent]}
        live={live}
        fresh={threadId === null && sent.length === 0}
        older={status === "CanLoadMore" ? () => loadMore(FIRST_MESSAGES) : status === "LoadingMore" ? "loading" : null}
      />
      <Footer composer={composer} draft={draft} setDraft={(text) => drafts.set(threadId, text)} busy={busy} summarizing={live?.compacting === true} canWrite={canWrite} onSend={send} onStop={stop} onComposerFocus={onComposerFocus} model={model} onModel={pickModel} presetModel={presetModel} />
    </>
  );
}

/** The folded panel: the mark, on every page. */
function Launcher({ orbit, clock, onComplete, onOpen }: { orbit: OrbitMotion; clock: RefObject<OrbitClock>; onComplete: () => void; onOpen: () => void }) {
  const t = useTranslations("assistant");
  return (
    <TooltipHint label={`${t("open")}  ⌘J`}>
      <motion.button
        type="button"
        layoutId="assistant-shell"
        layoutDependency={false}
        onClick={onOpen}
        aria-label={t("open")}
        transition={SHELL_SPRING}
        className="fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center border border-border/60 bg-card shadow-lg transition-colors hover:bg-muted"
        style={{ borderRadius: 18 }}
      >
        <motion.span layoutId="assistant-logo" layoutDependency={false} transition={SHELL_SPRING} className="relative flex size-11 items-center justify-center rounded-xl">
          <OrbitMark size={30} motion={orbit} clock={clock} onComplete={onComplete} />
        </motion.span>
      </motion.button>
    </TooltipHint>
  );
}

function Thread({
  threadId,
  messages,
  live,
  fresh,
  older,
}: {
  threadId: ThreadId | null;
  /** Oldest first: each message, then the steps of the reply to it, then the reply's text. */
  messages: Item[];
  live: Live | null;
  /** No chat yet: the empty state shows. */
  fresh: boolean;
  /** Loads the messages before these, when there are any. */
  older: (() => void) | "loading" | null;
}) {
  const t = useTranslations("assistant");
  // A reply's steps are one map, drawn where the first of them stands.
  const steps = Map.groupBy(messages.filter((m) => m.role === "step"), (step) => step.order);
  // A reply that has nothing to show yet: its action is still starting. It gets its row now, and its
  // message takes that same row when it arrives, so "Thinking" is one row throughout and never starts over.
  const starting = live !== null && !messages.some((m) => m.role !== "user" && m.order === live.order);
  const rows: Item[] = starting ? [...messages, { id: `${SENDING}reply`, role: "assistant", order: live.order, text: "", status: "pending", mine: false, at: 0 }] : messages;
  // Replies are told apart by their exchange and their place in it, which the row above shares with the message that follows it.
  const nth = new Map<number, number>();
  return (
    // Both edges fade. The bottom one is clear under the hanging chips, then fades the usual
    // distance; the content's bottom padding keeps the last message clear of both.
    <Conversation
      className="min-h-0 flex-1"
      style={{ maskImage: `linear-gradient(to bottom, transparent, black ${EDGE_FADE}px, black calc(100% - ${CHIP_HANG + EDGE_FADE}px), transparent calc(100% - ${CHIP_HANG}px))` }}
    >
      <ConversationContent className="gap-5 overflow-x-clip px-4 pt-4" style={{ paddingBottom: CHIP_HANG + EDGE_FADE + 8 }}>
        {fresh ? <Empty /> : null}
        {older ? (
          <button
            type="button"
            disabled={older === "loading"}
            onClick={older === "loading" ? undefined : older}
            className="flex h-7 items-center self-center rounded-full px-2.5 text-xs font-medium text-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {t("earlier")}
          </button>
        ) : null}
        {rows.map((m) => {
          if (m.role === "user") return <UserBubble key={m.id} message={m} />;
          if (m.role === "step") return steps.get(m.order)?.[0] === m && threadId ? <Steps key={m.id} threadId={threadId} steps={steps.get(m.order)!} /> : null;
          const place = nth.get(m.order) ?? 0;
          nth.set(m.order, place + 1);
          return (
            <div key={`reply:${m.order}:${place}`} className="space-y-3">
              {/* The map of its steps shows the work, so a reply that has run some doesn't also say it's thinking. */}
              <Reply message={m} live={live?.order === m.order ? live.text : ""} quiet={steps.has(m.order)} />
              {m.status === "stopped" ? <StoppedRow /> : null}
              {m.status === "failed" ? <FailedRow error={m.error} /> : null}
            </div>
          );
        })}
      </ConversationContent>
    </Conversation>
  );
}

/** A reply: its text as it arrives, or "Thinking" until the first of it does. */
function Reply({ message, live, quiet }: { message: Message; live: string; quiet: boolean }) {
  const pending = message.status === "pending";
  // One hook for the reply's whole life, so text still being revealed carries on when the reply is done.
  const [text, { isStreaming }] = useSmoothText(pending ? live : message.text, { startStreaming: pending });
  if (!text) return pending && !quiet ? <Thinking /> : null;
  return (
    <div className="text-sm leading-relaxed text-foreground">
      <MessageResponse isAnimating={pending || isStreaming} parseIncompleteMarkdown={pending || isStreaming || message.status === "stopped"} linkSafety={CHAT_LINK_SAFETY}>
        {text}
      </MessageResponse>
    </div>
  );
}

/** Under a reply that was stopped. */
function StoppedRow() {
  const t = useTranslations("assistant");
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
      <CircleStop className="size-3.5" /> {t("stopped")}
    </motion.div>
  );
}

/** Under a reply that failed: what went wrong, in the app's words for that error. */
function FailedRow({ error }: { error: Message["error"] }) {
  const t = useTranslations("assistant");
  const te = useTranslations("errors");
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="flex items-start gap-2 text-xs text-muted-foreground">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      {error ? (
        <span className="leading-5">
          {/* The shared texts for an unknown error and for a conversation that is too long are written for the paper chat. */}
          <span className="font-medium text-foreground">{te(`title.${error.code}`)}</span>{" "}
          {error.code === "unknown" ? t("failed") : error.code === "context_too_long" ? t("tooLong") : te(`body.${error.code}`)}
        </span>
      ) : (
        <span className="leading-5">{t("interrupted")}</span>
      )}
    </motion.div>
  );
}

/**
 * A message someone sent. In a shared chat, another person's carries their name. It rises
 * in as it's sent; the server's copy then takes its place without moving.
 */
function UserBubble({ message }: { message: Message }) {
  return (
    <motion.div
      initial={message.id.startsWith(SENDING) ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="ml-10 self-end"
    >
      {!message.mine && message.sender?.name ? <p className="mb-1 pr-1 text-right text-2xs text-muted-foreground">{message.sender.name}</p> : null}
      <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 text-sm leading-6">{message.text}</div>
    </motion.div>
  );
}

function Thinking() {
  const t = useTranslations("assistant");
  return (
    <div className="flex h-9 items-center gap-2 pl-1 text-sm">
      <OrbitMark size={18} motion="thinking" />
      <WorkingText>{t("thinking")}</WorkingText>
    </div>
  );
}

function Empty() {
  const t = useTranslations("assistant");
  return (
    <div className="space-y-1 pt-2">
      <p className="text-base font-semibold">{t("emptyTitle")}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{t("emptyBody")}</p>
    </div>
  );
}

function Header({ title, onHistory, onShare, onRestart, onFold }: { title: string; onHistory: () => void; onShare: () => void; onRestart: () => void; onFold: () => void }) {
  const t = useTranslations("assistant");
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
              // A title still loading keeps its line, so nothing moves when it arrives.
              className="h-5 truncate text-sm font-semibold"
            >
              {title}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="flex items-center">
          <IconButton label={t("chats")} icon={<MessagesSquare className="size-4" />} onClick={onHistory} />
          <IconButton label={t("shareChat")} icon={<UserPlus className="size-4" />} onClick={onShare} />
          <IconButton label={t("newChat")} icon={<SquarePen className="size-4" />} onClick={onRestart} />
          <IconButton label={t("foldIntoBubble")} shortcut="⌘J" icon={<PictureInPicture2 className="size-4" />} onClick={onFold} />
        </div>
      </div>
    </div>
  );
}

/**
 * The chat's model and effort, beside Send, on the shared model picker with each
 * preset's chat model first. A new chat starts on the Balanced preset's chat model.
 */
function ModelPill({
  model,
  onChange,
  presetModel,
}: {
  model: PickedModel | null;
  onChange: (model: PickedModel, effort: Effort | undefined) => void;
  presetModel: ReturnType<typeof usePresetModels>;
}) {
  const t = useTranslations("assistant");
  const tm = useTranslations("settingsAi");
  const presets: PresetPick[] = presetModel
    ? PRESET_KEYS.flatMap((preset) => {
        const m = presetModel(preset, "chat");
        return m ? [{ id: preset, models: [m], onSelect: () => onChange(m, m.effort) }] : [];
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
      onChange={onChange}
      trigger={
        // Right-aligned, so while the model loads nothing beside it moves when it fills in.
        <button
          type="button"
          aria-label={model ? [stripProviderPrefix(model.name), effort && tm(`efforts.${effort}`)].filter(Boolean).join(", ") : t("model")}
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

/** The page the person is on, as the composer names it. Each message carries its address (`send`). */
function useViewName() {
  const pathname = usePathname();
  const t = useTranslations("assistant.views");
  const common = useTranslations("common");
  const topics = useTranslations("topics");
  const at = (route: string) => pathname === route || pathname.startsWith(`${route}/`);
  if (pathname === "/") return common("home");
  if (at("/results")) return t("results");
  if (at("/history")) return common("history");
  if (at("/bookmarks")) return common("bookmarks");
  if (at("/library")) return common("library");
  if (at("/screening")) return common("screening");
  if (pathname.startsWith("/extraction/")) return t("extractionJob");
  if (at("/extraction")) return common("extraction");
  if (/^\/evidence-libraries\/[^/]+\/configuration/.test(pathname)) return t("librarySettings");
  if (at("/evidence-libraries")) return common("evidenceLibraries");
  if (at("/topics")) return topics("title");
  if (at("/authors")) return t("authors");
  if (at("/settings")) return common("settings");
  return t("page");
}

function Footer({
  composer,
  draft,
  setDraft,
  busy,
  summarizing,
  canWrite,
  onSend,
  onStop,
  onComposerFocus,
  model,
  onModel,
  presetModel,
}: {
  composer: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (text: string) => void;
  /** A reply is being written, here or for someone else in the chat. */
  busy: boolean;
  /** The reply is written and the chat is summarizing itself before it takes the next message: the box says so. */
  summarizing: boolean;
  /** Someone who only reads the chat can't send. */
  canWrite: boolean;
  onSend: () => void;
  onStop: () => void;
  onComposerFocus: (focused: boolean) => void;
  model: PickedModel | null;
  onModel: (model: PickedModel, effort: Effort | undefined) => void;
  presetModel: ReturnType<typeof usePresetModels>;
}) {
  const t = useTranslations("assistant");
  const view = useViewName();
  return (
    <div className="space-y-2 p-3 pt-0">
      {/* The chips hang from their middle on the thread's bottom edge; their frame is the lower half. */}
      <div style={{ height: CHIP_HANG }} />
      <div className="rounded-2xl border border-border/60 bg-background shadow-xs focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
        <textarea
          ref={composer}
          value={draft}
          disabled={!canWrite}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => onComposerFocus(true)}
          onBlur={() => onComposerFocus(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={2}
          placeholder={!canWrite ? t("readOnly") : summarizing ? t("summarizing") : t("placeholder")}
          aria-label={t("messageLabel")}
          className="relative block w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <span className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-muted/60 px-2.5 text-xs text-muted-foreground">
            <Eye className="size-3" /> {t("sees", { view })}
          </span>
          <ModelPill model={model} onChange={onModel} presetModel={presetModel} />
          {/* The span keeps the hint reachable while the button is disabled. */}
          <TooltipHint label={!canWrite ? t("readOnly") : busy ? t("stop") : t("send")}>
            <span className="flex shrink-0" tabIndex={canWrite ? undefined : 0}>
              <button
                type="button"
                aria-label={busy ? t("stop") : t("send")}
                disabled={!canWrite}
                onClick={busy ? onStop : onSend}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={busy ? "stop" : "send"}
                    initial={{ opacity: 0, scale: 0.4, rotate: busy ? -90 : 90 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.4 }}
                    transition={{ type: "spring", stiffness: 520, damping: 30 }}
                    className="flex"
                  >
                    {busy ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-4" />}
                  </motion.span>
                </AnimatePresence>
              </button>
            </span>
          </TooltipHint>
        </div>
      </div>
    </div>
  );
}

/** A slow, drifting glow in the brand's colours on the screen's right edge while the assistant is open. */
function EdgeGlow({ open, working }: { open: boolean; working: boolean }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="glow"
          aria-hidden
          className="pointer-events-none fixed inset-y-0 right-0 z-0 w-[560px] overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: working ? 1 : 0.7 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <motion.div
            className="absolute -right-40 top-[-10%] h-[70%] w-[420px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--primary-bright)_32%,transparent),transparent)] blur-3xl"
            animate={{ y: ["0%", "45%", "0%"], x: [0, -40, 0] }}
            transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute -right-48 bottom-[-15%] h-[70%] w-[440px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--primary-deep)_28%,transparent),transparent)] blur-3xl"
            animate={{ y: ["0%", "-40%", "0%"], x: [0, -30, 0] }}
            transition={{ duration: 17, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-primary/70 to-transparent"
            animate={{ opacity: working ? [0.4, 1, 0.4] : 0.5 }}
            transition={working ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.6 }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
