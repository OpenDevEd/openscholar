"use client";

// @ in the composer points at one thing in your account, precisely. It isn't a way
// to give the assistant access: it can already reach everything you can. Picking a
// record writes "@name" into the message, highlighted, and the sent message shows it
// as a chip.

import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { KindTile } from "./run-map";
import { KIND, MENTIONABLE, type Mentionable } from "./data";

// Longest first, so a label that contains another still matches whole.
const LABELS = [...MENTIONABLE].sort((a, b) => b.label.length - a.label.length);
const PATTERN = new RegExp(`@(${LABELS.map((m) => m.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");

/** Splits text into plain runs and the records it points at. */
export function segments(text: string): Array<string | Mentionable> {
  const out: Array<string | Mentionable> = [];
  let at = 0;
  for (const match of text.matchAll(PATTERN)) {
    if (match.index > at) out.push(text.slice(at, match.index));
    out.push(MENTIONABLE.find((m) => m.label === match[1])!);
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** A sent message, with each @ shown as a chip in its record's tint. */
export function MessageText({ text }: { text: string }) {
  return (
    <>
      {segments(text).map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <MentionChip key={i} mention={part} />
        ),
      )}
    </>
  );
}

function MentionChip({ mention }: { mention: Mentionable }) {
  const { icon: Icon, tint } = KIND[mention.kind]!;
  return (
    // Inline, not a box, so a long name wraps with the sentence and each line keeps its tint.
    <span
      className="mx-px rounded-md px-1 py-0.5 font-medium [box-decoration-break:clone]"
      style={{ backgroundColor: `color-mix(in oklab, ${tint} 16%, transparent)`, color: tint }}
    >
      <Icon className="mr-1 inline size-3 -translate-y-px" />
      {mention.label}
    </span>
  );
}

/** Where an @ being typed starts, and what follows it, when the caret sits inside one. */
function openMention(text: string, caret: number) {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]!))) return null;
  const query = before.slice(at + 1);
  // A finished mention, or a newline, ends it.
  if (query.includes("\n") || segments(before.slice(at)).some((p) => typeof p !== "string")) return null;
  return { start: at, query };
}

/**
 * The message box. A layer behind the textarea draws the same text with each @ tinted,
 * so mentions stand out while it stays a plain textarea. Typing @ opens the picker.
 */
export function MentionComposer({
  composer,
  draft,
  setDraft,
  onSend,
  placeholder,
}: {
  composer: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  placeholder: string;
}) {
  const [menu, setMenu] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  // The @ the picker was closed on with Escape; it stays closed until you type another.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const q = menu?.query.trim().toLowerCase() ?? "";
  const options = menu ? MENTIONABLE.filter((m) => !q || m.label.toLowerCase().includes(q) || m.detail.toLowerCase().includes(q)).slice(0, 6) : [];

  const track = (text: string, caret: number) => {
    const found = openMention(text, caret);
    const next = found && found.start !== dismissed ? found : null;
    if (!found) setDismissed(null);
    setMenu(next);
    if (next?.query !== menu?.query) setActive(0);
  };
  const choose = (m: Mentionable) => {
    const box = composer.current;
    if (!menu || !box) return;
    const caret = box.selectionStart;
    const text = `${draft.slice(0, menu.start)}@${m.label} ${draft.slice(caret)}`;
    const end = menu.start + m.label.length + 2;
    setDraft(text);
    setMenu(null);
    // The caret goes after the mention once the new text is in the box.
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(end, end);
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu && options.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(options[active]!);
        return;
      }
    }
    if (menu && e.key === "Escape") {
      // The picker takes this Escape, so it doesn't also close a sheet.
      e.preventDefault();
      e.stopPropagation();
      setDismissed(menu.start);
      setMenu(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="relative">
      <AnimatePresence>
        {menu ? (
          <motion.div
            key="menu"
            role="listbox"
            aria-label="Point at something"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}
            style={{ transformOrigin: "50% 100%" }}
            className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-2xl border border-border/60 bg-popover p-1.5 shadow-[0_18px_50px_-18px_rgb(0_0_0/0.45)]"
          >
            {options.length ? (
              options.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  // Keeps focus in the message box, so typing carries on after a pick.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(m)}
                  className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left", i === active && "bg-muted")}
                >
                  <KindTile kind={m.kind} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{m.detail}</span>
                </button>
              ))
            ) : (
              <p className="px-2.5 py-2 text-sm text-muted-foreground">Nothing in your account matches “{menu.query}”</p>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="relative">
        {/* Same box, font and wrapping as the textarea, so each highlight sits under its text. */}
        <div
          ref={mirror}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 pt-3 text-sm text-transparent"
        >
          {segments(draft).map((part, i) =>
            typeof part === "string" ? (
              part
            ) : (
              <mark
                key={i}
                className="rounded-[4px] text-transparent"
                style={{
                  backgroundColor: `color-mix(in oklab, ${KIND[part.kind]!.tint} 22%, transparent)`,
                  boxShadow: `0 0 0 2px color-mix(in oklab, ${KIND[part.kind]!.tint} 22%, transparent)`,
                }}
              >
                @{part.label}
              </mark>
            ),
          )}
        </div>
        <textarea
          ref={composer}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            track(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => track(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setMenu(null)}
          onScroll={(e) => {
            if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={placeholder}
          aria-label="Message the assistant"
          className="relative block w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}
