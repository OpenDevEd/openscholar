"use client";

// The places a screening's papers come from that take more than a list to pick from: files and PDFs a
// person hands over, pasted DOIs, a Zotero library or one of its collections, and a community. Each
// hands the form what it adds as a source: the thing the server reads (`set`), under a name, with how
// many papers it holds.

import { useId, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, ChevronRight, ChevronsUpDown, FileSpreadsheet, FileText, FileX, Folder, Hash, Library, Plus, Trash2, TriangleAlert, Upload, UserRound, Users, X, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
import { LibrarySources, useLibrarySources } from "./library-sources";
import { Chip, Meter, RequiredMark } from "./parts";
import { pagerOf } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
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
import { rowKey, setOfRow } from "@/lib/evidence-libraries/reader-sources";
import { MAX_PDF_BYTES, MAX_PDF_MB } from "@/lib/files/limits";
import { COLUMN_KEYS, COLUMN_LABEL, FILE_MAX_BYTES, doisIn, readTable, tableCounts, type ColumnKey, type TableRead } from "@/lib/screening/files";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace as usePageWorkspace, useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { PDF_STANDS, hash, num, plural, type Source, type SourceSet } from "./data";
import { Help, INLINE_LINK, StateChip } from "./pieces";

const PAGE = 5;
/** A row's height with its line: a list keeps its page's height on a last page that holds fewer. */
const ROW = 57;

/** What a tab hands the form to add as a source: what the server reads, under the name its list gave it, with how many papers it holds and what tells it from another of the same name. */
export type Added = { ref: string; name: string; detail: string; total: number; set: SourceSet; filters?: string[] };
type Offer = Pick<Added, "name" | "detail" | "total" | "filters">;

export function OfferRow({ offer, icon: Icon, chips, trail, added, onAdd, onOpen, count = true }: {
  offer: Offer;
  icon: AppIcon;
  /** What else tells this row from the others, after its detail. */
  chips?: ReactNode;
  /** Where it sits, as steps that lead back up, in place of its detail. */
  trail?: ReactNode;
  added: boolean;
  onAdd: () => void;
  /** Where it holds more to pick from: its name is then the way in. */
  onOpen?: () => void;
  /** Whether how many papers it holds is known before it is read. Where it isn't, no count shows, and it can be added whatever the number says. */
  count?: boolean;
}) {
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
              <span className={name}>{offer.name}</span>
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ) : (
            <p className={cn("min-w-0 text-sm font-medium", name)}>{offer.name}</p>
          )}
        </div>
        {trail ? (
          <div className="ps-7">{trail}</div>
        ) : second ? (
          <p className="flex min-w-0 items-center gap-1.5 ps-7 text-xs text-muted-foreground"><span className="truncate">{offer.detail}</span>{offer.filters?.map((filter) => <Chip key={filter} className="h-5 px-1.5 @max-xl:hidden">{filter}</Chip>)}{chips ? <span className="flex shrink-0 items-center gap-1.5 @max-xl:hidden">{chips}</span> : null}</p>
        ) : null}
      </div>
      {count ? <Chip className="max-sm:ms-7">{plural(offer.total, "paper", "papers")}</Chip> : null}
      <Button variant="outline" size="sm" className="w-24 max-sm:ms-auto" disabled={added || (count && !offer.total)} onClick={onAdd}>{added ? <><Check />Added</> : count && !offer.total ? "Empty" : <><Plus />Add</>}</Button>
    </div>
  );
}

export type PendingTable = { name: string; /** What it reads, which tells two files of one name apart. */ ref: string; table: TableRead; picked: TableRead["picked"]; /** Add was pressed with no title column picked. */ untitled?: boolean };
const NONE = "-";

/** The row a table waits in until its columns are named. Under each choice is what the first record holds in that column, to check the pick against. */
export function ColumnMatch({ pending, onPick, onAdd, onRemove }: { pending: PendingTable; onPick: (key: ColumnKey, head: string | undefined) => void; onAdd: () => void; onRemove: () => void }) {
  const id = useId();
  const { table, picked } = pending;
  const counts = tableCounts(table, picked);
  const first = table.rows[0] ?? {};
  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex min-h-9 items-center gap-3 max-sm:flex-wrap">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-foreground"><FileSpreadsheet className="size-4" /></span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium max-sm:basis-[calc(100%-3rem)]">{pending.name}</p>
        <StateChip tone="warning" icon={TriangleAlert}>Its columns need naming</StateChip>
        <TooltipHint label={`Remove ${pending.name}`}><Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground max-sm:ms-auto" aria-label={`Remove ${pending.name}`} onClick={onRemove}><Trash2 /></Button></TooltipHint>
      </div>
      <div className="space-y-3 ps-12 max-sm:ps-0">
        <p className="text-xs text-muted-foreground">Pick the column that holds each part. Under it is what the first of its {plural(table.rows.length, "row", "rows")} has there.</p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
          {COLUMN_KEYS.map((key) => {
            const missing = key === "title" && pending.untitled && !picked.title;
            return (
              <div key={key} className="min-w-0 space-y-1">
                <label htmlFor={`${id}-${key}`} className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{COLUMN_LABEL[key]}{key === "title" ? <RequiredMark /> : null}</label>
                <Select value={picked[key] ?? (key === "title" ? "" : NONE)} onValueChange={(next) => onPick(key, next === NONE ? undefined : next)}>
                  <SelectTrigger id={`${id}-${key}`} aria-invalid={missing || undefined} className="h-9 w-full min-w-0 bg-card"><SelectValue placeholder="Pick a column" /></SelectTrigger>
                  <SelectContent>
                    {key === "title" ? null : <SelectItem value={NONE}>Not in this file</SelectItem>}
                    {table.heads.map((head) => <SelectItem key={head} value={head}>{head}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/* The problem sits under the field it is about, in the line the sample has. */}
                {missing ? <p role="alert" className="h-4 truncate text-xs text-destructive">Pick the column that holds the title</p> : <p className="h-4 truncate text-xs text-muted-foreground">{picked[key] ? first[picked[key]!] : null}</p>}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="flex flex-wrap gap-1.5">
            {counts.untitled.length ? <Chip>{plural(counts.untitled.length, "row", "rows")} without a title left out</Chip> : null}
            {picked.title && counts.bare.length ? <StateChip tone="warning">{num(counts.bare.length)} without an abstract</StateChip> : null}
          </span>
          <Button size="sm" className="ms-auto" onClick={onAdd}><Plus />Add {picked.title ? plural(counts.records, "record", "records") : "its records"}</Button>
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
  const uploadUrl = useWorkspaceMutation(api.screening.held.uploadUrl);
  return async (body: Blob) => {
    const response = await fetch(await uploadUrl({}), { method: "POST", headers: { "Content-Type": body.type || "application/octet-stream" }, body });
    if (!response.ok) throw new Error("The file couldn't be sent. Try again.");
    return ((await response.json()) as { storageId: Id<"_storage"> }).storageId;
  };
}

/**
 * Reference files, tables and PDFs, dropped or chosen. A reference file is read by the server, which counts its
 * records. A table is read here, and waits for its columns to be named where its headings don't say. PDFs chosen
 * together are one source, of any size: they are sent several at once, and each is read as soon as it is in
 * (convex/screening/files.ts), so what the source holds shows while the rest are still on their way.
 */
export function UploadTab({ sources, onAdd }: { sources: Source[]; onAdd: (added: Added) => void }) {
  const upload = useUpload();
  const look = useWorkspaceAction(api.screening.held.look);
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
    onAdd({ ref: refOf(file), name: file.name, detail: "Table", total: tableCounts(table, picked).records, set: { kind: "upload", file: kept, columns: picked as Record<string, string> } });
  };
  const take = async (list: FileList) => {
    const files = [...list];
    setRefused([]);
    const [pdfs, references] = [files.filter((file) => PDF_FILES.test(file.name)), files.filter((file) => REFERENCE_FILES.test(file.name))];
    for (const file of files) if (!pdfs.includes(file) && !references.includes(file)) refuse(file.name, "Not a kind of file a screening reads");
    const reads = references.map((file) => file.name);
    setReading((now) => [...now, ...reads]);
    const sent = sendPdfs(pdfs);
    await Promise.all(references.map(async (file) => {
      try {
        if (has(refOf(file))) return refuse(file.name, "Already a source");
        if (file.size > FILE_MAX_BYTES) return refuse(file.name, `Over ${FILE_MAX_BYTES / MB} MB: split it and add each part`);
        if (TABLE_FILES.test(file.name)) {
          const table = readTable(await file.text());
          if (!table) return refuse(file.name, "No table of references in it");
          if (table.ask) return setPending((now) => [...now.filter((one) => one.ref !== refOf(file)), { name: file.name, ref: refOf(file), table, picked: table.picked, file }]);
          return await addTable(file, table, table.picked);
        }
        const kept = await upload(file);
        const held = await look({ file: kept });
        // A text file that is a table after all: its columns are named here, as any table's are.
        if (held.table) {
          const table = readTable(await file.text());
          if (table) return setPending((now) => [...now.filter((one) => one.ref !== refOf(file)), { name: file.name, ref: refOf(file), table, picked: table.picked, file }]);
        }
        if (!held.records) return refuse(file.name, "No references in it");
        onAdd({ ref: refOf(file), name: file.name, detail: "Reference file", total: held.records, set: { kind: "upload", file: kept } });
      } catch (error) {
        refuse(file.name, getErrorMessage(error, "It couldn't be read"));
      }
    }));
    setReading((now) => now.filter((name) => !reads.includes(name)));
    await sent;
  };
  /** PDFs chosen together go up several at once as one drop, and are one source once the last is in. */
  const sendPdfs = async (pdfs: File[]) => {
    const sized = pdfs.filter((file) => file.size <= MAX_PDF_BYTES);
    for (const file of pdfs) if (!sized.includes(file)) refuse(file.name, `Over ${MAX_PDF_MB} MB`);
    const ref = `pdf:${hash(sized.map((file) => `${file.name}:${file.size}`).sort().join("|"))}`;
    if (!sized.length) return;
    if (has(ref)) return void sized.forEach((file) => refuse(file.name, "Already a source"));
    const batch = crypto.randomUUID();
    setSending((now) => [...now, { batch, total: sized.length, sent: 0 }]);
    const [queue, kept]: [File[], Array<{ file: Id<"_storage">; name: string; bytes: number }>] = [[...sized], []];
    let [added, failed] = [0, 0];
    // One call at a time hands over what has arrived since the last, so the files keep the order they came in.
    let handing = Promise.resolve();
    const hand = () => (handing = handing.then(async () => {
      while (kept.length) {
        const files = kept.splice(0, PDFS_A_CALL);
        await addPdfs({ batch, files });
        added += files.length;
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
          refuse(file.name, "It couldn't be sent");
        }
      }
    }));
    try {
      await hand();
    } catch (error) {
      refuse(sized.length === 1 ? sized[0]!.name : `${num(sized.length)} PDFs`, getErrorMessage(error, "They couldn't be sent"));
    }
    setSending((now) => now.filter((one) => one.batch !== batch));
    if (added) onAdd({ ref, name: `${sized[0]!.name}${added > 1 ? ` and ${num(added - 1)} more` : ""}`, detail: added === 1 ? "A PDF" : "PDFs", total: added, set: { kind: "pdf", batch } });
    else if (!failed) refuse(sized.length === 1 ? sized[0]!.name : `${num(sized.length)} PDFs`, "They couldn't be sent");
  };
  const addPending = async (table: PendingTable & { file: File }) => {
    if (!table.picked.title) return setPending((now) => now.map((one) => (one.ref === table.ref ? { ...one, untitled: true } : one)));
    setPending((now) => now.filter((one) => one.ref !== table.ref));
    await addTable(table.file, table.table, table.picked).catch((error) => refuse(table.name, getErrorMessage(error, "It couldn't be sent")));
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
          Drop reference files or PDFs here
          <Help title="Files" facts={<><HelpFact>Reference files up to {FILE_MAX_BYTES / MB} MB</HelpFact><HelpFact>PDFs up to {MAX_PDF_MB} MB each</HelpFact></>}>
            <p>A reference file is what a database or a reference manager exports. Each of its records with a title and an abstract is a paper.</p>
            <p>A PDF is read as soon as it is added, for its title and its DOI. Where Openscholar&apos;s index holds that DOI, the paper shows with the index&apos;s title and abstract. Otherwise the paper is the PDF: a person screening it reads the file, and so does each AI reviewer, every page of it. A scan is read the same way. A file that doesn&apos;t open is left out.</p>
          </Help>
        </p>
        <p className="text-xs text-muted-foreground">RIS, BibTeX, EndNote, PubMed, Web of Science, CSV and PDF, any number at once</p>
        <input ref={input} type="file" multiple accept={UPLOAD_ACCEPT} className="sr-only" aria-label="Files to upload" onChange={(event) => { if (event.target.files) void take(event.target.files); event.target.value = ""; }} />
        <Button variant="outline" size="sm" className="mt-2" onClick={() => input.current?.click()}><Upload />Choose files</Button>
      </div>
      {reading.length || pending.length || sending.length ? (
        <div className="divide-y divide-border-subtle rounded-2xl bg-card ring-1 ring-border-subtle">
          {sending.map((one) => (
            <div key={one.batch} className="flex min-h-14 items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06]"><Spinner className="size-4" /></span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="truncate text-sm font-medium">{plural(one.total, "PDF", "PDFs")}</p>
                <Meter value={one.sent} max={one.total} />
              </div>
              <Chip><span className="tabular-nums">{num(one.sent)} of {num(one.total)} sent</span></Chip>
            </div>
          ))}
          {reading.map((name) => (
            <div key={name} className="flex min-h-14 items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06]"><Spinner className="size-4" /></span>
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
              <Chip>Reading it</Chip>
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
          <div className="min-w-0 flex-1 space-y-1">{refused.map((one) => <p key={one.name}><span className="font-medium">{one.name}</span>: {one.why}</p>)}</div>
          <TooltipHint label="Dismiss"><Button variant="ghost" size="icon" className="-my-1 size-7 shrink-0" aria-label="Dismiss" onClick={() => setRefused([])}><X /></Button></TooltipHint>
        </div>
      ) : null}
    </div>
  );
}

/** How a drop of PDFs stands, as chips on its source's row, each count arriving as the files are read: the papers the index holds, and the ones screened as the PDF they are. The files that don't open are among what the row says it left out. */
export function PdfFacts({ batch }: { batch: string }) {
  const drop = useProtectedQuery(api.screening.files.drop, inWorkspace(usePageWorkspace(), { batch })).data;
  if (!drop) return <Chip><Spinner className="size-3" />{PDF_STANDS.waiting}</Chip>;
  return (
    <>
      {drop.waiting ? <Chip><Spinner className="size-3" /><span className="tabular-nums">{num(drop.total - drop.waiting)} of {num(drop.total)} read</span></Chip> : null}
      {drop.known ? <Chip icon={Check}><span className="tabular-nums">{num(drop.known)}</span> in the index</Chip> : null}
      {drop.file ? <Chip icon={FileText}><span className="tabular-nums">{num(drop.file)}</span> screened as the PDF</Chip> : null}
    </>
  );
}

const FILES_PAGE = 8;
/** A drop's PDFs a page at a time, each under the title its first pages print, with how it stands. */
export function PdfFiles({ batch, total }: { batch: string; total: number }) {
  const rows = useCursorPage(api.screening.files.list, inWorkspace(usePageWorkspace(), { batch }), FILES_PAGE);
  return (
    <div className="space-y-2">
      <ul aria-label="The PDFs of this source" className={cn("divide-y divide-border-subtle transition-opacity", rows.isStale && "pointer-events-none opacity-60")} style={{ minHeight: Math.min(total, FILES_PAGE) * 45 }}>
        {rows.items.map((row) => {
          const stands = row.state === "read" ? (row.known ? "known" : "file") : row.state;
          return (
            <li key={row.id} className="flex min-h-11 items-center gap-x-3 gap-y-1 py-1.5 max-sm:flex-wrap">
              <div className="min-w-0 flex-1 max-sm:basis-full">
                <p className="truncate text-sm">{row.title ?? row.name}</p>
                {row.title ? <p className="truncate text-xs text-muted-foreground">{row.name}</p> : null}
              </div>
              {stands === "broken" ? <StateChip tone="warning" icon={FileX}>{PDF_STANDS.broken}</StateChip> : stands === "waiting" ? <Chip><Spinner className="size-3" />{PDF_STANDS.waiting}</Chip> : <Chip icon={stands === "known" ? Check : FileText}>{PDF_STANDS[stands]}{stands === "file" && row.pages ? `, ${plural(row.pages, "page", "pages")}` : ""}</Chip>}
            </li>
          );
        })}
      </ul>
      {rows.hasPages ? <CommandCenterPagination className="pt-1" currentPage={rows.page} itemLabel="PDFs" steps={{ canPrevious: rows.canPrevious, canNext: rows.canNext, onPrevious: rows.previous, onNext: rows.next, offset: rows.offset, shown: rows.items.length, total }} /> : null}
    </div>
  );
}

// ── Pasted DOIs ──────────────────────────────────────────────────────────────────────────────────

/** Pasted DOIs: found in whatever text holds them, looked up in the index, and added as one source. What the lookup didn't find, and what it found with no abstract, is said before anything is added. */
export function DoiTab({ sources, onAdd }: { sources: Source[]; onAdd: (added: Added) => void }) {
  const lookUp = useWorkspaceAction(api.screening.held.lookDois);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [missed, setMissed] = useState<{ missing: number; bare: number } | "twice" | null>(null);
  const { dois, repeats } = doisIn(text);
  // The same DOIs are the same source, in whatever order they were pasted.
  const ref = `dois:${hash([...dois].sort().join())}`;
  const run = async () => {
    if (sources.some((source) => source.ref === ref)) return setMissed("twice");
    setBusy(true);
    try {
      const { file, found, bare, missing } = await lookUp({ dois });
      // None of them can be screened: there is no source to add, and why is said here.
      if (!found) return setMissed({ missing, bare });
      onAdd({ ref, name: `${dois[0]}${dois.length > 1 ? ` and ${num(dois.length - 1)} more` : ""}`, detail: "Pasted DOIs", total: found + bare + missing, set: { kind: "dois", file }, filters: [...(bare ? [`${num(bare)} with no abstract`] : []), ...(missing ? [`${num(missing)} not found`] : [])] });
      setText("");
    } catch (error) {
      toast.error(getErrorMessage(error, "The DOIs couldn't be looked up. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <span className="flex items-center gap-1">
        <label htmlFor="dois" className="text-xs font-medium text-muted-foreground">DOIs</label>
        <Help title="Pasted DOIs" facts={<><HelpFact>Bare, as doi.org addresses, or inside a reference list</HelpFact><HelpFact>A DOI pasted twice is looked up once</HelpFact></>}>Openscholar looks each DOI up in its index and takes the paper&apos;s title and abstract from there. The ones it has no record of, and the ones whose record has no abstract, are left out and listed on the source&apos;s row once the screening has read it.</Help>
      </span>
      <Textarea id="dois" value={text} onChange={(event) => { setText(event.target.value); setMissed(null); }} rows={5} aria-invalid={Boolean(missed) || undefined} placeholder="Paste DOIs, or any text that holds them" className="bg-card text-sm" />
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex flex-wrap items-center gap-1.5">
          {missed === "twice" ? (
            <StateChip tone="warning" icon={TriangleAlert}>{dois.length === 1 ? "This DOI is already a source" : "These DOIs are already a source"}</StateChip>
          ) : missed ? (
            <>
              {missed.missing ? <StateChip tone="destructive" icon={TriangleAlert}>{missed.missing === 1 ? "1 DOI has no record" : `${num(missed.missing)} DOIs have no record`}</StateChip> : null}
              {missed.bare ? <StateChip tone="destructive" icon={TriangleAlert}>{missed.bare === 1 ? "1 paper has no abstract" : `${num(missed.bare)} papers have no abstract`}</StateChip> : null}
            </>
          ) : dois.length ? (
            <Chip icon={Hash}>{plural(dois.length, "DOI", "DOIs")}</Chip>
          ) : text.trim() ? (
            <StateChip tone="warning" icon={TriangleAlert}>No DOI in what you pasted</StateChip>
          ) : null}
          {repeats && !missed ? <Chip>{num(repeats)} pasted more than once</Chip> : null}
        </span>
        <Button variant="outline" size="sm" className="ms-auto" disabled={!dois.length || busy} onClick={() => void run()}>{busy ? <Spinner className="size-4" /> : <Plus />}Look up {dois.length ? plural(dois.length, "DOI", "DOIs") : "DOIs"}</Button>
      </div>
    </div>
  );
}

// ── Zotero ───────────────────────────────────────────────────────────────────────────────────────

type ZoteroLibrary = { id?: string; name: string; papers?: number };
type ZoteroCollection = { key: string; name: string; papers: number; inside: number };
/** The person's own library, which their account has without asking. */
const OWN: ZoteroLibrary = { name: "My library" };

/**
 * A Zotero account's libraries: the person's own and each group they are in. One is picked, then all of it or any
 * of its collections is added, a collection at a time. The list's first row is where it stands, the library or a
 * collection opened from it, with the way back up; under it are the collections there, a page of Zotero's at a time.
 */
export function ZoteroTab({ sources, onAdd }: { sources: Source[]; onAdd: (added: Added) => void }) {
  const account = useProtectedQuery(api.zotero.queries.getConnectionStatus, {}).data;
  const readGroups = useWorkspaceAction(api.screening.zoteroSources.groups);
  const readCollections = useWorkspaceAction(api.screening.zoteroSources.collections);
  const [library, setLibrary] = useState<ZoteroLibrary>(OWN);
  // The collections opened on the way to where the list stands, the last of them the one it stands in.
  const [path, setPath] = useState<ZoteroCollection[]>([]);
  const [page, setPage] = useState(1);
  const [deep, setDeep] = useState(true);
  const [picking, setPicking] = useState(false);
  const deepId = useId();
  const connected = account?.connected === true;
  const groups = useSWR(connected ? ["zotero-groups"] : null, () => readGroups({}), { revalidateOnFocus: false });
  const here = path.at(-1);
  const listed = useSWR(connected ? ["zotero-collections", library.id ?? "", here?.key ?? ""] : null, () => readCollections({ ...(library.id ? { groupId: library.id } : {}), ...(here ? { parent: here.key } : {}) }), { revalidateOnFocus: false, keepPreviousData: true });

  if (account === undefined) return <div className="flex min-h-40 items-center justify-center"><Spinner aria-label="Loading Zotero" className="size-5 text-primary" /></div>;
  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border bg-card px-6 py-7 text-center">
        <p className="text-sm font-medium">Zotero isn&apos;t connected</p>
        <p className="text-xs text-muted-foreground">Connect it to pick from your library and the groups you are in.</p>
        <Button asChild variant="outline" size="sm" className="mt-2"><NextLink href="/settings/connections"><ZoteroIcon />Connect Zotero</NextLink></Button>
      </div>
    );
  }

  const rows = listed.data?.page ?? [];
  const pager = pagerOf(rows.length, PAGE, page, setPage);
  const go = (next: ZoteroCollection[]) => { setPath(next); setPage(1); };
  const pick = (next: ZoteroLibrary) => { setLibrary(next); setPicking(false); go([]); };
  const refOf = (one?: ZoteroCollection, withUnder = false) => `zotero:${library.id ?? "me"}${one ? `:${one.key}` : ""}${withUnder ? ":deep" : ""}`;
  const under = (one: ZoteroCollection) => deep && one.inside > 0;
  const added = (one?: ZoteroCollection) => sources.some((source) => source.ref === refOf(one) || source.ref === refOf(one, true));
  const add = (one: ZoteroCollection, above: ZoteroCollection[]) =>
    onAdd({ ref: refOf(one, under(one)), name: one.name, detail: `In ${library.name}`, total: one.papers, filters: [...(above.length ? [`In ${above.map((step) => step.name).join(" › ")}`] : []), ...(under(one) ? ["With its sub-collections"] : [])], set: { kind: "zotero", ...(library.id ? { groupId: library.id } : {}), collectionKey: one.key, ...(under(one) ? { deep: true } : {}) } });
  const LibraryIcon = library.id ? Users : UserRound;
  const option = (one: ZoteroLibrary) => {
    const Icon = one.id ? Users : UserRound;
    return (
      <CommandItem key={one.id ?? "me"} value={one.name} onSelect={() => pick(one)} className="gap-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{one.name}</span>
        {one.papers === undefined ? null : <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{plural(one.papers, "item", "items")}</span>}
        {one.id === library.id ? <Check className="size-4 shrink-0 text-primary" /> : null}
      </CommandItem>
    );
  };
  const step = "rounded-sm underline decoration-foreground/25 underline-offset-2 outline-none transition-colors hover:text-foreground hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <div className="space-y-2">
      <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={picking} aria-label="Zotero library" className="h-9 w-full min-w-0 justify-between gap-3 bg-card px-3 font-normal">
            <span className="flex min-w-0 items-center gap-2"><LibraryIcon className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{library.name}</span></span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label="Zotero library" className="w-(--radix-popover-trigger-width) p-0">
          <Command>
            <CommandList className="max-h-72">
              <CommandGroup heading="Yours">{option(OWN)}</CommandGroup>
              {groups.data?.page.length ? <CommandGroup heading="Groups">{groups.data.page.map(option)}</CommandGroup> : null}
            </CommandList>
          </Command>
          <p className="flex items-center justify-between gap-3 border-t border-border-subtle px-3 py-2 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5"><ZoteroIcon className="size-3.5 shrink-0" /><span className="truncate">Connected{account.username ? ` as ${account.username}` : ""}</span></span>
            <NextLink href="/settings/connections" className={cn(INLINE_LINK, "shrink-0")}>Connections</NextLink>
          </p>
        </PopoverContent>
      </Popover>
      <span className="flex items-center gap-1">
        <label htmlFor={deepId} className="flex items-center gap-2 text-xs font-medium"><Switch id={deepId} checked={deep} onCheckedChange={setDeep} />Include sub-collections</label>
        <Help title="Sub-collections" facts={<HelpFact>A paper filed in two of them is taken once</HelpFact>}>Zotero counts only the items filed directly in a collection, and so does the count here. With this on, a collection is added with the papers of every collection under it, which are counted as the screening reads them.</Help>
      </span>
      <div className={cn("divide-y divide-border-subtle transition-opacity", listed.isValidating && listed.data && "opacity-60")}>
        {/* Where the list stands: all of the library, or the collection opened from it with the steps that lead back up. It can be added as it is. */}
        {here ? (
          <OfferRow
            offer={{ name: here.name, detail: "", total: here.papers }}
            icon={Folder}
            trail={
              <FadeRow scrolls scrollbar="none" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <button type="button" onClick={() => go([])} className={cn(step, "shrink-0")}>{library.name}</button>
                {path.slice(0, -1).map((one, at) => (
                  <span key={one.key} className="flex shrink-0 items-center gap-1"><ChevronRight aria-hidden className="size-3" /><button type="button" onClick={() => go(path.slice(0, at + 1))} className={step}>{one.name}</button></span>
                ))}
              </FadeRow>
            }
            added={added(here)}
            onAdd={() => add(here, path.slice(0, -1))}
            count={here.papers > 0 || !under(here)}
          />
        ) : (
          <OfferRow
            offer={{ name: `Every paper in ${library.name}`, detail: library.id ? "Zotero group" : "Your Zotero library", total: library.papers ?? 0 }}
            icon={Library}
            added={added()}
            count={library.papers !== undefined}
            onAdd={() => onAdd({ ref: refOf(), name: library.name, detail: library.id ? "Zotero group" : "Your Zotero library", total: library.papers ?? 0, filters: ["Whole library"], set: { kind: "zotero", ...(library.id ? { groupId: library.id } : {}) } })}
          />
        )}
        <div className="divide-y divide-border-subtle" style={{ minHeight: !listed.data || pager.pages > 1 ? PAGE * ROW : undefined }}>
          {rows.slice((pager.page - 1) * PAGE, pager.page * PAGE).map((one) => (
            <OfferRow
              key={one.key}
              offer={{ name: one.name, detail: one.inside ? plural(one.inside, "sub-collection", "sub-collections") : "", total: one.papers }}
              icon={Folder}
              added={added(one)}
              count={one.papers > 0 || !under(one)}
              onOpen={one.inside ? () => go([...path, one]) : undefined}
              onAdd={() => add(one, path)}
            />
          ))}
          {listed.data && !rows.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{here ? `${here.name} holds no collections.` : `${library.name} has no collections.`}</p> : null}
          {listed.error ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{getErrorMessage(listed.error, "Zotero couldn't be read. Try again.")}</p> : null}
        </div>
      </div>
      {pager.pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={pager.page} totalPages={pager.pages} onPageChange={setPage} totalItems={rows.length} itemsPerPage={PAGE} itemLabel="collections" /> : null}
      {/* ponytail: a level shows Zotero's first hundred collections; read on with `next` when a level that large is met. */}
      {listed.data?.next !== undefined ? <p className="text-xs text-muted-foreground">Showing the first {num(rows.length)} collections here.</p> : null}
    </div>
  );
}

// ── Communities ──────────────────────────────────────────────────────────────────────────────────

/** A community's collections, searches and records, picked from the list every other form of the app uses for them. */
export function CommunityTab({ sources, onAdd }: { sources: Source[]; onAdd: (added: Added) => void }) {
  const libraries = useLibrarySources();
  const added = (ref: string) => sources.some((source) => source.ref === ref);
  const add = (row: Parameters<typeof rowKey>[0] & { label: string; records: number; what: string }, library: { name: string }) => {
    const ref = `evidenceLibrary:${rowKey(row)}`;
    if (!added(ref)) onAdd({ ref, name: row.label, detail: `In ${library.name}`, total: row.records, set: setOfRow(row as Parameters<typeof setOfRow>[0]) as SourceSet });
  };
  return <LibrarySources state={libraries} isOn={(row) => added(`evidenceLibrary:${rowKey(row)}`)} onToggle={(row, library) => add(row, library)} onPasted={(held) => add(held.row, held.library)} scope={() => null} />;
}
