"use client";

import { useTranslations } from "next-intl";
import { Compass } from "@/components/icons";
import { TooltipHint } from "@/components/ui/tooltip";
import { similarSearchHref } from "@/lib/search/similar-href";
import { useSearchSource } from "@/lib/search/use-search-source";
import { useCitationHandlers } from "./hooks";

/** The icon that finds what's close in meaning to a paper, in the views with no room for its label. Only on our index, for a paper it can name. */
export function SimilarIconButton({ paperId }: { paperId: string }) {
  const t = useTranslations("similarPapers");
  const { handleSimilarSearch } = useCitationHandlers(paperId);
  const ownIndex = useSearchSource() === "openscholar";
  if (!ownIndex || !similarSearchHref([paperId])) return null;
  return (
    <TooltipHint label={t("title")}>
      <button
        type="button"
        aria-label={t("title")}
        onClick={(event) => {
          event.stopPropagation();
          handleSimilarSearch();
        }}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium ink-related transition-colors hover:bg-related/10"
      >
        <Compass className="h-3.5 w-3.5" />
      </button>
    </TooltipHint>
  );
}
