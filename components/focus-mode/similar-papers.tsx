"use client";

import useSWR from "swr";
import { useFormatter, useTranslations } from "next-intl";
import { useCloseFocus } from "@/components/entity-cards";
import { Compass, Quote } from "@/components/icons";
import { readSimilarPapers, type SimilarPaper } from "@/app/actions/similar";
import { paperPath } from "@/lib/papers/page-address";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import Link from "@/components/workspace-link";
import { unlessLimited } from "@/lib/openalex/limited";
import { similarSearchHref } from "@/lib/search/similar-href";

const SHOWN = 8;

/**
 * The papers closest in meaning to the open one. It holds its height while they're read, so nothing moves.
 * A paper's page gives the list it read on the server as `initial`, and each row then opens that paper's page.
 */
export function SimilarPapers({ paperId, initial }: { paperId: string; initial?: SimilarPaper[] }) {
  const format = useFormatter();
  const t = useTranslations("similarPapers");
  const closeFocus = useCloseFocus();
  const { data, error, isLoading } = useSWR(["similar-papers", paperId], ([, id]) => unlessLimited(readSimilarPapers(id, SHOWN)), { revalidateOnFocus: false, fallbackData: initial, revalidateOnMount: !initial });
  return (
    <section aria-label={t("title")} className="border-t pt-2">
      <div className="mb-1 flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{t("title")}</h3>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" asChild>
          <Link href={similarSearchHref([paperId]) ?? "/results"} onNavigate={closeFocus}>
            <Compass className="h-3.5 w-3.5" />
            {t("seeAll")}
          </Link>
        </Button>
      </div>
      <div className={initial ? undefined : "min-h-88"}>
        {isLoading ? (
          <div className="flex h-88 items-center justify-center text-muted-foreground"><Spinner aria-label={t("finding")} /></div>
        ) : error ? (
          <p className="py-2 text-sm text-muted-foreground">{t("failed")}</p>
        ) : !data?.length ? (
          <p className="py-2 text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ol className="fade-enter divide-y divide-border-subtle">
            {data.map((paper) => (
              <li key={paper.id} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                {initial ? (
                  <Link href={paperPath(paper.id.split("/").at(-1)!, paper.title)} className="min-w-0 hover:underline">{paper.title}</Link>
                ) : paper.doi ? (
                  <a href={paper.doi} target="_blank" rel="noopener noreferrer" className="min-w-0 hover:underline">{paper.title}</a>
                ) : (
                  // No DOI to open: what's like it is the next best place to go.
                  <Link href={similarSearchHref([paper.id]) ?? "/results"} onNavigate={closeFocus} className="min-w-0 hover:underline">{paper.title}</Link>
                )}
                <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground">
                  {paper.year ? <span>{paper.year}</span> : null}
                  <span className="flex items-center gap-1"><Quote aria-hidden className="size-3" />{format.number(paper.citations)}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
