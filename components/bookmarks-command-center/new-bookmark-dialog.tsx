"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { Field } from "@/components/evidence-libraries/configuration/section-card";
import { useKeywordExpansionDialogStore, useKeywordExpansionStore } from "@/lib/store";
import { useAppToast } from "@/lib/toast";

/**
 * The one way to add a bookmark: a bar button and a small dialog. With a
 * search in the search box, the dialog starts from it, so saving the current
 * search needs only a name.
 */
export function NewBookmarkDialog() {
  const toast = useAppToast();
  const tb = useTranslations("bookmarksPage");
  const tv = useTranslations("validation");
  const tc = useTranslations("common");
  const { keywords, addKeyword } = useKeywordExpansionStore();
  const { suggestedQuery } = useKeywordExpansionDialogStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [expansion, setExpansion] = useState("");

  const openDialog = () => {
    setName("");
    setExpansion(suggestedQuery);
    setOpen(true);
  };

  const nameError = (value: string) => {
    if (!value) return tb("nameCannotBeEmpty");
    if (!/^[a-zA-Z0-9-]+$/.test(value)) return tb("nameOnlyLettersNumbersDashes");
    if (keywords[value]) return tv("bookmarkNameExists", { name: value });
    return null;
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedExpansion = expansion.trim();
    const error = nameError(trimmedName) ?? (trimmedExpansion ? null : tv("expansionTextEmpty"));
    if (error) {
      toast.validation.failed(error);
      return;
    }
    addKeyword(trimmedName, trimmedExpansion);
    posthog.capture("bookmark_created", {
      bookmark_name: trimmedName,
      expansion_length: trimmedExpansion.length,
      has_boolean_operators: /\b(AND|OR|NOT)\b/.test(trimmedExpansion),
      total_bookmarks: Object.keys(keywords).length + 1,
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tb("addBookmark")}</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={add}>
            <Field label={tb("bookmarkName")} hint={tb("lettersNumbersDashes")}>
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={tb("bookmarkNamePlaceholder")}
                  autoFocus
                  required
                />
              )}
            </Field>
            <Field label={tb("expandsTo")} hint={tb("useInSearch")}>
              {(id) => (
                <Textarea
                  id={id}
                  value={expansion}
                  onChange={(event) => setExpansion(event.target.value)}
                  placeholder={tb("expandsToPlaceholder")}
                  className="min-h-24 font-mono text-sm"
                  required
                />
              )}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
              <Button type="submit" disabled={!name.trim() || !expansion.trim()}>
                <Plus />
                {tb("addBookmark")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
