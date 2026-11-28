"use client";

// The places a screening's papers come from that take more than a list to pick from: files and PDFs a
// person hands over, pasted DOIs, a Zotero library or one of its collections, and a community. Each
// hands the form what it adds as a source: the thing the server reads (`set`), under a name, with how
// many papers it holds.

import { useId, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, ChevronRight, ChevronsUpDown, Coins, FileSpreadsheet, FileText, FileX, Folder, Hash, Library, Plus, Trash2, TriangleAlert, Upload, UserRound, Users, X, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { ListRowsSkeleton, ListSearch } from "@/components/evidence-libraries/list-controls";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
import { LibrarySources, useLibrarySources, useRowLabel } from "./library-sources";
import { Chip, Meter, RequiredMark } from "./parts";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AutoHeight } from "@/components/ui/auto-height";
import { FadeRow } from "@/components/ui/fade-row";
import { HelpFact } from "@/components/ui/help";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { rowKey, setOfRow, type LibraryRow } from "@/lib/evidence-libraries/reader-sources";
import { MAX_PDF_BYTES, MAX_PDF_MB } from "@/lib/files/limits";
import { COLUMN_KEYS, FILE_MAX_BYTES, REFERENCES, doisIn, readTable, tableCounts, type ColumnKey, type TableRead } from "@/lib/screening/files";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace as usePageWorkspace, useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { useCursorPage, useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { parseAsArrayOf, parseAsBoolean, parseAsString, useQueryStates } from "nuqs";
import { searchHistory } from "./address";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { hash, type Source, type SourceSet } from "./data";
import { Help, INLINE_LINK, StateChip, SEARCH_PILL } from "./pieces";
import { useWords } from "./words";

const PAGE = 5;
/** A row's height with its line: a list keeps its page's height on a last page that holds fewer. */
const ROW = 57;

/** What a tab hands the form to add as a source: what the server reads, under the name its list gave it, with how many papers it holds and what tells it from another of the same name. */
export type Added = { ref: string; name: string; detail: string; total: number; set: SourceSet; filters?: string[]; untitled?: boolean };
type Offer = Pick<Added, "name" | "detail" | "total" | "filters">;

export function OfferRow({ offer, label, icon: Icon, chips, trail, added, onAdd, onOpen, count = true }: {
  offer: Offer;
  /** Its name as it is drawn, where that is more than the text: a search's query with its terms marked, or "No query". */
  label?: ReactNode;
  icon: AppIcon;
  /** What else tells this row from the others, after its detail. */
  chips?: ReactNode;
  /** What goes under its name in place of its detail: where it sits, as steps that lead back up, or a search's filters. */
  trail?: ReactNode;
  added: boolean;
  onAdd: () => void;
  /** Where it holds more to pick from: its name is then the way in. */
  onOpen?: () => void;
  /** Whether how many papers it holds is known before it is read. Where it isn't, no count shows, and it can be added whatever the number says. */
  count?: boolean;
}) {
  const t = useTranslations("screening.sources");
  const words = useWords();
  const name = "truncate max-sm:line-clamp-2 max-sm:whitespace-normal";
  const second = Boolean(trail || offer.detail || offer.filters?.length || chips);
  return (
    <div className="flex min-h-14 items-center gap-x-3 gap-y-1.5 px-1 py-2.5 max-sm:flex-wrap">
      <div className="min-w-0 flex-1 max-sm:basis-full">
        {/* The icon is part of the name's line, so it sits on it whether or not a second line follows. */}
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-5 shrink-0 items-center"><Icon className="size-4 text-muted-foreground" /></span>
          {onOpen ? (
            <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-1 rounded text-start text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
              <span className={name}>{label ?? offer.name}</span>
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ) : (
            <p className={cn("min-w-0 text-sm font-medium", name)}>{label ?? offer.name}</p>
          )}
        </div>
        {trail ? (
          <div className="ps-7">{trail}</div>
        ) : second ? (
          <p className="flex min-w-0 flex-wrap items-center gap-1.5 ps-7 text-xs text-muted-foreground"><span className="truncate">{offer.detail}</span>{offer.filters?.map((filter) => <Chip key={filter} className="h-5 px-1.5 @max-xl:hidden">{filter}</Chip>)}{chips ? <span className="flex shrink-0 items-center gap-1.5">{chips}</span> : null}</p>
        ) : null}
      </div>
      {/* A row that says where it sits has that for its second line: what else it has to say stands where its count would. */}
      {count ? <Chip className="max-sm:ms-7">{words.count("papers", offer.total)}</Chip> : trail && chips ? <span className="flex shrink-0 items-center gap-1.5 max-sm:ms-7">{chips}</span> : null}
      {/* A search with no papers has nothing to add: its count says so, and no button stands there saying it again. Its room is kept, so the rows' buttons line up. */}
      {count && !offer.total && !added ? <span aria-hidden className="w-24 shrink-0 max-sm:hidden" /> : <Button variant="outline" size="sm" className="w-24 max-sm:ms-auto" disabled={added} onClick={onAdd}>{added ? <><Check />{t("added")}</> : <><Plus />{t("add")}</>}</Button>}
    </div>
  );
}

export type PendingTable = { name: string; /** What it reads, which tells two files of one name apart. */ ref: string; table: TableRead; picked: TableRead["picked"]; /** Add was pressed with no title column picked. */ untitled?: boolean };
const NONE = "-";

/** The row a table waits in until its columns are named. Under each choice is what the first record holds in that column, to check the pick against. */
export function ColumnMatch({ pending, onPick, onAdd, onRemove }: { pending: PendingTable; onPick: (key: ColumnKey, head: string | undefined) => void; onAdd: () => void; onRemove: () => void }) {
  const t = useTranslations("screening.sources");
  const id = useId();
  const { table, picked } = pending;
  const counts = tableCounts(table, picked);
  const first = table.rows[0] ?? {};
  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex min-h-9 items-center gap-3 max-sm:flex-wrap">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-foreground"><FileSpreadsheet className="size-4" /></span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium max-sm:basis-[calc(100%-3rem)]">{pending.name}</p>
        <StateChip tone="warning" icon={TriangleAlert}>{t("columns.needNaming")}</StateChip>
        <TooltipHint label={t("remove", { name: pending.name })}><Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground max-sm:ms-auto" aria-label={t("remove", { name: pending.name })} onClick={onRemove}><Trash2 /></Button></TooltipHint>
      </div>
      <div className="space-y-3 ps-12 max-sm:ps-0">
        <p className="text-xs text-muted-foreground">{t("columns.pickEach", { count: table.rows.length })}</p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
          {COLUMN_KEYS.map((key) => {
            const missing = key === "title" && pending.untitled && !picked.title;
            return (
              <div key={key} className="min-w-0 space-y-1">
                <label htmlFor={`${id}-${key}`} className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{t(`columns.label.${key}`)}{key === "title" ? <RequiredMark /> : null}</label>
                <Select value={picked[key] ?? (key === "title" ? "" : NONE)} onValueChange={(next) => onPick(key, next === NONE ? undefined : next)}>
                  <SelectTrigger id={`${id}-${key}`} size="sm" aria-invalid={missing || undefined} className="w-full min-w-0 rounded-full bg-card px-3.5 text-xs"><SelectValue placeholder={t("columns.pick")} /></SelectTrigger>
                  <SelectContent>
                    {key === "title" ? null : <SelectItem value={NONE}>{t("columns.notInFile")}</SelectItem>}
                    {table.heads.map((head) => <SelectItem key={head} value={head}>{head}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/* The problem sits under the field it is about, in the line the sample has. */}
                {missing ? <p role="alert" className="h-4 truncate text-xs text-destructive">{t("columns.pickTitle")}</p> : <p className="h-4 truncate text-xs text-muted-foreground">{picked[key] ? first[picked[key]!] : null}</p>}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="flex flex-wrap gap-1.5">
            {counts.untitled.length ? <Chip>{t("columns.untitledLeftOut", { count: counts.untitled.length })}</Chip> : null}
            {picked.title && counts.bare.length ? <StateChip tone="warning">{t("columns.noAbstract", { count: counts.bare.length })}</StateChip> : null}
          </span>
          <Button size="sm" className="ms-auto" onClick={onAdd}><Plus />{picked.title ? t("columns.addRecords", { count: counts.records }) : t("columns.addItsRecords")}</Button>
        </div>
      </div>
    </div>
  );
}

// ── Files ────────────────────────────────────────────────────────────────────────────────────────

const REFERENCE_ENDINGS = ["ris", "bib", "enw", "nbib", "xml", "ciw", "csv", "tsv", "txt"];
const TABLE_FILES = /\.(csv|tsv)$/i;
const REFERENCE_FILES = new RegExp(`\\.(${REFERENCE_ENDINGS.join("|")})$`, "i");
const PDF_FILES = /\.pdf$/i;
const UPLOAD_ACCEPT = [...REFERENCE_ENDINGS, "pdf"].map((ending) => `.${ending}`).join(",");
/** The most PDFs one source holds (convex/screening/validators.ts `sourceSetValidator`). */
/** PDFs sent at once, and how many one call hands the server (convex/screening/validators.ts `PDFS_A_CALL`). */
const UPLOADS_AT_ONCE = 6;
const PDFS_A_CALL = 50;
const MB = 1024 * 1024;

/** Sends a file to storage and answers with where it is kept. */
function useUpload() {
  const t = useTranslations("screening.sources");
  const uploadUrl = useWorkspaceMutation(api.screening.held.uploadUrl);
  return async (body: Blob) => {
    const response = await fetch(await uploadUrl({}), { method: "POST", headers: { "Content-Type": body.type || "application/octet-stream" }, body });
    if (!response.ok) throw new Error(t("upload.notSent"));
    return ((await response.json()) as { storageId: Id<"_storage"> }).storageId;
  };
}

/**
 * Reference files, tables and PDFs, dropped or chosen. A reference file is read by the server, which counts its
 * records. A table is read here, and waits for its columns to be named where its headings don't say. PDFs chosen
 * together are one source, of any size: they are sent several at once, and each is read as soon as it is in
 * (convex/screening/files.ts), so what the source holds shows while the rest are still on their way.
 */
export function UploadTab({ sources, onAdd, lookCredits: given }: {
  sources: Source[];
  onAdd: (added: Added) => void;
  /** What one PDF's first reading costs, read by the form before the tab opens; null where no model reads PDFs. */
  lookCredits?: number | null;
}) {
  const t = useTranslations("screening.sources");
  const words = useWords();
  const upload = useUpload();
  const look = useWorkspaceAction(api.screening.held.look);
  const addDois = useAddDois(sources, onAdd);
  // What one PDF's first reading costs, said before any is added. Undefined while it is still being read.
  const read = useProtectedQuery(api.screening.held.pdfLook, inWorkspace(usePageWorkspace(), given === undefined ? {} : "skip")).data;
  const lookCredits = given === undefined ? read : given;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState<string[]>([]);
  const [pending, setPending] = useState<Array<PendingTable & { file: File }>>([]);
  const [refused, setRefused] = useState<Array<{ name: string; why: string }>>([]);
  const refuse = (name: string, why: string) => setRefused((now) => [...now.filter((one) => one.name !== name), { name, why }]);
  const addPdfs = useWorkspaceMutation(api.screening.files.add);
  const [sending, setSending] = useState<Array<{ batch: string; total: number; sent: number }>>([]);
  const has = (ref: string) => sources.some((source) => source.ref === ref);
  /** A file by its name, size and last change: the same file chosen twice is the same source. */
  const refOf = (file: File) => `upload:${hash(`${file.name}:${file.size}:${file.lastModified}`)}`;

  const addTable = async (file: File, table: TableRead, picked: TableRead["picked"]) => {
    const kept = await upload(file);
    onAdd({ ref: refOf(file), name: file.name, detail: t("upload.table"), total: tableCounts(table, picked).records, set: { kind: "upload", file: kept, columns: picked as Record<string, string> } });
  };
  const take = async (list: FileList) => {
    const files = [...list];
    setRefused([]);
    // A PDF is paid for as it is added: none is taken until its price is on the screen, and each one dropped before then says so.
    const priced = lookCredits !== undefined;
    const [pdfs, references] = [files.filter((file) => priced && PDF_FILES.test(file.name)), files.filter((file) => REFERENCE_FILES.test(file.name))];
    if (!priced) for (const file of files) if (PDF_FILES.test(file.name)) refuse(file.name, t("upload.why.priceComing"));
    for (const file of files) if (!pdfs.includes(file) && !references.includes(file) && !(PDF_FILES.test(file.name) && !priced)) refuse(file.name, t("upload.why.notReadable"));
    const reads = references.map((file) => file.name);
    setReading((now) => [...now, ...reads]);
    const sent = sendPdfs(pdfs);
    await Promise.all(references.map(async (file) => {
      try {
        if (has(refOf(file))) return refuse(file.name, t("upload.why.twice"));
        if (file.size > FILE_MAX_BYTES) return refuse(file.name, t("upload.why.tooBig", { mb: FILE_MAX_BYTES / MB }));
        if (TABLE_FILES.test(file.name)) {
          const table = readTable(await file.text());
          if (!table) return refuse(file.name, t("upload.why.noTable"));
          if (table.ask) return setPending((now) => [...now.filter((one) => one.ref !== refOf(file)), { name: file.name, ref: refOf(file), table, picked: table.picked, file }]);
          return await addTable(file, table, table.picked);
        }
        // A note or a list that holds DOIs and no references is read as the DOIs in it, as if they were pasted.
        const text = await file.text();
        const { dois } = doisIn(text);
        if (dois.length && !REFERENCES.test(text) && !readTable(text)?.picked.title) return (await addDois(dois, file.name)) === "twice" ? refuse(file.name, t("upload.why.twice")) : undefined;
        const kept = await upload(file);
        const held = await look({ file: kept });
        // A text file that is a table after all: its columns are named here, as any table's are.
        if (held.table) {
          const table = readTable(await file.text());
          if (table) return setPending((now) => [...now.filter((one) => one.ref !== refOf(file)), { name: file.name, ref: refOf(file), table, picked: table.picked, file }]);
        }
        if (!held.records) return refuse(file.name, t("upload.why.noReferences"));
        onAdd({ ref: refOf(file), name: file.name, detail: t("upload.referenceFile"), total: held.records, set: { kind: "upload", file: kept } });
      } catch (error) {
        refuse(file.name, getErrorMessage(error, t("upload.why.unread")));
      }
    }));
    setReading((now) => now.filter((name) => !reads.includes(name)));
    await sent;
  };
  /** PDFs chosen together go up several at once as one drop, and are one source once the last is in. */
  const sendPdfs = async (pdfs: File[]) => {
    const sized = pdfs.filter((file) => file.size <= MAX_PDF_BYTES);
    for (const file of pdfs) if (!sized.includes(file)) refuse(file.name, t("upload.why.pdfTooBig", { mb: MAX_PDF_MB }));
    const ref = `pdf:${hash(sized.map((file) => `${file.name}:${file.size}`).sort().join("|"))}`;
    if (!sized.length) return;
    if (has(ref)) return void sized.forEach((file) => refuse(file.name, t("upload.why.twice")));
    const batch = crypto.randomUUID();
    setSending((now) => [...now, { batch, total: sized.length, sent: 0 }]);
    const [queue, kept]: [File[], Array<{ file: Id<"_storage">; name: string; bytes: number }>] = [[...sized], []];
    let [added, failed] = [0, 0];
    const handed: string[] = [];
    // One call at a time hands over what has arrived since the last, so the files keep the order they came in.
    let handing = Promise.resolve();
    const hand = () => (handing = handing.then(async () => {
      while (kept.length) {
        const files = kept.splice(0, PDFS_A_CALL);
        await addPdfs({ batch, files });
        added += files.length;
        handed.push(...files.map((one) => one.name));
      }
    }));
    await Promise.all(Array.from({ length: UPLOADS_AT_ONCE }, async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        try {
          // A file that didn't go through is sent once more before it is given up.
          kept.push({ file: await upload(file).catch(() => upload(file)), name: file.name, bytes: file.size });
          setSending((now) => now.map((one) => (one.batch === batch ? { ...one, sent: one.sent + 1 } : one)));
          void hand().catch(() => {});
        } catch {
          failed++;
          refuse(file.name, t("upload.why.unsent"));
        }
      }
    }));
    try {
      await hand();
    } catch (error) {
      refuse(sized.length === 1 ? sized[0]!.name : words.count("pdfs", sized.length), getErrorMessage(error, t("upload.why.allUnsent")));
    }
    setSending((now) => now.filter((one) => one.batch !== batch));
    // Named by the files it holds: one that failed to send is none of them.
    if (added) onAdd({ ref, name: added > 1 ? t("upload.uploadedPdfs", { count: added }) : handed[0]!, detail: added === 1 ? t("upload.onePdf") : t("andMore", { name: handed[0]!, count: added - 1 }), total: added, set: { kind: "pdf", batch } });
    else if (!failed) refuse(sized.length === 1 ? sized[0]!.name : words.count("pdfs", sized.length), t("upload.why.allUnsent"));
  };
  const addPending = async (table: PendingTable & { file: File }) => {
    if (!table.picked.title) return setPending((now) => now.map((one) => (one.ref === table.ref ? { ...one, untitled: true } : one)));
    setPending((now) => now.filter((one) => one.ref !== table.ref));
    await addTable(table.file, table.table, table.picked).catch((error) => refuse(table.name, getErrorMessage(error, t("upload.why.unsent"))));
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void take(event.dataTransfer.files); }}
        className={cn("flex flex-col items-center gap-1.5 rounded-2xl border border-dashed bg-card px-6 py-7 text-center transition-colors", dragging ? "border-primary bg-primary/5" : "border-border")}
      >
        <p className="flex items-center gap-1 text-sm font-medium">
          {t("upload.drop")}
          <Help title={t("upload.helpTitle")} facts={<><HelpFact>{t("upload.fileLimit", { mb: FILE_MAX_BYTES / MB })}</HelpFact><HelpFact>{t("upload.pdfLimit", { mb: MAX_PDF_MB })}</HelpFact></>}>
            <p>{t("upload.aboutFiles")}</p>
            <p>{t("upload.aboutPdfs")}</p>
          </Help>
        </p>
        <p className="text-xs text-muted-foreground">{t("upload.kinds")}</p>
        {/* A PDF costs credits the moment it is added: the price stands where the files are chosen. Its line is held while the price is read. */}
        {/* While the price is read, its line says so in the room the price will take. */}
        {lookCredits === null || lookCredits === 0 ? null : (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Coins aria-hidden className="mt-px size-3.5 shrink-0" />
            <span className="grid">
              <span className={cn("col-start-1 row-start-1", lookCredits === undefined && "invisible")}>{t("upload.pdfCost", { credits: words.creditsOf(lookCredits ?? 0) })}</span>
              {lookCredits === undefined ? <span className="col-start-1 row-start-1">{t("upload.pricing")}</span> : null}
            </span>
          </p>
        )}
        <input ref={input} type="file" multiple accept={UPLOAD_ACCEPT} className="sr-only" aria-label={t("upload.filesLabel")} onChange={(event) => { if (event.target.files) void take(event.target.files); event.target.value = ""; }} />
        <Button variant="outline" size="sm" className="mt-2" disabled={lookCredits === undefined} onClick={() => input.current?.click()}><Upload />{t("upload.choose")}</Button>
      </div>
      {reading.length || pending.length || sending.length ? (
        <div className="divide-y divide-border-subtle rounded-2xl bg-card ring-1 ring-border-subtle">
          {sending.map((one) => (
            <div key={one.batch} className="flex min-h-14 items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06]"><Spinner className="size-4" /></span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="truncate text-sm font-medium">{words.count("pdfs", one.total)}</p>
                <Meter value={one.sent} max={one.total} />
              </div>
              <Chip><span className="tabular-nums">{t("upload.sent", { sent: one.sent, total: one.total })}</span></Chip>
            </div>
          ))}
          {reading.map((name) => (
            <div key={name} className="flex min-h-14 items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06]"><Spinner className="size-4" /></span>
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
              <Chip>{t("upload.reading")}</Chip>
            </div>
          ))}
          {pending.map((table) => (
            <ColumnMatch key={table.ref} pending={table} onPick={(key, head) => setPending((now) => now.map((one) => (one.ref === table.ref ? { ...one, picked: { ...one.picked, [key]: head }, untitled: false } : one)))} onAdd={() => void addPending(table)} onRemove={() => setPending((now) => now.filter((one) => one.ref !== table.ref))} />
          ))}
        </div>
      ) : null}
      {refused.length ? (
        <div className="flex items-start gap-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm">
          <FileX className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 space-y-1">{refused.map((one) => <p key={one.name}>{t.rich("upload.refused", { name: one.name, why: one.why, file: (chunks) => <span className="font-medium">{chunks}</span> })}</p>)}</div>
          <TooltipHint label={t("dismiss")}><Button variant="ghost" size="icon" className="-my-1 size-7 shrink-0" aria-label={t("dismiss")} onClick={() => setRefused([])}><X /></Button></TooltipHint>
        </div>
      ) : null}
    </div>
  );
}

/** How a drop of PDFs stands, as chips on its source's row, each count arriving as the files are read: how many are read, and how many are papers the index holds. The ones screened as the PDF they are, and the files that don't open, are counted by the row itself, as for any source. */
export function PdfFacts({ batch }: { batch: string }) {
  const t = useTranslations("screening.sources");
  const words = useWords();
  const drop = useProtectedQuery(api.screening.files.drop, inWorkspace(usePageWorkspace(), { batch })).data;
  if (!drop) return <Chip><Spinner className="size-3" />{words.t("pdf.waiting")}</Chip>;
  return (
    <>
      {drop.waiting ? <Chip><Spinner className="size-3" /><span className="tabular-nums">{t("pdf.read", { read: drop.total - drop.waiting, total: drop.total })}</span></Chip> : null}
      {drop.known ? <Chip icon={Check}>{t.rich("pdf.inIndex", { count: drop.known, n: (chunks) => <span className="tabular-nums">{chunks}</span> })}</Chip> : null}
    </>
  );
}

const FILES_PAGE = 8;
/** A PDF's row with its line. */
const FILE_ROW = 45;
/** A drop's PDFs a page at a time, each under the title its first pages print, with how it stands. */
export function PdfFiles({ batch, total }: { batch: string; total: number }) {
  const t = useTranslations("screening.sources");
  const words = useWords();
  const rows = useCursorPageAt("filesPage", api.screening.files.list, inWorkspace(usePageWorkspace(), { batch }), FILES_PAGE);
  // The first page holds as many as the drop has, up to a page: its rows and its pager stand from the first frame.
  const first = Math.min(total, FILES_PAGE);
  return (
    <div className="space-y-2">
      {rows.isLoading ? <ListRowsSkeleton rows={first} height={FILE_ROW} icon={false} label={t("pdf.loading")} className="*:px-0" /> : (
      <ul aria-label={t("pdf.list")} className={cn("divide-y divide-border-subtle transition-opacity", rows.isStale && "pointer-events-none opacity-60")} style={{ minHeight: first * FILE_ROW }}>
        {rows.items.map((row) => {
          const stands = row.state === "read" ? (row.known ? "known" : "file") : row.state;
          return (
            <li key={row.id} className="flex min-h-11 items-center gap-x-3 gap-y-1 py-1.5 max-sm:flex-wrap">
              <div className="min-w-0 flex-1 max-sm:basis-full">
                <p className="truncate text-sm">{row.title ?? row.name}</p>
                {row.title ? <p className="truncate text-xs text-muted-foreground">{row.name}</p> : null}
              </div>
              {/* A file says both where both hold: the index has the paper, and it is read as its PDF all the same, for want of an abstract there. */}
              {stands === "broken" ? <StateChip tone="warning" icon={FileX}>{words.t("pdf.broken")}</StateChip> : stands === "waiting" ? <Chip><Spinner className="size-3" />{words.t("pdf.waiting")}</Chip> : (
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {row.known ? <Chip icon={Check}>{row.asFile ? t("pdf.knownNoAbstract") : words.t("pdf.known")}</Chip> : null}
                  {row.asFile ? <Chip icon={FileText}>{row.pages ? t("pdf.fileWithPages", { count: row.pages }) : words.t("pdf.file")}</Chip> : null}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      )}
      {rows.hasPages || total > FILES_PAGE ? <CommandCenterPagination className="pt-1" currentPage={rows.page} itemLabel={t("pdf.pager")} steps={{ canPrevious: rows.canPrevious, canNext: rows.canNext, onPrevious: rows.previous, onNext: rows.next, offset: rows.offset, shown: rows.isLoading ? first : rows.items.length, total, pageCount: Math.max(1, Math.ceil(total / FILES_PAGE)) }} /> : null}
    </div>
  );
}

// ── Pasted DOIs ──────────────────────────────────────────────────────────────────────────────────

/**
 * Adds DOIs as one source, the same whether they were pasted or came in a file: the list is kept, and the screening
 * looks each one up as it reads the source, so its row says what was taken and what was left out, as every source's
 * does. "twice" where the same DOIs are a source already.
 */
function useAddDois(sources: Source[], onAdd: (added: Added) => void) {
  const t = useTranslations("screening.sources");
  const keep = useWorkspaceAction(api.screening.held.keepDois);
  return async (dois: string[], from?: string): Promise<"added" | "twice"> => {
    // The same DOIs are the same source, in whatever order they came.
    const ref = `dois:${hash([...dois].sort().join())}`;
    if (sources.some((source) => source.ref === ref)) return "twice";
    const kept = await keep({ dois });
    onAdd({ ref, name: from ?? (dois.length > 1 ? t("andMore", { name: dois[0]!, count: dois.length - 1 }) : dois[0]!), detail: from ? t("dois.fromFile") : t("dois.pasted"), total: kept.dois, set: { kind: "dois", file: kept.file } });
    return "added";
  };
}

/** Pasted DOIs: found in whatever text holds them, and added as one source. */
export function DoiTab({ sources, onAdd }: { sources: Source[]; onAdd: (added: Added) => void }) {
  const t = useTranslations("screening.sources");
  const words = useWords();
  const addDois = useAddDois(sources, onAdd);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [twice, setTwice] = useState(false);
  const { dois, repeats } = doisIn(text);
  const run = async () => {
    setBusy(true);
    try {
      if ((await addDois(dois)) === "twice") setTwice(true);
      else setText("");
    } catch (error) {
      toast.error(getErrorMessage(error, t("dois.notAdded")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <span className="flex items-center gap-1">
        <label htmlFor="dois" className="text-xs font-medium text-muted-foreground">{t("dois.label")}</label>
        <Help title={t("dois.helpTitle")} facts={<><HelpFact>{t("dois.forms")}</HelpFact><HelpFact>{t("dois.takenOnce")}</HelpFact></>}>{t("dois.about")}</Help>
      </span>
      <Textarea id="dois" value={text} onChange={(event) => { setText(event.target.value); setTwice(false); }} rows={5} aria-invalid={twice || undefined} placeholder={t("dois.placeholder")} className="bg-card text-sm" />
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex flex-wrap items-center gap-1.5">
          {twice ? (
            <StateChip tone="warning" icon={TriangleAlert}>{t("dois.twice", { count: dois.length })}</StateChip>
          ) : dois.length ? (
            <Chip icon={Hash}>{words.count("dois", dois.length)}</Chip>
          ) : text.trim() ? (
            <StateChip tone="warning" icon={TriangleAlert}>{t("dois.none")}</StateChip>
          ) : null}
          {repeats && !twice ? <Chip>{t("dois.repeats", { count: repeats })}</Chip> : null}
        </span>
        <Button variant="outline" size="sm" className="ms-auto" disabled={!dois.length || busy} onClick={() => void run()}>{busy ? <Spinner className="size-4" /> : <Plus />}{dois.length ? t("dois.addCount", { count: dois.length }) : t("dois.add")}</Button>
      </div>
    </div>
  );
}

// ── Zotero ───────────────────────────────────────────────────────────────────────────────────────

type ZoteroLibrary = { id?: string; name: string; papers?: number };
/** A collection as the list shows it. `under`: what it holds with everything under it, once the library is counted. `above`: where it sits, for one found by its name. */
type ZoteroCollection = { key: string; name: string; papers: number; inside: number; under?: number; above?: Array<{ key: string; name: string }> };

/**
 * A Zotero account's libraries: the person's own and each group they are in. One is picked, then all of it or any
 * of its collections is added, a collection at a time. The list's first row is where it stands, the library or a
 * collection opened from it, with the way back up; under it are the collections there, a page of Zotero's at a time.
 */
export function ZoteroTab({ sources, onAdd }: { sources: Source[]; onAdd: (added: Added) => void }) {
  const t = useTranslations("screening.sources");
  const shared = useWords();
  const workspaceId = usePageWorkspace();
  const account = useProtectedQuery(api.zotero.queries.getConnectionStatus, {}).data;
  const readGroups = useWorkspaceAction(api.screening.zoteroSources.groups);
  const openTree = useWorkspaceMutation(api.zotero.tree.open);
  const own: ZoteroLibrary = { name: t("zotero.myLibrary") };
  // The library and the collections opened on the way to where the list stands, the last of them the one it stands in, are in the address together: each one opened is a step in the history, and Back returns to a folder with the library it is in. What each is, is kept as it was read.
  const [where, setWhere] = useQueryStates({ zoteroLibrary: parseAsString, folder: parseAsArrayOf(parseAsString), zoteroFind: parseAsString.withDefault(""), zoteroAll: parseAsBoolean.withDefault(true) }, { history: "push", scroll: false });
  // Whether a collection is taken with its sub-collections: a choice in the address with the rest, so Back undoes it.
  const deep = where.zoteroAll;
  const setDeep = (next: boolean) => void setWhere({ zoteroAll: next ? null : false });
  const [seen, setSeen] = useState<{ libraries: Record<string, ZoteroLibrary>; folders: Record<string, ZoteroCollection> }>({ libraries: {}, folders: {} });
  const keys = where.folder ?? [];
  // A folder opened before a reload, or before the tab was left, is read back by its key.
  const unknown = keys.some((key) => !seen.folders[key]);
  const named = useProtectedQuery(api.zotero.tree.path, inWorkspace(workspaceId, unknown && account?.connected ? { ...(where.zoteroLibrary ? { groupId: where.zoteroLibrary } : {}), keys } : "skip")).data;
  const known = { ...Object.fromEntries((named ?? []).map((one) => [one.key, one])), ...seen.folders };
  const resolving = keys.some((key) => !known[key]) && named === undefined;
  const path = keys.flatMap((key) => (known[key] ? [known[key]] : []));
  // A collection the address names that Zotero no longer has: said, and nothing wider is listed in its place until the person moves up.
  const gone = !resolving && keys.some((key) => !known[key]);
  const [picking, setPicking] = useState(false);
  // The search over the library's collections is in the address with them: starting and clearing it are steps.
  const find = where.zoteroFind;
  const setFind = (next: string) => void setWhere({ zoteroFind: next || null }, searchHistory(find, next));
  const words = useDebouncedValue(find.trim(), 300);
  const deepId = useId();
  const connected = account?.connected === true;
  const of = where.zoteroLibrary ? { groupId: where.zoteroLibrary } : {};
  // The groups, a page of Zotero's at a time: the next is read when the person asks for more.
  const [more, setMore] = useState<{ groups: ZoteroLibrary[]; next?: number }>({ groups: [] });
  const groups = useSWR(connected ? ["zotero-groups"] : null, () => readGroups({}), { revalidateOnFocus: false });
  const listedGroups = [...(groups.data?.page ?? []), ...more.groups];
  const nextGroups = more.groups.length ? more.next : groups.data?.next;
  // The library the address names: as it was picked, else as the groups list it (after a reload).
  const library: ZoteroLibrary = where.zoteroLibrary ? (seen.libraries[where.zoteroLibrary] ?? listedGroups.find((one) => one.id === where.zoteroLibrary) ?? { id: where.zoteroLibrary, name: t("zotero.group") }) : own;
  const moreGroups = async () => { const read = await readGroups({ start: nextGroups }); setMore((now) => ({ groups: [...now.groups, ...read.page], next: read.next })); };
  // The library's collections are kept on the server as rows, read again from Zotero where what is kept is old (convex/zotero/tree.ts): opening the library asks for that, and the list below pages and searches what is kept.
  useSWR(connected ? ["zotero-open", library.id ?? ""] : null, () => openTree(of), { revalidateOnFocus: false });
  const tree = useProtectedQuery(api.zotero.tree.state, inWorkspace(workspaceId, connected ? of : "skip")).data;
  const here = path.at(-1);
  const level = useCursorPageAt("folderPage", api.zotero.tree.level, inWorkspace(workspaceId, connected && !words && !resolving && !gone ? { ...of, ...(here ? { parent: here.key } : {}) } : "skip"), PAGE);
  const found = useCursorPageAt("folderPage", api.zotero.tree.find, inWorkspace(workspaceId, connected && words ? { ...of, text: words } : "skip"), PAGE);
  const listed = words ? found : level;

  // The tab as it will stand once the account is known: the library's pill, the search and its switch, and the list.
  if (account === undefined) {
    return (
      <div className="space-y-2">
        <SkeletonBar className="h-8 w-full rounded-full" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SkeletonBar className="h-8 min-w-[min(14rem,100%)] flex-1 rounded-full" />
          <SkeletonBar className="h-4 w-44" />
        </div>
        <ListRowsSkeleton rows={PAGE + 1} height={ROW} icon={false} label={t("zotero.loading")} className="*:px-1" />
      </div>
    );
  }
  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border bg-card px-6 py-7 text-center">
        <p className="text-sm font-medium">{t("zotero.notConnected")}</p>
        <p className="text-xs text-muted-foreground">{t("zotero.connectWhy")}</p>
        <Button asChild variant="outline" size="sm" className="mt-2"><NextLink href="/settings/connections"><ZoteroIcon />{t("zotero.connect")}</NextLink></Button>
      </div>
    );
  }

  const rows: ZoteroCollection[] = listed.items;
  // The library's collections are still on their way from Zotero: the list fills as they arrive, and says how far the reading is.
  const reading = tree === undefined || tree === null || tree.state === "reading";
  const loading = reading || listed.isLoading || resolving;
  // A collection opened says how many it holds, so its pager stands before its first page comes.
  const pagerKnown = listed.hasPages || Boolean(!words && here && here.inside > PAGE);
  const go = (next: ZoteroCollection[]) => {
    setSeen((now) => ({ ...now, folders: { ...now.folders, ...Object.fromEntries(next.map((one) => [one.key, one])) } }));
    void setWhere({ folder: next.length ? next.map((one) => one.key) : null, zoteroFind: null });
  };
  const pick = (next: ZoteroLibrary) => {
    if (next.id) setSeen((now) => ({ ...now, libraries: { ...now.libraries, [next.id!]: next } }));
    void setWhere({ zoteroLibrary: next.id ?? null, folder: null, zoteroFind: null });
    setPicking(false);
  };
  const refOf = (one?: ZoteroCollection, withUnder = false) => `zotero:${library.id ?? "me"}${one ? `:${one.key}` : ""}${withUnder ? ":deep" : ""}`;
  const under = (one: ZoteroCollection) => deep && one.inside > 0;
  const aboveOf = (one: ZoteroCollection): ZoteroCollection[] => one.above?.map((step) => ({ ...step, papers: 0, inside: 1 })) ?? (path.some((step) => step.key === one.key) ? path.slice(0, path.findIndex((step) => step.key === one.key)) : path);
  const added = (one?: ZoteroCollection) => sources.some((source) => source.ref === refOf(one) || source.ref === refOf(one, true));
  const add = (one: ZoteroCollection) => {
    const above = aboveOf(one);
    onAdd({ ref: refOf(one, under(one)), name: one.name, detail: t("in", { name: library.name }), total: under(one) ? (one.under ?? one.papers) : one.papers, filters: [...(above.length ? [t("in", { name: above.map((step) => step.name).join(" › ") })] : []), ...(under(one) ? [t("zotero.withSubCollections")] : [])], set: { kind: "zotero", ...(library.id ? { groupId: library.id } : {}), collectionKey: one.key, ...(under(one) ? { deep: true } : {}) } });
  };
  // What a collection holds with everything under it is what Zotero counts in each, added up: a paper filed in two of them counts twice until the screening reads it, so it is "about".
  // Until the library is counted, the chip's place is held, so the row doesn't grow when it comes.
  const counted = (one: ZoteroCollection) => (under(one) ? { count: false, chips: <Chip className={cn(one.under === undefined && "invisible")}>{t("zotero.aboutUnder", { count: one.under ?? one.papers })}</Chip> } : { count: true, chips: undefined });
  const LibraryIcon = library.id ? Users : UserRound;
  const option = (one: ZoteroLibrary) => {
    const Icon = one.id ? Users : UserRound;
    return (
      <CommandItem key={one.id ?? "me"} value={`${one.name} ${one.id ?? ""}`} onSelect={() => pick(one)} className="gap-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{one.name}</span>
        {one.papers === undefined ? null : <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{shared.count("items", one.papers)}</span>}
        {one.id === library.id ? <Check className="size-4 shrink-0 text-primary" /> : null}
      </CommandItem>
    );
  };
  const step = "rounded-sm underline decoration-foreground/25 underline-offset-2 outline-none transition-colors hover:text-foreground hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/50";
  const trailOf = (above: ZoteroCollection[]) => (
    <FadeRow scrolls scrollbar="none" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <button type="button" onClick={() => go([])} className={cn(step, "shrink-0")}>{library.name}</button>
      {above.map((one, at) => (
        <span key={one.key} className="flex shrink-0 items-center gap-1"><ChevronRight aria-hidden className="size-3" /><button type="button" onClick={() => go(above.slice(0, at + 1))} className={step}>{one.name}</button></span>
      ))}
    </FadeRow>
  );

  return (
    <div className="space-y-2">
      <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={picking} aria-label={t("zotero.library")} className="h-8 w-full min-w-0 justify-between gap-3 rounded-full bg-card px-3.5 text-xs font-normal">
            <span className="flex min-w-0 items-center gap-2"><LibraryIcon className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{library.name}</span></span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label={t("zotero.library")} className="w-(--radix-popover-trigger-width) p-0">
          <Command>
            {/* Someone in dozens of groups finds one by its name. */}
            {listedGroups.length > 8 ? <CommandInput placeholder={t("zotero.findGroup")} /> : null}
            <CommandList className="max-h-72">
              <CommandGroup heading={t("zotero.yours")}>{option(own)}</CommandGroup>
              {listedGroups.length ? <CommandGroup heading={t("zotero.groups")}>{listedGroups.map(option)}</CommandGroup> : null}
              {nextGroups === undefined ? null : <CommandGroup><CommandItem value="more groups" onSelect={() => void moreGroups()} className="justify-center text-muted-foreground">{t("zotero.moreGroups")}</CommandItem></CommandGroup>}
            </CommandList>
          </Command>
          <p className="flex items-center justify-between gap-3 border-t border-border-subtle px-3 py-2 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5"><ZoteroIcon className="size-3.5 shrink-0" /><span className="truncate">{account.username ? t("zotero.connectedAs", { name: account.username }) : t("zotero.connected")}</span></span>
            <NextLink href="/settings/connections" className={cn(INLINE_LINK, "shrink-0")}>{t("zotero.connections")}</NextLink>
          </p>
        </PopoverContent>
      </Popover>
      {/* The switch sits beside the search; where the row is narrow it moves under it whole. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ListSearch box="min-w-[min(14rem,100%)] flex-1" value={find} onChange={(event) => setFind(event.target.value)} placeholder={t("zotero.findCollection")} aria-label={t("zotero.findCollectionIn", { library: library.name })} className={SEARCH_PILL} />
        <span className="flex shrink-0 items-center gap-1">
          <label htmlFor={deepId} className="flex items-center gap-2 text-xs font-medium"><Switch id={deepId} size="sm" checked={deep} onCheckedChange={setDeep} />{t("zotero.includeSub")}</label>
          <Help title={t("zotero.subHelpTitle")} facts={<HelpFact>{t("zotero.subTakenOnce")}</HelpFact>}>{t("zotero.subAbout")}</Help>
        </span>
      </div>
      {/* The list holds a page's height while it fills or pages, the rows still to come drawn in their place, and a change to its height slides. */}
      <AutoHeight>
      {/* Rows of the list before (another library, folder or search) stay dimmed and out of reach until the new ones come: none can be added under the wrong library. */}
      <div inert={listed.isStale || resolving} className={cn("divide-y divide-border-subtle transition-opacity", (listed.isStale || resolving) && "opacity-60")}>
        {/* Where the list stands: all of the library, or the collection opened from it with the steps that lead back up. It can be added as it is. A name being looked for is looked for in the whole library. */}
        {words || gone || resolving ? null : here ? (
          <OfferRow offer={{ name: here.name, detail: "", total: here.papers }} icon={Folder} trail={trailOf(path.slice(0, -1))} added={added(here)} onAdd={() => add(here)} {...counted(here)} />
        ) : (
          <OfferRow
            offer={{ name: t("zotero.everyPaper", { library: library.name }), detail: library.id ? t("zotero.group") : t("zotero.own"), total: library.papers ?? 0 }}
            icon={Library}
            added={added()}
            // Zotero counts a library's items, attached files and notes among them: how many are papers is known once it is read.
            count={false}
            // How the reading stands is said where the count is, and the count takes its place once it is done.
            chips={reading ? (
              <Chip><Spinner className="size-3" />{tree?.total ? <span className="tabular-nums">{t("zotero.readingCount", { read: tree.read, total: tree.total })}</span> : t("zotero.reading")}</Chip>
            ) : tree?.state === "failed" ? (
              <StateChip tone="warning" icon={TriangleAlert}>{t("zotero.failed")}</StateChip>
            ) : library.papers === undefined ? (
              <Chip>{shared.count("collections", tree?.total ?? 0)}</Chip>
            ) : (
              <Chip>{t("zotero.itemsInZotero", { count: library.papers })}</Chip>
            )}
            onAdd={() => onAdd({ ref: refOf(), name: library.name, detail: library.id ? t("zotero.group") : t("zotero.own"), total: library.papers ?? 0, filters: [t("zotero.wholeLibrary")], set: { kind: "zotero", ...(library.id ? { groupId: library.id } : {}) } })}
          />
        )}
        <div className="divide-y divide-border-subtle" style={{ minHeight: loading || pagerKnown ? PAGE * ROW : undefined }}>
          {rows.map((one) => (
            <OfferRow
              key={one.key}
              offer={{ name: one.name, detail: one.inside ? shared.count("subCollections", one.inside) : "", total: one.papers }}
              icon={Folder}
              // A collection found by its name says where it sits.
              trail={words && one.above?.length ? trailOf(aboveOf(one)) : undefined}
              added={added(one)}
              onOpen={one.inside ? () => go([...aboveOf(one), one]) : undefined}
              onAdd={() => add(one)}
              {...counted(one)}
            />
          ))}
          {loading && rows.length < PAGE ? <ListRowsSkeleton rows={PAGE - rows.length} height={ROW} icon={false} label={t("zotero.loadingCollections")} className="*:px-1" /> : null}
          {gone ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground">
              <p>{t("zotero.gone")}</p>
              <Button variant="outline" size="sm" onClick={() => go(path)}>{t("zotero.openAbove", { name: path.at(-1)?.name ?? library.name })}</Button>
            </div>
          ) : null}
          {!gone && !reading && !listed.isLoading && !rows.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{words ? t("zotero.noneFound", { library: library.name, text: shared.quoted(find.trim()) }) : here ? t("zotero.noneHere", { name: here.name }) : t("zotero.noneInLibrary", { library: library.name })}</p> : null}
        </div>
      </div>
      {pagerKnown ? <CommandCenterPagination className="pt-1" currentPage={listed.page} itemLabel={t("zotero.pager")} steps={{ canPrevious: listed.canPrevious, canNext: listed.canNext, onPrevious: listed.previous, onNext: listed.next, offset: listed.offset, shown: listed.isLoading ? PAGE : rows.length, ...(words || !here ? {} : { total: here.inside, pageCount: Math.max(1, Math.ceil(here.inside / PAGE)) }) }} /> : null}
      </AutoHeight>
    </div>
  );
}

// ── Communities ──────────────────────────────────────────────────────────────────────────────────

/** A community's collections, searches and records, picked from the list every other form of the app uses for them. */
export function CommunityTab({ sources, onAdd }: { sources: Source[]; onAdd: (added: Added) => void }) {
  const libraries = useLibrarySources();
  const added = (ref: string) => sources.some((source) => source.ref === ref);
  const t = useTranslations("screening.sources");
  // Named as a community's hand-off names it (./library-sources.tsx `useRowLabel`).
  const labelOf = useRowLabel();
  const add = (row: LibraryRow, library: { name: string }) => {
    const ref = `evidenceLibrary:${rowKey(row)}`;
    if (!added(ref)) onAdd({ ref, name: labelOf(row), ...(row.what === "search" && !row.label ? { untitled: true } : {}), detail: t("in", { name: library.name }), total: row.records, set: setOfRow(row as Parameters<typeof setOfRow>[0]) as SourceSet });
  };
  return <LibrarySources state={libraries} isOn={(row) => added(`evidenceLibrary:${rowKey(row)}`)} onToggle={(row, library) => add(row, library)} onPasted={(held) => add(held.row, held.library)} scope={() => null} />;
}
