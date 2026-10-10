"use client";

import { usePreloadedQuery, type Preloaded } from "convex/react";
import { useTranslations } from "next-intl";
import { PageWrapper } from "@/components/PageWrapper";
import { ExtractionIcon } from "@/components/icons";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import type { api } from "@/convex/_generated/api";
import { SetupView } from "./setup-view";

export function NewExtraction({ preloadedLimits }: { preloadedLimits: Preloaded<typeof api.billing.accounts.myLimits> }) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  // A plan that sets no limit takes any number of papers.
  const paperLimit = usePreloadedQuery(preloadedLimits)?.request_papers ?? Infinity;
  return (
    <PageWrapper>
      {/* Its footer sticks to the bottom of the screen, so the card lets it out of its clip. */}
      <LibraryPageShell icon={ExtractionIcon} title={t("newJobTitle")} backHref="/extraction" backLabel={tc("cancel")} allowOverflow>
        <div className="p-4 sm:p-6">
          <SetupView paperLimit={paperLimit} />
        </div>
      </LibraryPageShell>
    </PageWrapper>
  );
}
