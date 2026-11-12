"use client";

import { useTranslations } from "next-intl";
import { ArrowUpRight, FileText, FileX, Library } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { PaperCover } from "@/components/papers/paper-cover";
import { coverOf } from "@/lib/papers/cover";
import { cn } from "@/lib/utils";
import type { AuthorPublication } from "@/components/authors/types";
import { typeName } from "@/lib/evidence-libraries/reader-sources";
import Link from "@/components/workspace-link";
import { LogoMark } from "@/components/logo";

export function PublicationMetadata({year, type, className}: Pick<AuthorPublication, "year" | "type"> & {className: string}) {
  const publicationYear = year.trim();
  const publicationType = typeName(type.trim());
  if (!publicationYear && !publicationType) return null;
  return <span className={className}>
    {publicationYear && <span className="font-medium tabular-nums">{publicationYear}</span>}
    {publicationType && <span className="inline-flex items-center gap-1.5">
      <FileText aria-hidden className="size-3" />{publicationType}
    </span>}
  </span>;
}

/** A topic record's paper page, from the key it's grouped by: its DOI, or its OpenAlex work. */
function pageOf(id: string) {
  if (id.startsWith("doi:")) return `/papers/doi/${id.slice(4).split("/").map(encodeURIComponent).join("/")}`;
  if (id.startsWith("openalex:W")) return `/papers/${id.slice(9)}`;
  return null;
}

/** Whether a publication has a cover to show: a picture of its PDF's first page, or a PDF to stand a title page in for. */
const covered = (p: Pick<AuthorPublication, "cover" | "pdf">) => !!p.cover || !!p.pdf;

/**
 * A publication's cover in a list, as wide as its place. The picture of its PDF's first page when a community made one,
 * at the picture's own shape. A title page when it has a PDF and no picture of it. Without a PDF, a quiet tile that says
 * so; one whose community hasn't said either way claims nothing.
 */
export function PublicationCover({ publication: p, className }: { publication: Pick<AuthorPublication, "id" | "title" | "type" | "year" | "authors" | "cover" | "pdf" | "library">; className?: string }) {
  const t = useTranslations("libraryList");
  if (covered(p)) {
    return (
      <PaperCover
        className={className}
        {...coverOf(p.id)}
        title={p.title}
        authors={p.authors ? p.authors.split(", ") : []}
        source={p.library.name}
        year={Number(p.year) || null}
        type={typeName(p.type.trim()) || null}
        image={p.cover ?? null}
        // The row's own button opens it; a cover this small carries no mark.
        href={null}
        pdf={false}
        mark={false}
        center
        sizes="80px"
      />
    );
  }
  return (
    <span className={cn("@container flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-md bg-inset text-muted-foreground", className)}>
      {p.pdf === null ? (
        <>
          <FileX aria-hidden className="size-4 opacity-70" />
          {/* On a cover too narrow for the words, the mark says it alone. */}
          <span className="hidden text-center text-[10px] font-medium leading-tight @[56px]:block">{t("noPdf")}</span>
          <span className="sr-only @[56px]:hidden">{t("noPdf")}</span>
        </>
      ) : (
        <FileText aria-hidden className="size-4 opacity-50" />
      )}
    </span>
  );
}

export function PublicationListItem({ publication: p, locations }: {
  publication: AuthorPublication;
  locations?: { name: string; url: string }[];
}) {
  const t = useTranslations("libraryList");
  const tSite = useTranslations("metadata");
  return (
    <article
      className="fade-enter group grid grid-cols-[64px_minmax(0,1fr)] items-center gap-4 border-b border-border-subtle px-4 py-4 transition-colors hover:bg-muted last:border-b-0 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:gap-6"
    >
      {/* The cover opens the record, as its title does. Without a PDF there is no cover to open: the title is the way in. */}
      {covered(p) ? (
        <button
          className="block w-full rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={t("previewCover", { title: p.title })}
          onClick={() => window.open(p.url, "_blank", "noopener,noreferrer")}
        >
          <PublicationCover publication={p} />
        </button>
      ) : (
        <PublicationCover publication={p} />
      )}
      <div className="min-w-0">
        <PublicationMetadata year={p.year} type={p.type} className="mb-2 flex items-center gap-2 text-xs text-muted-foreground" />
        <button
          className="text-start text-base font-semibold leading-snug hover:text-primary sm:text-lg"
          onClick={() => window.open(p.url, "_blank", "noopener,noreferrer")}
        >
          {p.title}
        </button>
        <p className="mt-2 text-sm text-muted-foreground">
          {p.authors}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(locations ?? [p.library]).map(location => <a
            key={location.url}
            href={location.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground"
          >
            <Library className="size-3" />
            {location.name}
          </a>)}
          {/* The paper's page here, when the record names the paper: a reader can open it, and a crawler reaches it from the topic. */}
          {pageOf(p.id) && <Link href={pageOf(p.id)!} className="flex items-center gap-1.5 hover:text-foreground">
            <LogoMark className="size-3" />
            {tSite("siteName")}
          </Link>}
          {p.pages !== undefined && <span className="flex items-center gap-1.5">
            <FileText className="size-3" />
            <span>PDF</span>
            <span>{p.pages} pages</span>
          </span>}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="hidden sm:inline-flex"
        aria-label={t("preview", { title: p.title })}
        onClick={() => window.open(p.url, "_blank", "noopener,noreferrer")}
      >
        <ArrowUpRight />
      </Button>
    </article>
  );
}
