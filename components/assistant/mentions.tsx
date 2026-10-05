"use client";

// @ in the composer points at one thing in the person's account, precisely (#327). It isn't a
// way to give the assistant access: it can already reach everything they can. Picking a record
// writes "@name" into the message, highlighted, and the sent message shows it as a chip.

import { useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { draftSegments, mentionSegments, openMention, uniqueLabel, type Mention } from "@/lib/assistant/mentions";
import { cn } from "@/lib/utils";
import { KIND, KindTile } from "./steps";

type Found = FunctionReturnType<typeof api.assistant.mentions.find>[number];
/** The picker shows this many, as the mock does. */
const SHOWN = 6;

/** A sent message, with each @ shown as a chip in its record's tint. */
export function MessageText({ text }: { text: string }) {
  return (
    <>
      {mentionSegments(text).map((part, i) => (typeof part === "string" ? part : <MentionChip key={i} mention={part} />))}
    </>
  );
}

function MentionChip({ mention }: { mention: Mention }) {
  const { icon: Icon, tint } = KIND[mention.kind];
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

/**
 * The message box. A layer behind the textarea draws the same text with each @ tinted, so
 * mentions stand out while it stays a plain textarea. Typing @ opens the picker over the
 * person's searches, collections and saved papers.
 */
export function MentionComposer({
  composer,
  draft,
  setDraft,
  picked,
  onPick,
  onSend,
  onFocusChange,
  disabled,
  placeholder,
}: {
  composer: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (text: string) => void;
  /** Records picked in this chat's draft; each still written as "@name" is a mention. */
  picked: readonly Mention[];
  onPick: (mention: Mention) => void;
  onSend: () => void;
  onFocusChange: (focused: boolean) => void;
  disabled: boolean;
  placeholder: string;
}) {
  const t = useTranslations("assistant");
  const [menu, setMenu] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  // The @ the picker was closed on with Escape; it stays closed until another is typed.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const mirror = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Read while the box has focus, so the list is there the moment @ is typed.
  const asked = menu?.query.trim() ?? "";
  const found = useQuery(api.assistant.mentions.find, focused && !disabled ? { text: asked } : "skip");
  // What the last answer found stays up, dimmed and inert, while the next one loads, so the list doesn't empty between keys.
  const [kept, setKept] = useState<{ text: string; found: Found[] } | null>(null);
  if (found !== undefined && (found !== kept?.found || asked !== kept.text)) setKept({ text: asked, found });
  // Until the answer for what's typed arrives, the first one included, nothing can be picked.
  const stale = menu !== null && kept?.text !== asked;
  const options = menu && kept ? kept.found.slice(0, SHOWN) : [];

  const track = (text: string, caret: number) => {
    const open = openMention(text, caret, picked);
    const next = open && open.start !== dismissed ? open : null;
    if (!open) setDismissed(null);
    setMenu(next);
    if (next?.query !== menu?.query) setActive(0);
  };
  const choose = (found: Found) => {
    const box = composer.current;
    if (!menu || !box) return;
    const record = { kind: found.kind, id: found.id, label: found.label.replace(/\s+/g, " ").trim() };
    // Each name in a draft stands for one record: a second record of the same name is told apart by its kind.
    const mention = { ...record, label: uniqueLabel(record, t(`mentions.kinds.${found.kind}`), picked) };
    // The whole name being typed goes, the part after the caret too.
    const tail = draft.slice(box.selectionEnd);
    const rest = tail.slice(/^\S*/.exec(tail)![0].length);
    const text = `${draft.slice(0, menu.start)}@${mention.label}${rest.startsWith(" ") ? "" : " "}${rest}`;
    const end = menu.start + mention.label.length + 2;
    onPick(mention);
    setDraft(text);
    setMenu(null);
    // The caret goes after the mention once the new text is in the box.
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(end, end);
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keys that pick a candidate in an input method are its own.
    if (e.nativeEvent.isComposing) return;
    if (menu && options.length && !stale) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(options[Math.min(active, options.length - 1)]!);
        return;
      }
    }
    if (menu && e.key === "Escape") {
      // The picker takes this Escape, so it doesn't also fold the panel.
      e.preventDefault();
      e.stopPropagation();
      setDismissed(menu.start);
      setMenu(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Enter while the list is catching up to what was typed picks nothing and sends nothing.
      if (!(menu && stale)) onSend();
    }
  };
  const detail = (found: Found) =>
    found.kind === "paper" ? t("mentions.paper") : t(found.kind === "search" ? "mentions.search" : "mentions.collection", { count: found.count ?? 0 });

  return (
    <div className="relative">
      <AnimatePresence>
        {/* Up once the first answer is in, so it never opens empty. */}
        {menu && kept ? (
          <motion.div
            key="menu"
            id={listId}
            role="listbox"
            aria-label={t("mentions.label")}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}
            style={{ transformOrigin: "50% 100%" }}
            className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-2xl border border-border/60 bg-popover p-1.5 shadow-[0_18px_50px_-18px_rgb(0_0_0/0.45)]"
          >
            {options.length ? (
              options.map((option, i) => (
                <button
                  key={`${option.kind}:${option.id}`}
                  id={`${listId}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  // Keeps focus in the message box, so typing carries on after a pick.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(option)}
                  disabled={stale}
                  className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-opacity", i === active && "bg-muted", stale && "opacity-50")}
                >
                  <KindTile kind={option.kind} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{option.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{detail(option)}</span>
                </button>
              ))
            ) : (
              <p className="px-2.5 py-2 text-sm text-muted-foreground">{t("mentions.none", { query: kept.text })}</p>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="relative">
        {/* Same box, font and wrapping as the textarea, so each highlight sits under its text. */}
        <div ref={mirror} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 pt-3 text-sm text-transparent">
          {draftSegments(draft, picked).map((part, i) =>
            typeof part === "string" ? (
              part
            ) : (
              <mark
                key={i}
                className="rounded-[4px] text-transparent"
                style={{
                  backgroundColor: `color-mix(in oklab, ${KIND[part.kind].tint} 22%, transparent)`,
                  boxShadow: `0 0 0 2px color-mix(in oklab, ${KIND[part.kind].tint} 22%, transparent)`,
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
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            track(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => track(e.currentTarget.value, e.currentTarget.selectionStart)}
          onFocus={() => {
            setFocused(true);
            onFocusChange(true);
          }}
          onBlur={() => {
            setFocused(false);
            setMenu(null);
            onFocusChange(false);
          }}
          onScroll={(e) => {
            if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={placeholder}
          aria-label={t("messageLabel")}
          // Focus stays in the box while the picker is open: these say which option the arrow keys are on.
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={menu && kept ? listId : undefined}
          aria-activedescendant={menu && options.length && !stale ? `${listId}-${Math.min(active, options.length - 1)}` : undefined}
          className="relative block w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}
