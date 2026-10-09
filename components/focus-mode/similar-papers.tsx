"use client";

/**
 * The papers closest in meaning to the paper shown (the OpenScholar API's similar_to), a few of them,
 * with a way to see them all as a search the filters work on.
 */
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { getSimilarWorks } from "@/app/actions/openalex";
import { createCitationSearch } from "@/lib/search/actions";

/** How many similar papers the paper's view lists, before "See all". */
export const SIMILAR_SHOWN = 8;

/** A similar paper as the list shows it. */
type Shown = { id: string; display_name?: string | null; publication_year?: number | null; cited_by_count?: number | null; doi?: string | null };

export function SimilarPapers({ paperId }: { paperId: string }) {
  const t = useTranslations("focusMode");
  const format = useFormatter();
  const router = useRouter();
  const { data, isLoading } = useSWR(["similar-works", paperId], () => getSimilarWorks(paperId, SIMILAR_SHOWN));
  const papers = (data?.ok ? data.data.results : []) as Shown[];
  const seeAll = () => router.push(createCitationSearch(paperId, "similar").url);

  return (
    <section className="border-t pt-2" aria-label={t("similarPapers")}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          {t("similarPapers")}
        </h3>
        {papers.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={seeAll}>
            {t("similarSeeAll")}
          </Button>
        )}
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">{t("similarLoading")}</p>
      ) : data && !data.ok ? (
        <p className="text-xs text-muted-foreground">{t("similarFailed")}</p>
      ) : papers.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("similarNone")}</p>
      ) : (
        <ol className="space-y-1.5">
          {papers.map((paper) => (
            <li key={paper.id} className="text-sm leading-snug">
              {paper.doi ? (
                <a href={paper.doi} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {paper.display_name}
                </a>
              ) : (
                <span>{paper.display_name}</span>
              )}
              <span className="ml-1.5 text-xs text-muted-foreground">
                {[paper.publication_year, t("similarCitations", { count: format.number(paper.cited_by_count ?? 0) })].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
