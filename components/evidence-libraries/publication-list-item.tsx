"use client";

import { ArrowUpRight, FileText, Library } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { AuthorPublication } from "@/components/authors/types";

export function PublicationMetadata({year, type, className}: Pick<AuthorPublication, "year" | "type"> & {className: string}) {
  const publicationYear = year.trim();
  const publicationType = type.trim();
  if (!publicationYear && !publicationType) return null;
  return <span className={className}>
    {publicationYear && <span className="font-medium tabular-nums">{publicationYear}</span>}
    {publicationType && <span className="inline-flex items-center gap-1.5">
      <FileText aria-hidden className="size-3" />{publicationType}
    </span>}
  </span>;
}

export function PublicationListItem({ publication: p, locations }: {
  publication: AuthorPublication;
  locations?: { name: string; url: string }[];
}) {
  return (
    <article
      className="group grid grid-cols-[64px_minmax(0,1fr)] items-center gap-4 border-b border-border/50 px-4 py-4 transition-colors hover:bg-muted/20 last:border-b-0 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:gap-6"
    >
      <button
        className="rounded-sm outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`Preview ${p.title} cover`}
        onClick={() => window.open(p.url, "_blank", "noopener,noreferrer")}
      >
        <Avatar className="h-[92px] w-16 rounded-sm border border-border/50 shadow-sm transition-transform group-hover:-translate-y-0.5 sm:h-28 sm:w-20">
          <AvatarImage
            src={p.cover}
            alt=""
            className="object-cover"
          />
          <AvatarFallback className="rounded-none bg-muted/30">
            <FileText className="size-6 text-muted-foreground/50" />
          </AvatarFallback>
        </Avatar>
      </button>
      <div className="min-w-0">
        <PublicationMetadata year={p.year} type={p.type} className="mb-2 flex items-center gap-2 text-xs text-muted-foreground" />
        <button
          className="text-left text-base font-semibold leading-snug hover:text-primary sm:text-lg"
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
        aria-label={`Preview ${p.title}`}
        onClick={() => window.open(p.url, "_blank", "noopener,noreferrer")}
      >
        <ArrowUpRight />
      </Button>
    </article>
  );
}
