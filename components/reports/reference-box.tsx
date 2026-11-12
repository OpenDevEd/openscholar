"use client";

// Where references are added to a report's details: pasted as a list, or uploaded or dropped as a BibTeX, RIS
// or plain text file. It hands the text on; what the text holds is read by lib/reports/reference-list.ts.

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { FileUp, Plus } from "@/components/icons";
import { cn } from "@/lib/utils";

/** The largest file read: a list of a thousand references is far under it. */
const MAX_BYTES = 2 * 1024 * 1024;

export function ReferenceBox({ onAdd, onTrouble }: { /** Given the text pasted or the file's; resolves once its references are in the list. */ onAdd: (text: string) => Promise<void>; onTrouble: (words: string) => void }) {
  const t = useTranslations("publishReports.details");
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = async (words: string, typed: boolean) => {
    if (!words.trim()) return;
    setBusy(true);
    try {
      await onAdd(words);
      if (typed) setText("");
    } finally {
      setBusy(false);
    }
  };
  const read = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) return onTrouble(t("referencesTooBig"));
    await add(await file.text(), false);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void read(e.dataTransfer.files[0]);
      }}
      className={cn("rounded-md border bg-field transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50", over ? "border-primary bg-primary/5" : "border-input")}
    >
      <Textarea
        aria-label={t("addReferences")}
        placeholder={t("referencesPlaceholder")}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="max-h-40 resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
      />
      <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} className="text-muted-foreground" onClick={() => input.current?.click()}>
          <FileUp /> {t("uploadReferences")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("referenceFormats")}</span>
        <Button type="button" variant="outline" size="sm" disabled={busy || !text.trim()} className="ms-auto" onClick={() => void add(text, true)}>
          {busy ? <Spinner /> : <Plus />} {t("add")}
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        aria-label={t("uploadReferencesLabel")}
        accept=".bib,.ris,.txt,text/plain,application/x-bibtex,application/x-research-info-systems"
        className="hidden"
        onChange={(e) => {
          void read(e.target.files?.[0]);
          // The same file can be chosen again after its references are removed.
          e.target.value = "";
        }}
      />
    </div>
  );
}
