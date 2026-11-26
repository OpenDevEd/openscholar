"use client";
"use no memo"; // What is drawn follows two browser observers: the column's width and which pages are near the screen.

/**
 * A paper's own PDF, drawn in the page: what a paper with no abstract is screened on. Its pages stack in the paper's
 * column and scroll with it, each drawn by pdf.js while it is near the screen, so a long report costs what is looked
 * at. The browser's own viewer isn't used: a phone shows one page of an embedded PDF, or none (WebKit bug 253671;
 * Chrome for Android has no built-in viewer).
 */
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ExternalLink, FileText } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { pdfAssets } from "@/lib/pdf-assets";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace as usePageWorkspace } from "@/lib/workspaces/url";
import { AS_PDF, plural, termsPattern, type Paper } from "./data";
import { Chip } from "./parts";
import { INLINE_LINK } from "./pieces";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
/** One object for every document: react-pdf loads a PDF again when its options change. */
const PDF_OPTIONS = pdfAssets(pdfjs.version);
/** A page's height for its width until the file says its own: A4's. */
const A4 = 1.414;
const GAP = 8;
const escaped = (text: string) => text.replace(/[&<>]/g, (sign) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[sign]!);

export default function PaperPdf({ id, paper, terms }: { id: Id<"screeningJobs">; paper: Pick<Paper, "id" | "title" | "pdf">; /** The words the criteria mark, which stand out on the pages as they do in an abstract. */ terms: string[] }) {
  const url = useProtectedQuery(api.screening.paperViews.pdf, inWorkspace(usePageWorkspace(), { jobId: id, paperId: paper.id })).data;
  const column = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // A page is drawn as wide as its column: the width comes from the browser's own measure of it.
  useEffect(() => {
    const node = column.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // How many pages, and their shape, as the server counted them until the file itself says.
  const [read, setRead] = useState<{ of: Id<"screeningResults">; pages: number; shape: number } | null>(null);
  const { pages, shape } = read?.of === paper.id ? read : { pages: paper.pdf?.pages ?? 1, shape: A4 };
  const pattern = termsPattern(terms);
  const mark = pattern ? ({ str }: { str: string }) => str.split(pattern).map((part, i) => (i % 2 ? `<mark class="rounded-sm bg-primary/25 text-transparent">${escaped(part)}</mark>` : escaped(part))).join("") : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Chip icon={FileText}>{AS_PDF}{paper.pdf?.pages ? `, ${plural(paper.pdf.pages, "page", "pages")}` : ""}</Chip>
        {url ? <a href={url} target="_blank" rel="noreferrer" className={cn(INLINE_LINK, "inline-flex items-center gap-1 text-xs")}>Open the PDF in a new tab<ExternalLink aria-hidden className="size-3" /></a> : null}
      </div>
      {/* The column holds its pages' height from the first frame: each page arrives inside its own place. */}
      <div ref={column} style={{ minHeight: width ? pages * (Math.round(width * shape) + GAP) - GAP : undefined }}>
        {url && width ? (
          <Document
            key={paper.id}
            file={url}
            options={PDF_OPTIONS}
            loading={null}
            error={<p className="rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">This PDF can&apos;t be shown here. Open it in a new tab.</p>}
            onLoadSuccess={(file) => void file.getPage(1).then((first) => { const view = first.getViewport({ scale: 1 }); setRead({ of: paper.id, pages: file.numPages, shape: view.height / view.width }); })}
            className="flex flex-col"
          >
            {Array.from({ length: pages }, (_, i) => <PdfPage key={i} number={i + 1} width={width} shape={shape} mark={mark} />)}
          </Document>
        ) : null}
      </div>
    </div>
  );
}

/** One page, in the place it holds whether or not it is drawn: drawn while it is within a screen of the one in view. */
function PdfPage({ number, width, shape, mark }: { number: number; width: number; shape: number; mark?: (text: { str: string }) => string }) {
  const place = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(number <= 2);
  // Whether the page is near the screen is the browser's to say.
  useEffect(() => {
    const node = place.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry!.isIntersecting), { rootMargin: "100% 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={place} style={{ minHeight: Math.round(width * shape), marginTop: number > 1 ? GAP : 0 }} className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-border-subtle">
      {near ? <Page pageNumber={number} width={width} renderAnnotationLayer={false} customTextRenderer={mark} loading={null} className="animate-in fade-in duration-300" /> : null}
    </div>
  );
}
