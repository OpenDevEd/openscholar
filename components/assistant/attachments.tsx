"use client";

// Files attached to an assistant chat (#647): the attach button, the files waiting over the
// message box, the ones a sent message carried, and the upload itself. An image is shrunk in
// ./shrink.worker.ts before it's uploaded (lib/assistant/files.ts says to what), and counted
// against the person's plan (convex/assistant/files.ts).

import { createContext, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { Hourglass, ImageIcon, Paperclip, TriangleAlert, X } from "@/components/icons";
import { EASE } from "@/components/settings/model-map";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { digestOpaqueToken } from "@/convex/lib/opaqueTokenDigest";
import { MAX_FILES_PER_MESSAGE, MAX_IMAGE_BYTES, MAX_IMAGE_MB } from "@/lib/assistant/files";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { FadeRow } from "./parts";

/** A file in a draft: on its way up, in, or refused with the reason. */
export type Attachment = {
  key: string;
  fileId?: Id<"assistantFiles">;
  name: string;
  bytes: number;
  mediaType: string;
  /** The shrunk picture, as an address in this browser. */
  preview?: string;
  /** 0 to 1 while it uploads; 1 once it's in. */
  progress: number;
  error?: string;
};

/** A file a sent message carried, as the chat lists it: no address (null) once it expired, and an empty one while it's still on its way. */
export type SentFile = { id: string; name: string; bytes: number; mediaType: string; url: string | null };

export const isReady = (file: Attachment) => !file.error && file.fileId !== undefined && file.progress >= 1;

let shrinker: Worker | null = null;
const shrinking = new Map<string, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>();

/** The worker that shrinks images. Started while the browser is idle, so no frame is lost to it when a file arrives. */
export function startShrinker() {
  shrinker ??= Object.assign(new Worker(new URL("./shrink.worker.ts", import.meta.url)), {
    onmessage: (event: MessageEvent<{ id: string; blob?: Blob }>) => {
      const waiting = shrinking.get(event.data.id);
      shrinking.delete(event.data.id);
      if (event.data.blob) waiting?.resolve(event.data.blob);
      else waiting?.reject(new Error("shrink"));
    },
  });
  return shrinker;
}

function shrink(file: Blob) {
  const worker = startShrinker();
  const id = crypto.randomUUID();
  return new Promise<Blob>((resolve, reject) => {
    shrinking.set(id, { resolve, reject });
    worker.postMessage({ id, file });
  });
}

/** Posts a file's bytes to the upload route with its one-time token, telling how far it has got (convex/assistant/files.ts `upload`). */
function post(token: string, blob: Blob, onProgress: (share: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/assistant/upload?token=${encodeURIComponent(token)}`);
    request.setRequestHeader("Content-Type", blob.type);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    request.onload = () => {
      if (request.status < 300) return resolve();
      const said = (() => {
        try {
          return (JSON.parse(request.responseText) as { error?: string }).error;
        } catch {
          return undefined;
        }
      })();
      reject(new Error(said ?? `Upload failed (${request.status})`));
    };
    request.onerror = () => reject(new Error("Upload failed"));
    request.onabort = () => reject(new DOMException("Removed", "AbortError"));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(blob);
  });
}

/** A file once it's up: its ID, and how its message shows it. */
type Uploaded = { fileId: Id<"assistantFiles">; shown: SentFile };
/**
 * Each file's upload, by its key: it ends with the file, or null when it failed. Kept until the
 * message that carries it is sent or the file is removed (`release`), so a send that waits on it
 * finds it however long ago it finished.
 */
const jobs = new Map<string, { done: Promise<Uploaded | null>; stop: AbortController }>();
const shownOf = (file: Attachment): SentFile => ({ id: file.key, name: file.name, bytes: file.bytes, mediaType: file.mediaType, url: file.preview ?? "" });
/** These files once their uploads are done: the ones in, and the ones that failed on the way. Files refused before they started are neither. */
export async function uploaded(files: readonly Attachment[]) {
  const going = files.filter((file) => !file.error);
  const done = await Promise.all(going.map((file) => (isReady(file) ? { fileId: file.fileId!, shown: shownOf(file) } : (jobs.get(file.key)?.done ?? null))));
  return { done: done.filter((file): file is Uploaded => file !== null), failed: going.filter((_, i) => done[i] === null) };
}
/** Lets go of these files' uploads, once their message is sent or they're removed. */
export const release = (keys: readonly string[]) => keys.forEach((key) => jobs.delete(key));
/** Frees the pictures of files their message was sent with: the chat shows the server's copies by then. */
export const freePreviews = (files: readonly Attachment[]) => files.forEach((file) => file.preview && URL.revokeObjectURL(file.preview));
/** How a message shows files still on their way. */
export const sendingOf = (files: readonly Attachment[]) => files.filter((file) => !file.error).map((file) => shownOf(file));

/**
 * Takes the files a person picked, dropped or pasted: refuses at once the ones that can't go,
 * and uploads the rest. `add` puts each in the draft, `patch` changes it as its upload goes.
 */
export function useAttach(add: (files: Attachment[]) => void, patch: (key: string, change: Partial<Attachment>) => void) {
  const t = useTranslations("assistant.files");
  const startUpload = useMutation(api.assistant.files.startUpload);
  const remove = useMutation(api.assistant.files.remove);
  /** `attached`: files already going with the draft, which count towards what one message carries. */
  return (picked: readonly File[], attached: number) => {
    let room = MAX_FILES_PER_MESSAGE - attached;
    const files = picked.map((file): Attachment & { file: File } => {
      const base = { key: crypto.randomUUID(), name: file.name || t("pasted"), bytes: file.size, mediaType: file.type, progress: 0, file };
      if (!file.type.startsWith("image/")) return { ...base, error: t("onlyImages") };
      if (room <= 0) return { ...base, error: t("tooMany", { count: MAX_FILES_PER_MESSAGE }) };
      room -= 1;
      if (file.size > MAX_IMAGE_BYTES) return { ...base, error: t("tooLarge", { mb: MAX_IMAGE_MB }) };
      return base;
    });
    add(files.map(({ file: _file, ...attachment }) => attachment));
    for (const one of files) {
      if (one.error) continue;
      const stop = new AbortController();
      const done = (async (): Promise<Uploaded> => {
        // After the tray has opened, so shrinking costs none of its frames.
        await new Promise((resolve) => setTimeout(resolve, 350));
        const small = await shrink(one.file).catch(() => {
          throw new Error(t("unreadable"));
        });
        const preview = URL.createObjectURL(small);
        patch(one.key, { bytes: small.size, mediaType: small.type, preview });
        // The token stays in this browser; the server keeps its digest.
        const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
        const fileId = await startUpload({ name: one.name, digest: await digestOpaqueToken(token) });
        patch(one.key, { fileId });
        // Removed while its row was being made: the row goes too.
        if (stop.signal.aborted) {
          await remove({ fileId }).catch(() => {});
          throw new DOMException("Removed", "AbortError");
        }
        await post(token, small, (share) => patch(one.key, { progress: Math.min(share, 0.99) }), stop.signal);
        patch(one.key, { progress: 1 });
        return { fileId, shown: { id: one.key, name: one.name, bytes: small.size, mediaType: small.type, url: preview } };
      })().catch((error: unknown) => {
        if (!stop.signal.aborted) patch(one.key, { error: getErrorMessage(error, t("failed")) });
        return null;
      });
      jobs.set(one.key, { done, stop });
    }
  };
}

/** Lets go of a file in a draft: stops its upload, deletes it if it's in, and frees its picture in this browser. */
export function useRemove() {
  const remove = useMutation(api.assistant.files.remove);
  return (file: Attachment) => {
    jobs.get(file.key)?.stop.abort();
    release([file.key]);
    if (file.preview) URL.revokeObjectURL(file.preview);
    if (file.fileId) void remove({ fileId: file.fileId }).catch(() => {});
  };
}

/** Before the page chip: picks images. Off, with the reason, on a model that can't read them. */
export function AttachButton({ off, onPick }: { off: string | null; onPick: () => void }) {
  const t = useTranslations("assistant.files");
  return (
    <TooltipHint label={off ?? t("attach")}>
      {/* The span keeps the hint reachable while the button is off. */}
      <span className="flex shrink-0" tabIndex={off ? 0 : undefined}>
        <button
          type="button"
          aria-label={t("attach")}
          disabled={off !== null}
          onClick={onPick}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <Paperclip className="size-4" />
        </button>
      </span>
    </TooltipHint>
  );
}

/** The tray's height: a chip and the room over it. */
const TRAY_H = 64;

/** The files going with the message being written, over its text. Opens as the first arrives and closes after the last. */
export function Tray({ files, onRemove }: { files: readonly Attachment[]; onRemove: (file: Attachment) => void }) {
  return (
    <motion.div className="overflow-hidden" initial={false} animate={{ height: files.length ? TRAY_H : 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <FadeRow scrolls className="px-2 pt-2">
        <div className="flex h-14 w-max items-center gap-2 pr-2">
          <AnimatePresence initial={false} mode="popLayout">
            {files.map((file) => (
              <motion.div
                key={file.key}
                layout="position"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="shrink-0"
              >
                {file.error ? <Refused file={file} onRemove={() => onRemove(file)} /> : <ImageChip url={file.preview} name={file.name} progress={file.progress} onRemove={() => onRemove(file)} />}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </FadeRow>
    </motion.div>
  );
}

/** A thin ring that fills as a file uploads. */
function Ring({ progress }: { progress: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className="size-6 -rotate-90" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2.5} />
      <motion.circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - progress) }} transition={{ duration: 0.2 }} />
    </svg>
  );
}

function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  const t = useTranslations("assistant.files");
  return (
    <TooltipHint label={t("remove")}>
      <button
        type="button"
        aria-label={t("removeNamed", { name })}
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3" />
      </button>
    </TooltipHint>
  );
}

/** An image on its way: the picture itself once shrunk, with a ring over it while it uploads. */
function ImageChip({ url, name, progress, onRemove, compact }: { url?: string | null; name: string; progress: number; onRemove?: () => void; compact?: boolean }) {
  return (
    <div className={cn("group relative shrink-0 rounded-xl bg-muted/60", compact ? "size-11" : "size-12")}>
      {url ? <img src={url} alt={name} className="size-full rounded-xl object-cover ring-1 ring-inset ring-foreground/10" /> : null}
      <AnimatePresence>
        {progress < 1 ? (
          <motion.span key="ring" exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/35 text-white">
            <Ring progress={progress} />
          </motion.span>
        ) : null}
      </AnimatePresence>
      {onRemove ? <RemoveButton name={name} onRemove={onRemove} /> : null}
    </div>
  );
}

/** A file shown by its name with a line under it: one refused with why, or one that expired. */
function NamedChip({ icon, name, line, tone, onRemove, compact }: { icon: ReactNode; name: string; line: string; tone: "refused" | "expired"; onRemove?: () => void; compact?: boolean }) {
  return (
    <div className={cn("group relative flex items-center gap-2.5 rounded-xl pl-1.5 pr-2", compact ? "h-11 max-w-[15rem]" : "h-12 w-[13.5rem]", tone === "refused" ? "bg-destructive/[0.07] ring-1 ring-destructive/25" : "bg-muted/40")}>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tone === "refused" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <TooltipHint label={name} onlyWhenClipped>
          <p className={cn("truncate text-xs font-medium", tone === "expired" && "text-muted-foreground")}>{name}</p>
        </TooltipHint>
        <p className={cn("mt-0.5 truncate text-2xs", tone === "refused" ? "font-medium text-destructive" : "text-muted-foreground")}>{line}</p>
      </div>
      {onRemove ? <RemoveButton name={name} onRemove={onRemove} /> : null}
    </div>
  );
}

function Refused({ file, onRemove }: { file: Attachment; onRemove: () => void }) {
  return <NamedChip icon={<TriangleAlert className="size-4" />} name={file.name} line={file.error ?? ""} tone="refused" onRemove={onRemove} />;
}

/** Opens the file picker, for an expired file to be attached again; null where nothing can be attached. */
export const Reattach = createContext<(() => void) | null>(null);

/** The files a message carried, over its bubble and right-aligned with it. One that expired can be attached again. */
export function SentFiles({ files, onReattach }: { files: readonly SentFile[]; onReattach?: () => void }) {
  const t = useTranslations("assistant.files");
  if (!files.length) return null;
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {files.map((file) =>
        file.url !== null ? (
          <ImageChip key={file.id} url={file.url} name={file.name} progress={file.url ? 1 : 0} compact />
        ) : onReattach ? (
          <button key={file.id} type="button" onClick={onReattach} className="rounded-xl text-left transition-opacity hover:opacity-80">
            <NamedChip icon={<Hourglass className="size-4" />} name={file.name} line={t("expired")} tone="expired" compact />
          </button>
        ) : (
          <NamedChip key={file.id} icon={<Hourglass className="size-4" />} name={file.name} line={t("expired")} tone="expired" compact />
        ),
      )}
    </div>
  );
}

/** Over the panel while files are dragged over it. */
export function DropZone({ on, off }: { on: boolean; off: string | null }) {
  const t = useTranslations("assistant.files");
  const format = useFormatter();
  return (
    <AnimatePresence>
      {on ? (
        <motion.div
          key="drop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-card/90 text-center"
        >
          <span className={cn("flex size-12 items-center justify-center rounded-2xl", off ? "bg-amber-500/10 text-amber-600" : "bg-primary/10 text-primary")}>
            {off ? <TriangleAlert className="size-6" /> : <ImageIcon className="size-6" />}
          </span>
          <p className="max-w-[18rem] text-sm font-semibold">{off ?? t("drop")}</p>
          {off ? null : (
            <span className="flex h-6 items-center gap-1 rounded-md bg-foreground/[0.06] px-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground/90">{format.number(MAX_IMAGE_MB)} MB</span> {t("anImage")}
            </span>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
