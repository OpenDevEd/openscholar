"use client";

import useSWR from "swr";
import { useFormatter, useTranslations } from "next-intl";
import { Compass, Quote } from "@/components/icons";
import { readSimilarPapers } from "@/app/actions/similar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import Link from "@/components/workspace-link";
import { unlessLimited } from "@/lib/openalex/limited";
import { similarSearchHref } from "@/lib/search/actions";

const SHOWN = 8;

/** The papers closest in meaning to the open one. It holds its height while they're read, so nothing moves. */
export function SimilarPapers({ paperId }: { paperId: string }) {
  const format = useFormatter();
  const t = useTranslations("similarPapers");
  const { data, error, isLoading } = useSWR(["similar-papers", paperId], ([, id]) => unlessLimited(readSimilarPapers(id, SHOWN)), { revalidateOnFocus: false });
  return (
    <section aria-label={t("title")} className="border-t pt-2">
      <div className="mb-1 flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{t("title")}</h3>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" asChild>
          <Link href={similarSearchHref([paperId.split("/").at(-1)!])}>
            <Compass className="h-3.5 w-3.5" />
            {t("seeAll")}
          </Link>
        </Button>
      </div>
      <div className="min-h-88">
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
                {paper.doi ? (
                  <a href={paper.doi} target="_blank" rel="noopener noreferrer" className="min-w-0 hover:underline">{paper.title}</a>
                ) : (
                  <span className="min-w-0">{paper.title}</span>
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
