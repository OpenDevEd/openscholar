"use client";

// MOCK (branch mock/assistant-web-pdf): the assistant's panel with scripted data, to agree on
// attaching PDFs and images, the asks before reading a PDF and searching the web, their steps,
// and a reply that cites pages and web sources. It reuses the real panel's pieces; nothing here
// reads or writes Convex. Files picked, dropped or pasted are read in the browser for real: an
// image is shrunk and re-encoded, a PDF's pages are counted. Uploading is pretend.

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { useFormatter } from "next-intl";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { InlineCitation, InlineCitationCard, InlineCitationSource } from "@/components/ai-elements/inline-citation";
import { LinkSafetyDialog } from "@/components/ai-elements/link-safety-dialog";
import { MessageResponse } from "@/components/ai-elements/message";
import { Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { ChevronDown, FileSearch, FileText, Globe, Hourglass, Paperclip, TriangleAlert, X } from "@/components/icons";
import type { PickedModel } from "@/components/settings/model-map";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { EDGE_FADE } from "@/components/ui/scroll-area";
import { TooltipHint } from "@/components/ui/tooltip";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_PDF_BYTES, MAX_PDF_MB } from "@/lib/files/limits";
import { cn } from "@/lib/utils";
import { RECORD_CHIP, recordChipStyle } from "./mentions";
import { OrbitMark } from "./orbit-mark";
import { FadeRow } from "./parts";
import { Footer, Header, PANEL_W, ReplyLink, Thinking, UserBubble } from "./panel";
import { ApprovalCard, RunMap, type StepItem } from "./steps";

const THREAD = "mock" as Id<"assistantThreads">;
const T0 = Date.now();
const BALANCE = 12_480;

/** Limits agreed on 2026-10-07: PDFs as large as the app takes anywhere, images before they're shrunk, uploads an hour. */
const MAX_IMAGE_MB = 20;
const UPLOADS_AN_HOUR = 50;

/** A web search's fee, as lib/pricing/web-search.ts prices it: $0.007 at 13,000 credits a dollar. */
const SEARCH_CREDITS = 91;

type Attachment = {
  id: string;
  kind: "pdf" | "image";
  name: string;
  /** Bytes as stored: an image after it's shrunk. */
  bytes: number;
  pages?: number;
  url?: string;
  /** 0 to 1 while it uploads; 1 when it's in. */
  progress: number;
  error?: string;
  /** Sent with an earlier message and gone after 30 days unread. */
  expired?: boolean;
};

const SONNET: PickedModel = { _id: "mock-sonnet" as Id<"models">, id: "anthropic/claude-sonnet-5.5", name: "Anthropic: Claude Sonnet 5.5", inputPricePerMillion: 3, outputPricePerMillion: 15 };
const DEEPSEEK: PickedModel = { _id: "mock-deepseek" as Id<"models">, id: "deepseek/deepseek-v4-pro", name: "DeepSeek: DeepSeek V4 Pro", inputPricePerMillion: 0.6, outputPricePerMillion: 2.2 };
/** Whether a model takes files, as OpenRouter's `architecture.input_modalities` says (models.inputModalities). */
const readsFiles = (model: PickedModel) => model.id !== DEEPSEEK.id;

const SAMPLE_PDF_URL = "https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0206767&type=printable";
const OLD_PDF: Attachment = { id: "old-pdf", kind: "pdf", name: "dcms-loot-boxes-call-for-evidence-2020.pdf", bytes: 2_310_000, pages: 41, progress: 1, expired: true };

type Web = { url: string; title: string; description: string };
const WEB: Record<string, Web> = {
  "1": {
    url: "https://www.gamingcommission.be/en/gaming-commission/loot-boxes",
    title: "Research report on loot boxes",
    description: "The Belgian Gaming Commission found that paid loot boxes in three of the four games it examined were games of chance under Belgian law, and asked for them to be removed.",
  },
  "2": {
    url: "https://www.gov.uk/government/consultations/loot-boxes-in-video-games-call-for-evidence/outcome/government-response-to-the-call-for-evidence-on-loot-boxes-in-video-games",
    title: "Government response to the call for evidence on loot boxes in video games",
    description: "The UK government chose not to bring loot boxes under gambling law, and asked the games industry to improve protections for players itself.",
  },
  "3": {
    url: "https://www.pegi.info/news/pegi-introduces-in-game-purchase-descriptor",
    title: "PEGI introduces an in-game purchases descriptor",
    description: "Games with paid random items carry an \"In-game purchases (includes random items)\" notice on their age rating.",
  },
};

type Phase = "idle" | "uploading" | "thinking" | "pdf" | "web1" | "web2" | "answering" | "done";
type Ask = "asking" | "running" | "done" | "declined";
type Script = { phase: Phase; pdf?: Ask; web1?: Ask; web2?: Ask; answer: string };
const FRESH: Script = { phase: "idle", answer: "" };

const DRAFT = "What did this paper find, and what have regulators done about loot boxes since?";

/** The reply, from what it was allowed to do. Pages link into the PDF; web sources are cited by number. */
function answerOf(script: Script, image: boolean) {
  const read = script.pdf === "done";
  const searched = script.web1 === "done";
  const parts: string[] = [];
  parts.push(
    read
      ? "Zendle and Cairns surveyed **7,422 gamers** [p. 3](#page-3). The more severe someone's problem gambling, the more they spent on loot boxes, at every step up the scale [p. 7](#page-7). That link was stronger than the one between problem gambling and buying other in-game items [p. 1](#page-1). The study is correlational, so it can't say which causes which [p. 8](#page-8)."
      : "I didn't read the PDF, so I can't say what it found. Ask me again and allow it if you want me to.",
  );
  if (image) parts.push("Your screenshot shows the same pattern as the paper's Table 1 [p. 6](#page-6).");
  parts.push(
    searched
      ? "Since then, regulators have split:\n\n- **Belgium** ruled in 2018 that paid loot boxes in three of the four games it examined were gambling, and had them taken out [1](#cite-1).\n- **The UK** decided in 2022 not to change gambling law, and asked the industry to protect players itself [2](#cite-2).\n- **Europe's age ratings** now mark games that sell random items [3](#cite-3)."
      : "I didn't search the web, so I can't say what regulators have done since.",
  );
  return parts.join("\n\n");
}

export function AttachMock() {
  const [files, setFiles] = useState<Attachment[]>([]);
  // The files of the message being written; the rest belong to messages already sent.
  const [pending, setPending] = useState<string[]>([]);
  const [sent, setSent] = useState<string[] | null>(null);
  const [draft, setDraft] = useState(DRAFT);
  const [model, setModel] = useState<PickedModel>(SONNET);
  const [allowed, setAllowed] = useState<{ web: boolean; pdf: boolean }>({ web: false, pdf: false });
  const [limited, setLimited] = useState(false);
  const [dragging, setDragging] = useState(0);
  const [script, setScript] = useState<Script>(FRESH);
  const picker = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  // The browser's idle callback: the image worker starts and pdf.js loads while nothing else is happening.
  useEffect(() => {
    if (!("requestIdleCallback" in window)) {
      const timer = setTimeout(() => {
        startShrinker();
        void loadPdfjs();
      }, 1500);
      return () => clearTimeout(timer);
    }
    const handle = requestIdleCallback(() => {
      startShrinker();
      void loadPdfjs();
    });
    return () => cancelIdleCallback(handle);
  }, []);

  const patch = (id: string, change: Partial<Attachment>) => setFiles((all) => all.map((file) => (file.id === id ? { ...file, ...change } : file)));
  const byId = (ids: string[]) => ids.map((id) => files.find((file) => file.id === id)).filter((file): file is Attachment => file !== undefined);

  /** Takes files the person picked, dropped or pasted: refused at once when they can't be sent, read in the browser when they can. */
  const add = (list: File[]) => {
    const fresh = list.map((file): Attachment & { file: File } => {
      const kind = file.type === "application/pdf" ? "pdf" : "image";
      const id = `${Date.now()}-${Math.random()}`;
      const base = { id, kind, name: file.name || (kind === "image" ? "Pasted image" : "Untitled.pdf"), bytes: file.size, progress: 0, file } as const;
      if (file.type !== "application/pdf" && !file.type.startsWith("image/")) return { ...base, kind: "pdf", error: "Only PDFs and images" };
      if (limited) return { ...base, error: `${UPLOADS_AN_HOUR} uploads an hour` };
      if (kind === "pdf" && file.size > MAX_PDF_BYTES) return { ...base, error: `Over ${MAX_PDF_MB} MB` };
      if (kind === "image" && file.size > MAX_IMAGE_MB * 1024 * 1024) return { ...base, error: `Over ${MAX_IMAGE_MB} MB` };
      if (!readsFiles(model)) return { ...base, error: "This model can't read it" };
      return base;
    });
    setFiles((all) => [...all, ...fresh.map(({ file: _file, ...rest }) => rest)]);
    setPending((ids) => [...ids, ...fresh.map((file) => file.id)]);
    for (const one of fresh) {
      if (one.error) continue;
      if (one.kind === "image") {
        // After the tray has opened, so handing the file over costs none of its frames.
        setTimeout(() => shrink(one.file).then(
          (blob) => patch(one.id, { bytes: blob.size, url: URL.createObjectURL(blob) }),
          () => patch(one.id, { error: "Can't read this image" }),
        ), 350);
      } else {
        patch(one.id, { url: URL.createObjectURL(one.file) });
        // As the server will: the pages are counted once the file is in, after the tray has opened.
        setTimeout(() => countPages(one.file).then(
          (pages) => patch(one.id, { pages }),
          (error) => {
            console.error("[mock] page count", error);
            patch(one.id, { error: "Can't open this PDF" });
          },
        ), 900);
      }
    }
  };

  const remove = (id: string) => {
    setPending((ids) => ids.filter((one) => one !== id));
    setFiles((all) => all.filter((file) => file.id !== id));
  };

  // A timer: uploads fill in, a little faster for small files.
  const uploading = files.some((file) => !file.error && !file.expired && file.progress < 1);
  useEffect(() => {
    if (!uploading) return;
    const timer = setInterval(() => setFiles((all) => all.map((file) => (file.error || file.expired || file.progress >= 1 ? file : { ...file, progress: Math.min(1, file.progress + Math.max(0.06, 0.5 - file.bytes / 4_000_000)) }))), 120);
    return () => clearInterval(timer);
  }, [uploading]);

  const send = () => {
    if (script.phase !== "idle" && script.phase !== "done") return;
    // Files that were refused stay behind with the reason, and aren't sent.
    const going = pending.filter((id) => !files.find((file) => file.id === id)?.error);
    setSent(going);
    setPending([]);
    setFiles((all) => all.filter((file) => !file.error));
    setDraft("");
    setScript({ phase: "uploading", answer: "" });
  };

  // A timer: the scripted reply moves on a beat after each thing it waits for.
  const sentFiles = sent ? byId(sent) : [];
  const ready = sentFiles.every((file) => file.progress >= 1);
  const hasPdf = sentFiles.some((file) => file.kind === "pdf");
  const hasImage = sentFiles.some((file) => file.kind === "image");
  useEffect(() => {
    const after = (ms: number, next: (now: Script) => Script) => {
      const timer = setTimeout(() => setScript(next), ms);
      return () => clearTimeout(timer);
    };
    const s = script;
    if (s.phase === "uploading" && ready) return after(150, (now) => ({ ...now, phase: "thinking" }));
    if (s.phase === "thinking") return after(1100, (now) => (hasPdf ? { ...now, phase: "pdf", pdf: allowed.pdf ? "running" : "asking" } : { ...now, phase: "web1", web1: allowed.web ? "running" : "asking" }));
    if (s.phase === "pdf" && s.pdf === "running") return after(1800, (now) => ({ ...now, pdf: "done" }));
    if (s.phase === "pdf" && (s.pdf === "done" || s.pdf === "declined")) return after(500, (now) => ({ ...now, phase: "web1", web1: allowed.web ? "running" : "asking" }));
    if (s.phase === "web1" && s.web1 === "running") return after(1400, (now) => ({ ...now, web1: "done" }));
    if (s.phase === "web1" && s.web1 === "done") return after(400, (now) => ({ ...now, phase: "web2", web2: allowed.web ? "running" : "asking" }));
    if (s.phase === "web1" && s.web1 === "declined") return after(400, (now) => ({ ...now, phase: "answering" }));
    if (s.phase === "web2" && s.web2 === "running") return after(1300, (now) => ({ ...now, web2: "done" }));
    if (s.phase === "web2" && (s.web2 === "done" || s.web2 === "declined")) return after(400, (now) => ({ ...now, phase: "answering" }));
    if (s.phase === "answering") {
      const full = answerOf(s, hasImage);
      if (s.answer.length >= full.length) return after(0, (now) => ({ ...now, phase: "done" }));
      return after(28, (now) => ({ ...now, answer: full.slice(0, now.answer.length + 6) }));
    }
  }, [script, ready, hasPdf, hasImage, allowed]);

  const answer = (which: "pdf" | "web1" | "web2") => (allow: boolean, always?: boolean) => {
    if (always) setAllowed((now) => ({ ...now, [which === "pdf" ? "pdf" : "web"]: true }));
    setScript((now) => ({ ...now, [which]: allow ? "running" : "declined" }));
  };

  const busy = script.phase !== "idle" && script.phase !== "done";
  const canAttach = readsFiles(model);
  const pendingFiles = byId(pending);

  return (
    <MotionConfig reducedMotion="user">
      <aside
        className="fixed bottom-4 right-4 top-4 z-40 max-w-[calc(100vw-1.5rem)]"
        style={{ width: PANEL_W, borderRadius: 18 }}
        aria-label="Assistant (mock)"
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging((n) => n + 1);
        }}
        onDragOver={(event) => event.dataTransfer.types.includes("Files") && event.preventDefault()}
        onDragLeave={() => setDragging((n) => Math.max(0, n - 1))}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          setDragging(0);
          if (canAttach) add([...event.dataTransfer.files]);
        }}
      >
        <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[18px] border border-border/70 bg-card shadow-[0_24px_80px_-24px_rgb(0_0_0/0.55),0_0_0_1px_rgb(255_255_255/0.03)]">
          <span className="absolute left-4 top-3.5 z-10 flex size-9 items-center justify-center rounded-xl bg-primary/10">
            <OrbitMark size={24} motion={busy ? "thinking" : "idle"} />
          </span>
          <Header title="Loot box regulation" onHistory={() => {}} onShare={() => {}} onSpending={() => {}} onRestart={() => {}} onFold={() => {}} />
          <LayoutGroup>
            <Thread script={script} files={files} sent={sent} onAnswer={answer} onReattach={() => picker.current?.click()} />
            <div
              onPasteCapture={(event: ClipboardEvent) => {
                const pasted = [...event.clipboardData.files];
                if (!pasted.length || !canAttach) return;
                event.preventDefault();
                add(pasted);
              }}
            >
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
                onStop={() => setScript({ ...FRESH, phase: "done" })}
                onComposerFocus={() => {}}
                model={model}
                onModel={() => {}}
                presetModel={undefined}
                meter={null}
                allowance={null}
                onStopAllowance={() => {}}
                onCarryOn={() => {}}
                onSpending={() => {}}
                chips={<Allowed allowed={allowed} onStop={(which) => setAllowed((now) => ({ ...now, [which]: false }))} />}
                attach={<AttachButton model={model} onPick={() => picker.current?.click()} />}
                attachments={<Tray files={pendingFiles} onRemove={remove} />}
              />
            </div>
          </LayoutGroup>
          <input
            ref={picker}
            type="file"
            accept="application/pdf,image/*"
            multiple
            hidden
            onChange={(event) => {
              add([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
          <AnimatePresence>
            {dragging > 0 ? (
              <motion.div
                key="drop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: EASE }}
                className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-card/90 text-center"
              >
                <span className={cn("flex size-12 items-center justify-center rounded-2xl", canAttach ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-600")}>
                  {canAttach ? <Paperclip className="size-6" /> : <TriangleAlert className="size-6" />}
                </span>
                <p className="text-sm font-semibold">{canAttach ? "Drop PDFs or images" : `${shortName(model)} can't read files`}</p>
                <div className="flex gap-1.5 text-xs text-muted-foreground">
                  <Limit value={`${MAX_PDF_MB} MB`}>a PDF</Limit>
                  <Limit value={`${MAX_IMAGE_MB} MB`}>an image</Limit>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </aside>
      <Controls
        model={model}
        setModel={setModel}
        limited={limited}
        onLimited={() => setLimited((now) => !now)}
        onSamples={() => void samples().then(add, (error) => console.error("[mock] samples", error))}
        onHuge={() => add([new File([new Uint8Array(8)], "full-thesis-scans.pdf", { type: "application/pdf" })].map((file) => Object.defineProperty(file, "size", { value: 148 * 1024 * 1024 })))}
        onForget={() => setAllowed({ web: false, pdf: false })}
        onReplay={() => {
          setScript(FRESH);
          setSent(null);
          setDraft(DRAFT);
        }}
      />
    </MotionConfig>
  );
}

/** A size and what it's the most for, as one chip. */
function Limit({ value, children }: { value: string; children: ReactNode }) {
  return (
    <span className="flex h-6 items-center gap-1 rounded-md bg-foreground/[0.06] px-2">
      <span className="font-semibold text-foreground/90">{value}</span> {children}
    </span>
  );
}

const shortName = (model: PickedModel) => model.name.replace(/^[^:]+:\s*/, "");

/** Before the page chip: picks PDFs and images. Off, with the reason, on a model that can't read them. */
function AttachButton({ model, onPick }: { model: PickedModel; onPick: () => void }) {
  const can = readsFiles(model);
  return (
    <TooltipHint label={can ? "Attach PDFs or images" : `${shortName(model)} can't read files. Pick another model to attach them.`}>
      <span className="flex shrink-0" tabIndex={can ? undefined : 0}>
        <button
          type="button"
          aria-label="Attach PDFs or images"
          disabled={!can}
          onClick={onPick}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <Paperclip className="size-4" />
        </button>
      </span>
    </TooltipHint>
  );
}

/** What the person allowed for the rest of the chat, beside the allowance chip: each one's X asks again from then on. */
function Allowed({ allowed, onStop }: { allowed: { web: boolean; pdf: boolean }; onStop: (which: "web" | "pdf") => void }) {
  if (!allowed.web && !allowed.pdf) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <AnimatePresence initial={false}>
        {(["pdf", "web"] as const)
          .filter((which) => allowed[which])
          .map((which) => {
            const Icon = which === "web" ? Globe : FileSearch;
            const stop = which === "web" ? "Ask before searching the web" : "Ask before reading a PDF";
            return (
              <motion.span
                key={which}
                layout="position"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: "spring", stiffness: 480, damping: 32 }}
                className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full pl-2.5 pr-1 text-xs font-medium"
                style={{ ...recordChipStyle(`var(--kind-${which === "web" ? "web" : "file"})`), backgroundColor: `color-mix(in oklab, var(--kind-${which === "web" ? "web" : "file"}) 14%, transparent)` }}
              >
                <Icon className="size-3" /> {which === "web" ? "Web search" : "Reading PDFs"}
                <TooltipHint label={stop}>
                  <button type="button" aria-label={stop} onClick={() => onStop(which)} className="flex size-5 items-center justify-center rounded-full hover:bg-foreground/10">
                    <X className="size-3" />
                  </button>
                </TooltipHint>
              </motion.span>
            );
          })}
      </AnimatePresence>
    </div>
  );
}

const TRAY_H = 64;

/** The files going with the message being written, over its text. Opens as the first one arrives and closes after the last. */
function Tray({ files, onRemove }: { files: Attachment[]; onRemove: (id: string) => void }) {
  return (
    <motion.div className="overflow-hidden" initial={false} animate={{ height: files.length ? TRAY_H : 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <FadeRow scrolls className="px-2 pt-2">
        <div className="flex h-14 w-max items-center gap-2 pr-2">
        <AnimatePresence initial={false} mode="popLayout">
          {files.map((file) => (
            <motion.div
              key={file.id}
              layout="position"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="shrink-0"
            >
              {file.kind === "image" && !file.error ? <ImageChip file={file} onRemove={() => onRemove(file.id)} /> : <FileChip file={file} onRemove={() => onRemove(file.id)} />}
            </motion.div>
          ))}
        </AnimatePresence>
        </div>
      </FadeRow>
    </motion.div>
  );
}

function useSize() {
  const format = useFormatter();
  return (bytes: number) =>
    bytes >= 1024 * 1024 ? `${format.number(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB` : `${format.number(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** A thin ring that fills as a file uploads, over its tile. */
function Ring({ progress }: { progress: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className="size-6 -rotate-90" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2.5} />
      <motion.circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - progress) }} transition={{ duration: 0.2 }} />
    </svg>
  );
}

/**
 * A PDF on its way, or one that can't go: its tile, its name, then its pages and size as chips.
 * Refused, it says why in their place; uploading, the tile is a ring.
 */
function FileChip({ file, onRemove, compact }: { file: Attachment; onRemove?: () => void; compact?: boolean }) {
  const size = useSize();
  const bad = Boolean(file.error);
  const loading = !bad && !file.expired && file.progress < 1;
  return (
    <div
      className={cn(
        "group relative flex items-center gap-2.5 rounded-xl pl-1.5 pr-2",
        compact ? "h-11 max-w-[15rem]" : "h-12 w-[13.5rem]",
        bad ? "bg-destructive/[0.07] ring-1 ring-destructive/25" : file.expired ? "bg-muted/40" : "bg-muted/60",
      )}
    >
      <span
        className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", file.expired && "opacity-50")}
        style={{ backgroundColor: bad ? "color-mix(in oklab, var(--destructive) 14%, transparent)" : "color-mix(in oklab, var(--kind-file) 16%, transparent)", color: bad ? "var(--destructive)" : "var(--kind-file)" }}
      >
        {loading ? <Ring progress={file.progress} /> : bad ? <TriangleAlert className="size-4" /> : file.expired ? <Hourglass className="size-4" /> : <FileText className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <TooltipHint label={file.name} onlyWhenClipped>
          <p className={cn("truncate text-xs font-medium", file.expired && "text-muted-foreground")}>{file.name}</p>
        </TooltipHint>
        <div className="mt-0.5 flex items-center gap-1 overflow-hidden whitespace-nowrap text-2xs text-muted-foreground">
          {bad ? (
            <span className="truncate font-medium text-destructive">{file.error}</span>
          ) : file.expired ? (
            <span className="truncate">Expired, attach it again</span>
          ) : (
            <>
              {file.pages !== undefined ? <span className="tabular-nums">{file.pages} pages</span> : null}
              {file.pages !== undefined ? <span className="text-foreground/30">/</span> : null}
              <span className="tabular-nums">{size(file.bytes)}</span>
            </>
          )}
        </div>
      </div>
      {onRemove ? <RemoveButton onRemove={onRemove} name={file.name} /> : null}
    </div>
  );
}

function RemoveButton({ onRemove, name }: { onRemove: () => void; name: string }) {
  return (
    <TooltipHint label="Remove">
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3" />
      </button>
    </TooltipHint>
  );
}

/** An image on its way: the picture itself, shrunk, with a ring over it while it uploads. */
function ImageChip({ file, onRemove, compact }: { file: Attachment; onRemove?: () => void; compact?: boolean }) {
  const loading = file.progress < 1;
  return (
    <div className={cn("group relative shrink-0 overflow-visible rounded-xl bg-muted/60", compact ? "size-11" : "size-12")}>
      {file.url ? <img src={file.url} alt={file.name} className="size-full rounded-xl object-cover" /> : null}
      <AnimatePresence>
        {loading ? (
          <motion.span key="ring" exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/35 text-white">
            <Ring progress={file.progress} />
          </motion.span>
        ) : null}
      </AnimatePresence>
      {onRemove ? <RemoveButton onRemove={onRemove} name={file.name} /> : null}
    </div>
  );
}

/** The files a message went with, over its bubble, right-aligned as the bubble is. An expired one can be attached again. */
function SentFiles({ files, onReattach }: { files: Attachment[]; onReattach?: () => void }) {
  if (!files.length) return null;
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {files.map((file) =>
        file.kind === "image" ? (
          <ImageChip key={file.id} file={file} compact />
        ) : file.expired && onReattach ? (
          <button key={file.id} type="button" onClick={onReattach} className="rounded-xl text-left transition-opacity hover:opacity-80">
            <FileChip file={file} compact />
          </button>
        ) : (
          <FileChip key={file.id} file={file} compact />
        ),
      )}
    </div>
  );
}

const step = (id: string, action: string, extra: Partial<StepItem>): StepItem =>
  ({ id, role: "step", order: 1, action, status: "done", canAnswer: false, canUndo: false, undone: false, at: T0, ...extra }) as StepItem;

const STATUS = { asking: "asking", running: "running", done: "done", declined: "declined" } as const;

function Thread({
  script,
  files,
  sent,
  onAnswer,
  onReattach,
}: {
  script: Script;
  files: Attachment[];
  sent: string[] | null;
  onAnswer: (which: "pdf" | "web1" | "web2") => (allow: boolean, always?: boolean) => void;
  onReattach: () => void;
}) {
  const sentFiles = (sent ?? []).map((id) => files.find((file) => file.id === id)).filter((file): file is Attachment => file !== undefined);
  const pdf = sentFiles.find((file) => file.kind === "pdf");
  const pages = pdf?.pages ?? 15;
  const reading = Math.min(pages, 12);
  // What the reply ran and what it asks: an ask shows as a card under the map, and joins the map once answered.
  const all: StepItem[] = [];
  if (script.pdf && pdf)
    all.push(
      step("pdf", "files/pdf:read", {
        status: STATUS[script.pdf],
        canAnswer: script.pdf === "asking",
        subject: pdf.name,
        details: [
          { name: "file", value: pdf.name },
          { name: "pages", value: `1–${reading} of ${pages}` },
        ],
        // Pages as tokens on Sonnet 5.5: about 2,000 a page with its image, at $3 a million, 13,000 credits a dollar.
        credits: script.pdf === "asking" ? Math.round((reading * 2_000 * 3 * 13_000) / 1_000_000) : undefined,
      }),
    );
  if (script.web1)
    all.push(
      step("web1", "web/search:run", {
        status: STATUS[script.web1],
        canAnswer: script.web1 === "asking",
        subject: "loot box regulation since 2018",
        count: script.web1 === "done" ? 8 : undefined,
        details: [{ name: "query", value: "loot box regulation since 2018" }],
        credits: script.web1 === "asking" ? SEARCH_CREDITS : undefined,
      }),
    );
  if (script.web2)
    all.push(
      step("web2", "web/search:run", {
        status: STATUS[script.web2],
        canAnswer: script.web2 === "asking",
        subject: "Belgium Gaming Commission loot boxes ruling",
        count: script.web2 === "done" ? 5 : undefined,
        details: [{ name: "query", value: "Belgium Gaming Commission loot boxes ruling" }],
        credits: script.web2 === "asking" ? SEARCH_CREDITS : undefined,
      }),
    );
  const asked = all.filter((one) => one.canAnswer);
  const mapped = all.filter((one) => !one.canAnswer);
  const done = script.phase === "done" || script.phase === "answering";
  const cited = script.web1 === "done" ? (["1", "2", "3"] as const) : [];
  // From the message going until its text starts, as the real reply: the mark stays, and drops its word while a card says what it does.
  const waiting = !script.answer && script.phase !== "idle" && script.phase !== "done";
  const acting = asked.length > 0 || mapped.some((one) => one.status === "running");
  const parts = { a: ({ href, children }: { href?: string; children?: ReactNode }) => <CitedLink href={href} pdf={pdf}>{children}</CitedLink> };

  return (
    <Conversation className="min-h-0 flex-1" style={{ maskImage: `linear-gradient(to bottom, transparent, black ${EDGE_FADE}px, black calc(100% - ${EDGE_FADE}px), transparent)` }}>
      <ConversationContent className="gap-5 overflow-x-clip px-4 pt-4" style={{ paddingBottom: EDGE_FADE + 8 }}>
        <UserBubble
          message={{ id: "m0", role: "user", order: 0, text: "Can you check the methods section of this report?", status: "done", mine: true, at: T0 - 40 * 86_400_000 } as never}
          attachments={<SentFiles files={[OLD_PDF]} onReattach={onReattach} />}
        />
        <div className="text-sm leading-relaxed text-foreground">
          <MessageResponse>The call for evidence collected responses rather than running a study: it asked players, parents and the industry for views and data, and summarised what came back.</MessageResponse>
        </div>
        {sent ? (
          <>
            <UserBubble message={{ id: "m1", role: "user", order: 1, text: DRAFT, status: "done", mine: true, at: T0 } as never} attachments={<SentFiles files={sentFiles} />} />
            <div className="space-y-3">
              {mapped.length ? <RunMap threadId={THREAD} steps={mapped} earlier={null} /> : null}
              <AnimatePresence initial={false}>
                {asked.map((one) => (
                  <ApprovalCard key={one.id} threadId={THREAD} step={one} balance={BALANCE} onAnswer={onAnswer(one.id as "pdf" | "web1" | "web2")} />
                ))}
              </AnimatePresence>
            </div>
            {waiting ? <Thinking wordless={acting} /> : null}
            {script.answer ? (
              <div className="space-y-3">
                <div className="text-sm leading-relaxed text-foreground">
                  <MessageResponse isAnimating={script.phase === "answering"} parseIncompleteMarkdown={script.phase === "answering"} components={parts}>
                    {script.answer}
                  </MessageResponse>
                </div>
                {done && script.phase === "done" && cited.length ? <WebSources ids={cited} /> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </ConversationContent>
    </Conversation>
  );
}

/**
 * A link in the mock's reply. A page of the attached PDF is a chip in the file's tint that opens
 * it at that page; a web source is a chip with its site's name, whose card shows what it is
 * before the person leaves for it. Any other link is the real reply's.
 */
function CitedLink({ href, pdf, children }: { href?: string; pdf?: Attachment; children?: ReactNode }) {
  const [asking, setAsking] = useState(false);
  const page = href?.match(/^#page-(\d+)$/)?.[1];
  const cite = href?.match(/^#cite-(\d+)$/)?.[1];
  if (page) {
    const url = `${pdf?.url ?? SAMPLE_PDF_URL}#page=${page}`;
    return (
      <a href={url} target="_blank" rel="noreferrer" className={`${RECORD_CHIP} whitespace-nowrap transition-colors hover:bg-[color-mix(in_oklab,var(--tint)_28%,transparent)]`} style={recordChipStyle("var(--kind-file)")}>
          <FileText className="mr-1 inline size-3 -translate-y-px" />
          {children}
        </a>
    );
  }
  if (cite && WEB[cite]) {
    const source = WEB[cite];
    const host = new URL(source.url).hostname.replace(/^www\./, "");
    return (
      <InlineCitation>
        <InlineCitationCard openDelay={250} closeDelay={80}>
          <HoverCardTrigger asChild>
            <a
              href={source.url}
              rel="noreferrer"
              className={`${RECORD_CHIP} whitespace-nowrap transition-colors hover:bg-[color-mix(in_oklab,var(--tint)_28%,transparent)]`}
              style={recordChipStyle("var(--kind-web)")}
              onClick={(event) => {
                event.preventDefault();
                setAsking(true);
              }}
            >
              <Globe className="mr-1 inline size-3 -translate-y-px" />
              {host}
            </a>
          </HoverCardTrigger>
          <HoverCardContent side="left" align="start" className="w-80 p-4">
            <InlineCitationSource title={source.title} url={host} description={source.description} />
          </HoverCardContent>
        </InlineCitationCard>
        <LinkSafetyDialog
          isOpen={asking}
          url={source.url}
          onClose={() => setAsking(false)}
          onConfirm={() => {
            window.open(source.url, "_blank", "noreferrer");
            setAsking(false);
          }}
        />
      </InlineCitation>
    );
  }
  return <ReplyLink href={href}>{children}</ReplyLink>;
}

/** Under a reply that searched the web: the sources it cites, folded to a count. */
function WebSources({ ids }: { ids: readonly string[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <Sources className="mb-0 text-muted-foreground">
        <SourcesTrigger count={ids.length} className="group h-7 rounded-full px-2 -ml-2 text-xs font-medium hover:bg-muted hover:text-foreground">
          <Globe className="size-3.5" style={{ color: "var(--kind-web)" }} />
          <span>{ids.length} web sources</span>
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
        </SourcesTrigger>
        <SourcesContent className="w-full gap-1 pt-1">
          {ids.map((id) => {
            const source = WEB[id];
            const host = new URL(source.url).hostname.replace(/^www\./, "");
            return (
              <a key={id} href={source.url} target="_blank" rel="noreferrer" className="flex h-11 items-center gap-2.5 rounded-xl px-2 hover:bg-muted/60">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: "color-mix(in oklab, var(--kind-web) 16%, transparent)", color: "var(--kind-web)" }}>
                  <Globe className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">{source.title}</span>
                  <span className="block truncate text-2xs">{host}</span>
                </span>
              </a>
            );
          })}
        </SourcesContent>
      </Sources>
    </motion.div>
  );
}

let shrinker: Worker | null = null;
const shrinking = new Map<string, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>();

/** Shrinks an image the way the composer will before uploading, in ./shrink.worker.ts so no frame is lost while the tray opens. */
function startShrinker() {
  shrinker ??= Object.assign(new Worker(new URL("./shrink.worker.ts", import.meta.url)), {
    onmessage: (event: MessageEvent<{ id: string; blob?: Blob; error?: true }>) => {
      const waiting = shrinking.get(event.data.id);
      shrinking.delete(event.data.id);
      if (event.data.blob) waiting?.resolve(event.data.blob);
      else waiting?.reject(new Error("shrink"));
    },
  });
  return shrinker;
}

function shrink(file: File) {
  startShrinker();
  const id = `${Date.now()}-${Math.random()}`;
  return new Promise<Blob>((resolve, reject) => {
    shrinking.set(id, { resolve, reject });
    shrinker!.postMessage({ id, file });
  });
}

/** pdf.js, loaded once while the browser is idle, so counting a PDF's pages never costs a frame. */
let pdfjsLoad: Promise<typeof import("react-pdf")["pdfjs"]> | null = null;
export function loadPdfjs() {
  pdfjsLoad ??= import("react-pdf").then(({ pdfjs }) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs;
  });
  return pdfjsLoad;
}

/** A PDF's page count, read in the browser with the PDF viewer's pdf.js. */
async function countPages(file: File) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = doc.numPages;
  void doc.destroy();
  return pages;
}

/** Sample files for the mock's control: a figure drawn here, and a small real PDF. */
async function samples() {
  const canvas = document.createElement("canvas");
  canvas.width = 2000;
  canvas.height = 1333;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 2400, 1600);
  g.fillStyle = "#222";
  g.font = "bold 64px sans-serif";
  g.fillText("Loot box spending by problem gambling group", 120, 140);
  [180, 320, 560, 900].forEach((h, i) => {
    g.fillStyle = ["#9ab8e6", "#5f8fd6", "#2a6cc4", "#18478a"][i];
    g.fillRect(260 + i * 500, 1400 - h, 300, h);
  });
  const image = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
  const pdf = await fetch("/sample-zendle-cairns-2018.pdf.zip").then((response) => (response.ok ? response.blob() : null), () => null);
  return [
    new File([image], "figure-2-screenshot.png", { type: "image/png" }),
    ...(pdf ? [new File([pdf], "zendle-cairns-2018-loot-boxes.pdf", { type: "application/pdf" })] : []),
  ];
}

/** The mock's own controls, outside the panel. */
function Controls({
  model,
  setModel,
  limited,
  onLimited,
  onSamples,
  onHuge,
  onForget,
  onReplay,
}: {
  model: PickedModel;
  setModel: (model: PickedModel) => void;
  limited: boolean;
  onLimited: () => void;
  onSamples: () => void;
  onHuge: () => void;
  onForget: () => void;
  onReplay: () => void;
}) {
  const button = "h-8 whitespace-nowrap rounded-full px-3 text-xs font-medium text-foreground/80 hover:bg-muted hover:text-foreground";
  return (
    <div className="fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-30rem)] flex-wrap items-center gap-1 rounded-2xl border border-border/70 bg-card p-1.5 shadow-lg">
      <span className="px-2 text-xs font-semibold text-muted-foreground">Mock</span>
      <Segmented
        label="Model"
        value={model.id === SONNET.id ? "sonnet" : "deepseek"}
        onChange={(id) => setModel(id === "sonnet" ? SONNET : DEEPSEEK)}
        options={[
          { id: "sonnet", label: "Sonnet 5.5" },
          { id: "deepseek", label: "DeepSeek V4 Pro" },
        ]}
      />
      <button type="button" className={button} onClick={onSamples}>
        Attach sample files
      </button>
      <button type="button" className={button} onClick={onHuge}>
        Attach a 148 MB PDF
      </button>
      <button type="button" className={button} onClick={onLimited}>
        {limited ? "Lift the upload limit" : "Reach the upload limit"}
      </button>
      <button type="button" className={button} onClick={onForget}>
        Ask every time again
      </button>
      <button type="button" className={button} onClick={onReplay}>
        Replay
      </button>
    </div>
  );
}
