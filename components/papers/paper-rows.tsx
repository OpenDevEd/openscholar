"use client";

import { useFormatter } from "next-intl";
import Link from "@/components/workspace-link";
import { Quote } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { SimilarPaper } from "@/app/actions/similar";

type RowLink = { href: string; external?: boolean; onNavigate?: () => void };

/** Papers as a list of titles, each with its year and citations: the focus mode sheet's similar papers and a paper page's lists. */
export function PaperRows({ papers, link, className }: { papers: SimilarPaper[]; link: (paper: SimilarPaper) => RowLink; className?: string }) {
  const format = useFormatter();
  return (
    <ol className={cn("divide-y divide-border-subtle", className)}>
      {papers.map((paper) => {
        const { href, external, onNavigate } = link(paper);
        return (
          <li key={paper.id} className="flex items-baseline justify-between gap-4 py-2 text-sm">
            {external
              ? <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 hover:underline">{paper.title}</a>
              : <Link href={href} onNavigate={onNavigate} className="min-w-0 hover:underline">{paper.title}</Link>}
            <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground">
              {paper.year ? <span>{paper.year}</span> : null}
              <span className="flex items-center gap-1"><Quote aria-hidden className="size-3" />{format.number(paper.citations)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
