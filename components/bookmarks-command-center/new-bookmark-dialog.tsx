"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { BookmarkPlus, BookmarksIcon, Plus, TriangleAlert } from "@/components/icons";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { EntryTile } from "@/components/command-center/entry";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { FieldError } from "@/components/evidence-libraries/configuration/section-card";
import { getIdColor } from "@/lib/format";
import { savedShortcutName, shortcutNames, typedShortcutName } from "@/lib/query-shortcuts";
import { useQueryShortcuts } from "@/lib/research/reads";
import { useKeywordExpansionDialogStore, useKeywordExpansionStore } from "@/lib/store";
import { useShortcutCount } from "@/lib/research/shortcut-list";
import { cn } from "@/lib/utils";

/**
 * The one way to add a bookmark: a bar button and a dialog. With a search in
 * the search box, the dialog starts from it, so saving the current search
 * needs only a name.
 */
export function NewBookmarkDialog() {
  const tb = useTranslations("bookmarksPage");
  const th = useTranslations("historyPage");
  const tv = useTranslations("validation");
  const tc = useTranslations("common");
  const addKeyword = useKeywordExpansionStore((state) => state.addKeyword);
  const keywords = useKeywordExpansionStore((state) => state.keywords);
  const count = useShortcutCount();
  const { suggestedQuery } = useKeywordExpansionDialogStore();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [expansion, setExpansion] = useState("");

  const name = savedShortcutName(typed);
  const query = expansion.trim();
  // The bookmarks the query reuses, and this name: an account looks them up as they are typed.
  const used = shortcutNames(expansion);
  const known = useQueryShortcuts(expansion, name ? `${name}...` : null);
  const taken = Boolean(name && known && keywords[name]);
  const color = name ? getIdColor(name) : null;

  const openDialog = () => {
    setTyped("");
    setExpansion(suggestedQuery);
    setOpen(true);
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!name || !query || taken) return;
    // An account looks the name up once more, in case it was taken since it was typed.
    try {
      await useKeywordExpansionStore.getState().ensureShortcuts([name]);
    } catch {
      return;
    }
    if (useKeywordExpansionStore.getState().keywords[name]) return;
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
    <>
      <Button size="sm" className={BAR_ACTION} onClick={openDialog}>
        <Plus />
        <span className={BAR_LABEL}>{tb("addBookmark")}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 p-0 sm:max-w-xl" aria-describedby={undefined}>
          <form onSubmit={add}>
            {/* The bookmark as it is typed in a search, in the colour its name gives it everywhere. */}
            <div className="space-y-4 border-b border-border-subtle bg-inset p-6">
              <DialogTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <BookmarkPlus aria-hidden className="size-4" />
                {tb("addBookmark")}
              </DialogTitle>
              <div className="flex items-center font-mono text-2xl font-semibold">
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
                    "h-12 min-w-0 max-w-full rounded-xl border px-3 outline-none transition-colors placeholder:font-medium placeholder:text-subtle-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:ring-[3px] aria-invalid:ring-destructive/40",
                    !color && "border-dashed border-input bg-field",
                  )}
                  style={color ? { backgroundColor: color.bg, color: color.text, borderColor: color.border } : undefined}
                />
                <span aria-hidden className="shrink-0 pl-1.5 text-subtle-foreground">...</span>
              </div>
              {taken && <FieldError>{tv("bookmarkNameExists", { name })}</FieldError>}
            </div>

            <div className="space-y-3 p-6">
              <Textarea
                aria-label={tb("expandsTo")}
                value={expansion}
                onChange={(event) => setExpansion(event.target.value)}
                placeholder={tb("expandsToPlaceholder")}
                spellCheck={false}
                className="max-h-[40dvh] min-h-32 font-mono text-sm"
              />
              {/* The bookmarks the query reuses; one that doesn't exist is marked. */}
              {used.length > 0 && (
                <ul className="flex flex-wrap items-center gap-1.5">
                  <BookmarksIcon aria-hidden className="size-3.5 text-muted-foreground" />
                  {used.map((shortcut) => {
                    const missing = known && !keywords[shortcut];
                    return (
                      <li key={shortcut}>
                        {missing ? (
                          <span
                            role="img"
                            aria-label={tv("bookmarkNotFound", { keyword: shortcut })}
                            className="tint-warning flex h-6 items-center gap-1.5 rounded-md border border-dashed px-2 font-mono text-xs font-medium"
                          >
                            <TriangleAlert aria-hidden className="size-3.5" />
                            {shortcut}
                          </span>
                        ) : (
                          <EntryTile id={shortcut} className="h-6 rounded-md font-mono font-medium">{shortcut}</EntryTile>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border-subtle p-4">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
              <Button type="submit" disabled={!name || !query || taken}>
                <Plus />
                {tb("addBookmark")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
