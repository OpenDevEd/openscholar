"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { BookmarkPlus, CircleAlert, Plus, TriangleAlert } from "@/components/icons";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { getIdColor } from "@/lib/format";
import { savedShortcutName, shortcutPieces, typedShortcutName } from "@/lib/query-shortcuts";
import { useQueryShortcuts } from "@/lib/research/reads";
import { useResearchStatus } from "@/lib/research/provider";
import { useAppToast } from "@/lib/toast";
import { useKeywordExpansionDialogStore, useKeywordExpansionStore } from "@/lib/store";
import { useShortcutCount } from "@/lib/research/shortcut-list";
import { cn } from "@/lib/utils";

// The parts of a query's own text that read differently: a quoted phrase, an operator, a bracket.
const SYNTAX = /("[^"]*"?)|\b(AND|OR|NOT)\b|([()])/gi;
// The text and its coloured copy share these, so every character lines up.
const QUERY_TEXT = "whitespace-pre-wrap px-3 pb-3 pt-7 font-mono text-sm leading-6 [overflow-wrap:anywhere] [scrollbar-gutter:stable]";

/** A bookmark's part of a query, in the colour its name gives it. `outlined` suits a short name, not lines of text. */
function Tinted({ name, outlined = false, children }: { name: string; outlined?: boolean; children: ReactNode }) {
  const color = getIdColor(name);
  return (
    <span className="rounded-[3px] box-decoration-clone" style={{ backgroundColor: color.bg, color: color.text, boxShadow: outlined ? `0 0 0 1px ${color.border}` : undefined }}>
      {children}
    </span>
  );
}

/** Query text between bookmarks, with its phrases, operators and brackets told apart. */
function Syntax({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const part of text.matchAll(SYNTAX)) {
    out.push(
      text.slice(at, part.index),
      <span key={part.index} className={part[1] ? "text-foreground" : part[2] ? "text-primary dark:text-muted-foreground" : "text-subtle-foreground"}>{part[0]}</span>,
    );
    at = part.index + part[0].length;
  }
  out.push(text.slice(at));
  return out;
}

/** A bookmark the query names that doesn't exist. */
function Missing({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span role="img" aria-label={label} className="tint-warning rounded-[3px] box-decoration-clone underline decoration-wavy decoration-1 underline-offset-4">
      {children}
    </span>
  );
}

/**
 * The one way to add a bookmark: a bar button and a dialog. With a search in
 * the search box, the dialog starts from it, so saving the current search
 * needs only a name.
 */
export function NewBookmarkDialog() {
  const toast = useAppToast();
  const tToast = useTranslations("toast");
  const tb = useTranslations("bookmarksPage");
  const th = useTranslations("historyPage");
  const tv = useTranslations("validation");
  const tc = useTranslations("common");
  const addKeyword = useKeywordExpansionStore((state) => state.addKeyword);
  const { ready } = useResearchStatus();
  const keywords = useKeywordExpansionStore((state) => state.keywords);
  const count = useShortcutCount();
  const { suggestedQuery } = useKeywordExpansionDialogStore();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [expansion, setExpansion] = useState("");
  const colored = useRef<HTMLDivElement>(null);

  const name = savedShortcutName(typed);
  const query = expansion.trim();
  // An account looks up this name, and the bookmarks the query reuses, as they are typed.
  const nameKnown = useQueryShortcuts(name ? `${name}...` : null);
  const known = useQueryShortcuts(expansion);
  // What a saved bookmark stands for. Only one the person saved: not `constructor` and the like.
  const saved = (shortcut: string) => (Object.prototype.hasOwnProperty.call(keywords, shortcut) ? keywords[shortcut]?.expansion : undefined);
  const taken = Boolean(name && nameKnown && saved(name) !== undefined);
  const color = name ? getIdColor(name) : null;
  // The query split where a search will: at the bookmarks it names, also inside a phrase.
  const pieces = shortcutPieces(expansion);
  const reuses = pieces.some((piece) => piece.shortcut);

  const openDialog = () => {
    setTyped("");
    setExpansion(suggestedQuery);
    setOpen(true);
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !name || !query || taken) return;
    // An account looks the name up once more, in case it was taken since it was typed.
    try {
      await useKeywordExpansionStore.getState().ensureShortcuts([name]);
    } catch {
      return;
    }
    if (useKeywordExpansionStore.getState().addKeyword !== addKeyword) {
      toast.validation.failed(tToast("accountChanged"));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(useKeywordExpansionStore.getState().keywords, name)) return;
    addKeyword(name, query);
    posthog.capture("bookmark_created", {
      bookmark_name: name,
      expansion_length: query.length,
      has_boolean_operators: /\b(AND|OR|NOT)\b/.test(query),
      total_bookmarks: (count ?? 0) + 1,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? openDialog() : setOpen(false))}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!ready} className={BAR_ACTION}>
          <Plus />
          <span className={BAR_LABEL}>{tb("addBookmark")}</span>
        </Button>
      </DialogTrigger>
        {/* Held at the top, so it grows downwards as the query does and nothing above the caret moves. */}
        <DialogContent className="top-[10dvh] max-h-[calc(90dvh-1rem)] translate-y-0 gap-0 p-0 sm:max-w-2xl" aria-describedby={undefined}>
          {/* min-w-0: a long name must not widen the dialog. */}
          <form onSubmit={add} className="min-w-0">
            <div className="space-y-4 p-6">
              <DialogTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <BookmarkPlus aria-hidden className="size-4" />
                {tb("addBookmark")}
              </DialogTitle>

              <div>
                {/* The bookmark as it is typed in a search, in the colour its name gives it everywhere. It
                    sits on the edge of the query it stands for, and hides the edge behind it: its upper half
                    is over the dialog and its lower half over the field, so it takes each one's colour. */}
                <div className="relative z-10 -mb-5 ml-3 flex w-fit max-w-[calc(100%-1.5rem)] items-center bg-[linear-gradient(to_bottom,var(--background)_50%,var(--field)_50%)] pr-2 font-mono text-xl font-semibold">
                  <input
                    aria-label={tb("bookmarkName")}
                    aria-invalid={taken}
                    placeholder={th("bookmarkNamePlaceholder")}
                    value={typed}
                    onChange={(event) => setTyped(typedShortcutName(event.target.value))}
                    // As wide as the name; a monospace font makes that exact.
                    size={typed.length || th("bookmarkNamePlaceholder").length}
                    autoFocus
                    spellCheck={false}
                    autoComplete="off"
                    className={cn(
                      "h-10 min-w-0 rounded-lg border px-2.5 outline-none transition-colors placeholder:font-medium placeholder:text-subtle-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:ring-[3px] aria-invalid:ring-destructive/40",
                      !color && "border-dashed border-input bg-field",
                    )}
                    style={color ? { backgroundColor: color.bg, color: color.text, borderColor: color.border } : undefined}
                  />
                  <span aria-hidden className="shrink-0 pl-1.5 text-subtle-foreground">...</span>
                  {taken && (
                    <span role="alert" className="ml-3 flex shrink-0 items-center gap-1.5 font-sans text-xs font-medium ink-destructive">
                      <CircleAlert aria-hidden className="size-3.5" />
                      {tv("bookmarkNameExists", { name })}
                    </span>
                  )}
                </div>

                {/* The query. Its coloured copy lies under the text being typed, which is itself see-through. */}
                <div className="relative overflow-hidden rounded-xl border border-input bg-field transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                  <div ref={colored} aria-hidden className={cn(QUERY_TEXT, "pointer-events-none absolute inset-0 overflow-hidden")}>
                    {pieces.map((piece, key) =>
                      !piece.shortcut ? (
                        <Syntax key={key} text={piece.text} />
                      ) : known && saved(piece.shortcut) === undefined ? (
                        <Missing key={key} label={tv("bookmarkNotFound", { keyword: piece.shortcut })}>{piece.text}</Missing>
                      ) : (
                        <Tinted key={key} name={piece.shortcut} outlined>{piece.text}</Tinted>
                      ),
                    )}
                    {"\n"}
                  </div>
                  <textarea
                    aria-label={tb("expandsTo")}
                    value={expansion}
                    onChange={(event) => setExpansion(event.target.value)}
                    onScroll={(event) => {
                      if (colored.current) colored.current.scrollTop = event.currentTarget.scrollTop;
                    }}
                    placeholder={tb("expandsToPlaceholder")}
                    spellCheck={false}
                    className={cn(
                      QUERY_TEXT,
                      // Selected text is drawn by the field itself, as the selection covers the coloured copy.
                      "relative block max-h-[36dvh] min-h-36 w-full resize-none overflow-y-auto bg-transparent text-transparent caret-foreground outline-none field-sizing-content placeholder:text-subtle-foreground selection:bg-primary/25 selection:text-foreground",
                    )}
                  />
                </div>
              </div>

              {/* The query as a search runs it: each bookmark it names, replaced by what it stands for. It
                  keeps one height from the moment a bookmark is named, so a lookup that returns moves nothing. */}
              {reuses && (
                <div className="fade-enter space-y-1.5">
                  <p className="pl-1 text-xs font-medium text-muted-foreground">{tb("expandsTo")}</p>
                  <p className="h-36 overflow-y-auto whitespace-pre-wrap rounded-xl bg-inset p-3 font-mono text-xs leading-6 [overflow-wrap:anywhere]">
                    {pieces.map((piece, key) => {
                      if (!piece.shortcut) return piece.text;
                      const stands = saved(piece.shortcut);
                      if (stands) return <Tinted key={key} name={piece.shortcut}>{stands}</Tinted>;
                      if (!known) return piece.text;
                      return (
                        <Missing key={key} label={tv("bookmarkNotFound", { keyword: piece.shortcut })}>
                          <TriangleAlert aria-hidden className="mr-1 inline size-3.5 align-[-0.2em]" />
                          {piece.text}
                        </Missing>
                      );
                    })}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border-subtle p-4">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
              <Button type="submit" disabled={!ready || !name || !query || taken}>
                <Plus />
                {tb("addBookmark")}
              </Button>
            </div>
          </form>
        </DialogContent>
    </Dialog>
  );
}
