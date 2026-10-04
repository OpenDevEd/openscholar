"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { BookmarkPlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation-browser";
import { shortcutNames } from "@/lib/query-shortcuts";
import { useKeywordExpansionStore } from "@/lib/store";
import { useAppToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Names a query so it can be reused: one field and a save button. The field
 * reads as the bookmark is typed in a search, the name then three periods, and
 * keeps to the characters a name may have.
 */
export function BookmarkForm({ query, onDone, className }: { query: string; onDone: () => void; className?: string }) {
  const toast = useAppToast();
  const tc = useTranslations("common");
  const th = useTranslations("historyPage");
  const tv = useTranslations("validation");
  const [name, setName] = useState("");
  const addKeyword = useKeywordExpansionStore((state) => state.addKeyword);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!name) return;
    // An account looks up the name, to say whether it's taken, and the shortcuts the query names.
    try {
      await useKeywordExpansionStore.getState().ensureShortcuts([name, ...shortcutNames(query)]);
    } catch {
      return;
    }
    if (useKeywordExpansionStore.getState().keywords[name]) {
      toast.validation.failed(tv("bookmarkNameExists", { name }));
      return;
    }
    addKeyword(name, validateAndExpandKeywordsSilently(query).expandedQuery);
    onDone();
  };

  return (
    <form onSubmit={save} className={cn("flex min-w-0 items-center gap-2", className)}>
      <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-field px-2.5 font-mono text-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <BookmarkPlus aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          aria-label={tc("saveAsBookmark")}
          placeholder={th("bookmarkNamePlaceholder")}
          value={name}
          onChange={(event) => setName(event.target.value.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Escape") onDone();
          }}
          autoFocus
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle-foreground"
        />
        <span aria-hidden className="text-muted-foreground">...</span>
      </label>
      <Button type="submit" size="sm" className="h-8" disabled={!name}>
        {tc("save")}
      </Button>
    </form>
  );
}
