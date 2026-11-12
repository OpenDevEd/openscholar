"use client";

import { useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight, FileText } from "@/components/icons";
import { cn } from "@/lib/utils";
import { FadeImage } from "@/components/ui/fade-image";
import { coverFit, resizable, type CoverKind } from "@/lib/papers/cover";

type CoverProps = { kind: CoverKind; ink: string; title: string; authors: string[]; source: string | null; year: number | null; type: string | null };

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
function TitlePage({ kind, title, authors, source, year, type }: Omit<CoverProps, "ink">) {
  if (kind === "report") return (
    <span className="flex h-full flex-col bg-[#fbf8f2]">
      <span className="flex h-[58%] flex-col justify-end bg-(--ink) p-[9%] text-white">
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
        <span className="-rotate-90 whitespace-nowrap text-[4.4cqw] font-medium tracking-wide text-(--ink)">{[type?.replace(/-/g, " "), year].filter(Boolean).join("  ")}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-center p-[8%] text-center">
        <span className="mt-[4cqw] line-clamp-4 font-serif text-[7.6cqw] font-semibold leading-[1.18]">{title}</span>
        {authors.length ? <span className="mt-[4cqw] line-clamp-2 text-[4.4cqw] text-[#2b2521]/65">{authorsLine(authors)}</span> : null}
        <span className="mt-[6cqw] w-[86%] rounded-[1.5cqw] bg-[#2b2521]/[0.04] p-[5%]"><Lines widths={["100%", "100%", "94%", "70%"]} /></span>
        <Lines className="mt-auto w-full" widths={["100%", "100%", "88%"]} />
      </span>
    </span>
  );
  if (kind === "monograph") return (
    // A book's title page: the title centred between ruled lines, the year at its foot.
    <span className="flex h-full flex-col items-center bg-[#f8f4ec] p-[10%] text-center text-[#2b2521]">
      <span className="w-full border-y-[0.8cqw] border-double border-(--ink) py-[1.5cqw] text-[4.2cqw] tracking-wide text-[#2b2521]/60">{source ?? type?.replace(/-/g, " ")}</span>
      <span className="my-auto line-clamp-5 font-serif text-[8.4cqw] font-semibold leading-[1.15]">{title}</span>
      {authors.length ? <span className="line-clamp-2 text-[4.6cqw] italic text-[#2b2521]/70">{authorsLine(authors)}</span> : null}
      <span className="mt-[5cqw] h-[0.6cqw] w-1/5 bg-(--ink)" />
      {year ? <span className="mt-[3cqw] text-[4.6cqw] tabular-nums text-[#2b2521]/60">{year}</span> : null}
    </span>
  );
  if (kind === "bulletin") return (
    // A bulletin's cover: a band of the ink down the spine with the year, the title set large beside it.
    <span className="flex h-full bg-[#fbf8f2] text-[#2b2521]">
      <span className="flex w-[18%] shrink-0 flex-col items-center justify-end bg-(--ink) pb-[8cqw]">
        {year ? <span className="-rotate-90 whitespace-nowrap text-[6cqw] font-semibold tabular-nums text-white/90">{year}</span> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col p-[8%]">
        {source ? <span className="truncate text-[4.4cqw] font-medium text-(--ink)">{source}</span> : null}
        <span className="mt-[5cqw] line-clamp-6 text-[8.4cqw] font-bold leading-[1.1] tracking-tight">{title}</span>
        {authors.length ? <span className="mt-[4cqw] line-clamp-2 text-[4.4cqw] leading-snug text-[#2b2521]/65">{authorsLine(authors)}</span> : null}
        <Lines className="mt-auto" widths={["100%", "100%", "80%"]} />
      </span>
    </span>
  );
  return (
    <span className="flex h-full flex-col bg-[#fbf8f2] p-[9%] text-[#2b2521]">
      <span className="flex items-center justify-between gap-[3cqw] border-b border-[#2b2521]/15 pb-[3cqw] text-[4.4cqw] text-[#2b2521]/60">
        <span className="min-w-0 truncate italic">{source}</span>
        {year ? <span className="shrink-0 tabular-nums">{year}</span> : null}
      </span>
      <span className="mt-[2cqw] h-[1.8cqw] w-1/4 rounded-full bg-(--ink)" />
      <span className="mt-[5cqw] line-clamp-5 font-serif text-[8cqw] font-semibold leading-[1.16] tracking-tight">{title}</span>
      {authors.length ? <span className="mt-[3.5cqw] line-clamp-2 text-[4.4cqw] leading-snug text-[#2b2521]/70">{authorsLine(authors)}</span> : null}
      <Lines className="mt-[5cqw] border-s-[1.2cqw] border-(--ink)/40 ps-[4cqw]" widths={["100%", "96%", "72%"]} />
      {/* Two columns of body text, as a journal sets its first page. */}
      <span className="mt-auto grid grid-cols-2 gap-[5cqw]">
        <Lines widths={["100%", "100%", "92%"]} />
        <Lines widths={["100%", "96%", "60%"]} />
      </span>
    </span>
  );
}

/**
 * A paper's cover: the real first page when a community or Openscholar made a picture of it, otherwise a title page.
 * It opens the PDF, or the publisher's page when there is none. A PDF says so in a frosted chip; a page elsewhere carries
 * the open-elsewhere mark.
 *
 * The cover keeps a frame 3 wide by 4 tall wherever it is shown, so nothing around it moves as a picture loads. A picture
 * shaped like a page fills the frame. One of another shape, such as a slide, is shown whole at its own shape inside it
 * (`coverFit`): at the frame's top and start, or in its middle where a list asks (`center`).
 */
export function PaperCover({ href, pdf, image, className, ink, center = false, mark = true, sizes = "(min-width: 1024px) 200px, (min-width: 640px) 150px, 112px", ...page }: CoverProps & {
  href: string | null;
  pdf: boolean;
  image: string | null;
  className?: string;
  /** A picture that isn't shaped like a page sits in the middle of the frame, as a row of a list wants it. */
  center?: boolean;
  /** The PDF chip or the open-elsewhere mark on the cover; a cover too small to carry one leaves it off. */
  mark?: boolean;
  /** How wide the cover is shown, for a community's full-size picture to be resized to. */
  sizes?: string;
}) {
  const t = useTranslations("paperPage");
  // The picture's width over its height, once it has loaded, and the picture that couldn't be: each kept with the
  // address it is of, so another paper's picture in the same place starts anew.
  const [shaped, setShaped] = useState<{ image: string; shape: number } | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const picture = image && broken !== image ? image : null;
  const shape = picture && shaped?.image === picture ? shaped.shape : null;
  const fit = coverFit(shape);
  const sheet = (
    <span className={cn("flex aspect-[3/4]", center ? "items-center justify-center" : "items-start justify-start")}>
      <span
        style={{ "--ink": ink, ...(fit !== "fill" && { aspectRatio: shape! }) } as CSSProperties}
        className={cn(
          "@container relative block overflow-hidden rounded-md bg-[#fbf8f2] shadow-[0_1px_2px_rgb(0_0_0/0.06),0_8px_24px_-6px_rgb(0_0_0/0.18)] ring-1 ring-black/[0.06] transition-[translate,box-shadow,opacity] duration-200 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_2px_4px_rgb(0_0_0/0.06),0_16px_36px_-8px_rgb(0_0_0/0.24)] motion-reduce:transition-none dark:brightness-[0.94]",
          fit === "fill" ? "size-full" : fit === "wide" ? "w-full" : "h-full",
          // The sheet shows with its picture, at the picture's shape: an empty one would change shape as the picture arrives.
          picture && shape === null && "opacity-0",
        )}
      >
        {picture ? (
          <FadeImage
            src={picture}
            sizes={resizable(picture) ? sizes : undefined}
            className="size-full object-cover object-top"
            onShape={(loaded) => setShaped((was) => (was?.image === picture && was.shape === loaded ? was : { image: picture, shape: loaded }))}
            onFailed={() => setBroken(picture)}
          />
        ) : (
          <TitlePage {...page} />
        )}
        {href && mark ? (
          <span className="absolute bottom-2.5 end-2.5 inline-flex h-6 items-center gap-1 rounded-full bg-black/60 px-2 text-[11px] font-medium text-white backdrop-blur-md">
            {pdf ? <><FileText aria-hidden className="size-3" />{t("pdf")}</> : <ArrowUpRight aria-hidden className="size-3.5" />}
          </span>
        ) : null}
      </span>
    </span>
  );
  if (!href) return <span aria-hidden className={cn("block", className)}>{sheet}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={pdf ? t("readPdf") : t("publisherPage")} className={cn("group block rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring", className)}>
      {sheet}
    </a>
  );
}
