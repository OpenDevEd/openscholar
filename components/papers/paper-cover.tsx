"use client";

import { useTranslations } from "next-intl";
import { ArrowUpRight, FileText } from "@/components/icons";
import { cn } from "@/lib/utils";

/** The three title pages a paper without a picture of its own first page can wear. */
export const COVER_KINDS = ["journal", "preprint", "report"] as const;
export type CoverKind = (typeof COVER_KINDS)[number];

/** Which title page suits a kind of work: a journal's first page, a preprint's, or a report's cover. */
export function coverKindOf(type: string | null | undefined): CoverKind {
  if (!type) return "journal";
  if (/preprint|posted|other/.test(type)) return "preprint";
  if (/report|book|dissertation|dataset|standard|monograph/.test(type)) return "report";
  return "journal";
}

type CoverProps = { kind: CoverKind; title: string; authors: string[]; source: string | null; year: number | null; type: string | null };

/** Grey bars standing for lines of text, as long as the widths say. */
function Lines({ widths, className }: { widths: string[]; className?: string }) {
  return (
    <span className={cn("flex flex-col gap-[2.6cqw]", className)}>
      {widths.map((width, index) => <span key={index} className="h-[1.6cqw] rounded-full bg-[#2b2521]/[0.10]" style={{ width }} />)}
    </span>
  );
}

const authorsLine = (authors: string[]) => (authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", "));

/** A paper's first page, typeset from what the page knows: no picture of the real one, but plainly a document to open. */
function TitlePage({ kind, title, authors, source, year, type }: CoverProps) {
  if (kind === "report") return (
    <span className="flex h-full flex-col bg-[#fbf8f2]">
      <span className="flex h-[58%] flex-col justify-end bg-primary p-[9%] text-primary-foreground">
        {year ? <span className="text-[6cqw] font-medium opacity-80">{year}</span> : null}
        <span className="mt-[3cqw] line-clamp-5 text-[8.6cqw] font-semibold leading-[1.14] tracking-tight">{title}</span>
      </span>
      <span className="flex flex-1 flex-col p-[9%]">
        {authors.length ? <span className="line-clamp-2 text-[5cqw] leading-snug text-[#2b2521]/70">{authorsLine(authors)}</span> : null}
        <Lines className="mt-auto" widths={["100%", "92%", "64%"]} />
        {source ? <span className="mt-[5cqw] truncate text-[4.6cqw] font-medium text-[#2b2521]/55">{source}</span> : null}
      </span>
    </span>
  );
  if (kind === "preprint") return (
    <span className="relative flex h-full bg-[#fbfaf7] text-[#2b2521]">
      {/* The side line a preprint server stamps on its first page. */}
      <span className="flex w-[11%] shrink-0 items-center justify-center border-e border-[#2b2521]/[0.08]">
        <span className="-rotate-90 whitespace-nowrap text-[4.4cqw] font-medium tracking-wide text-[#2b2521]/45">{[type?.replace(/-/g, " "), year].filter(Boolean).join("  ")}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-center p-[8%] text-center">
        <span className="mt-[4cqw] line-clamp-4 font-serif text-[7.6cqw] font-semibold leading-[1.18]">{title}</span>
        {authors.length ? <span className="mt-[4cqw] line-clamp-2 text-[4.4cqw] text-[#2b2521]/65">{authorsLine(authors)}</span> : null}
        <span className="mt-[6cqw] w-[86%] rounded-[1.5cqw] bg-[#2b2521]/[0.04] p-[5%]"><Lines widths={["100%", "100%", "94%", "70%"]} /></span>
        <Lines className="mt-auto w-full" widths={["100%", "100%", "88%"]} />
      </span>
    </span>
  );
  return (
    <span className="flex h-full flex-col bg-[#fbf8f2] p-[9%] text-[#2b2521]">
      <span className="flex items-center justify-between gap-[3cqw] border-b border-[#2b2521]/15 pb-[3cqw] text-[4.4cqw] text-[#2b2521]/60">
        <span className="min-w-0 truncate italic">{source}</span>
        {year ? <span className="shrink-0 tabular-nums">{year}</span> : null}
      </span>
      <span className="mt-[2cqw] h-[1.8cqw] w-1/4 rounded-full bg-primary" />
      <span className="mt-[5cqw] line-clamp-5 font-serif text-[8cqw] font-semibold leading-[1.16] tracking-tight">{title}</span>
      {authors.length ? <span className="mt-[3.5cqw] line-clamp-2 text-[4.4cqw] leading-snug text-[#2b2521]/70">{authorsLine(authors)}</span> : null}
      <Lines className="mt-[5cqw] border-s-[1.2cqw] border-primary/40 ps-[4cqw]" widths={["100%", "96%", "72%"]} />
      {/* Two columns of body text, as a journal sets its first page. */}
      <span className="mt-auto grid grid-cols-2 gap-[5cqw]">
        <Lines widths={["100%", "100%", "92%"]} />
        <Lines widths={["100%", "96%", "60%"]} />
      </span>
    </span>
  );
}

/**
 * The paper's cover in its page's intro: the real first page when a community made a picture of it, otherwise a title page.
 * It opens the PDF, or the publisher's page when there is none. A PDF says so in a frosted chip; a page elsewhere carries
 * the open-elsewhere mark.
 */
export function PaperCover({ href, pdf, image, className, ...page }: CoverProps & { href: string | null; pdf: boolean; image: string | null; className?: string }) {
  const t = useTranslations("paperPage");
  const sheet = (
    <span className="@container block aspect-[3/4] overflow-hidden rounded-md bg-[#fbf8f2] shadow-[0_1px_2px_rgb(0_0_0/0.06),0_8px_24px_-6px_rgb(0_0_0/0.18)] ring-1 ring-black/[0.06] transition-[translate,box-shadow] duration-200 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_2px_4px_rgb(0_0_0/0.06),0_16px_36px_-8px_rgb(0_0_0/0.24)] motion-reduce:transition-none dark:brightness-[0.94]">
      {/* eslint-disable-next-line @next/next/no-img-element -- a community's own storage, at the size it made */}
      {image ? <img src={image} alt="" className="size-full object-cover object-top" /> : <TitlePage {...page} />}
    </span>
  );
  if (!href) return <span aria-hidden className={cn("block", className)}>{sheet}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={pdf ? t("readPdf") : t("publisherPage")} className={cn("group relative block rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring", className)}>
      {sheet}
      <span className="absolute bottom-2.5 end-2.5 inline-flex h-6 items-center gap-1 rounded-full bg-black/60 px-2 text-[11px] font-medium text-white backdrop-blur-md transition-transform duration-200 ease-out group-hover:-translate-y-1 motion-reduce:transition-none">
        {pdf ? <><FileText aria-hidden className="size-3" />{t("pdf")}</> : <ArrowUpRight aria-hidden className="size-3.5" />}
      </span>
    </a>
  );
}
