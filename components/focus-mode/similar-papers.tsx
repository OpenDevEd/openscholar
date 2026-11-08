"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useCloseFocus } from "@/components/focus-mode/close-context";
import { Compass } from "@/components/icons";
import { readSimilarPapers } from "@/app/actions/similar";
import { PaperRows } from "@/components/papers/paper-rows";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import Link from "@/components/workspace-link";
import { unlessLimited } from "@/lib/openalex/limited";
import { similarSearchHref } from "@/lib/search/similar-href";
import { paperPath } from "@/lib/papers/page-address";

const SHOWN = 8;

/** The papers closest in meaning to the open one. It holds its height while they're read, so nothing moves. */
export function SimilarPapers({ paperId }: { paperId: string }) {
  const t = useTranslations("similarPapers");
  const closeFocus = useCloseFocus();
  const { data, error, isLoading } = useSWR(["similar-papers", paperId], ([, id]) => unlessLimited(readSimilarPapers(id, SHOWN)), { revalidateOnFocus: false });
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
      <div className="min-h-88">
        {isLoading ? (
          <div className="flex h-88 items-center justify-center text-muted-foreground"><Spinner aria-label={t("finding")} /></div>
        ) : error ? (
          <p className="py-2 text-sm text-muted-foreground">{t("failed")}</p>
        ) : !data?.length ? (
          <p className="py-2 text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <PaperRows
            className="fade-enter"
            papers={data}
            // Each opens its page here, which holds its DOI and where to read it; focus mode closes as it goes.
            link={(paper) => ({ href: paperPath(paper.id.split("/").at(-1)!, paper.title), onNavigate: closeFocus })}
          />
        )}
      </div>
    </section>
  );
}
