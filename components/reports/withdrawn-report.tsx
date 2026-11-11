"use client";

// What a withdrawn report's address shows (plans/publish-reports). A registered DOI can't be removed, so the DOI
// keeps leading here, to a page that says the report was withdrawn and how it was cited.

import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { IntroGlow } from "@/components/entity-cards";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { BookOpen, CircleX, Copy, FileText, Hash, Users } from "@/components/icons";
import { PaperCover } from "@/components/papers/paper-cover";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { REPORT_COVER } from "@/lib/papers/cover";

export type Withdrawn = { key: string; doi: string; title: string; authors: string[]; year: number | null; series: string; withdrawnAt: number };

export function WithdrawnReport({ report }: { report: Withdrawn }) {
  const t = useTranslations("publishReports.withdrawn");
  const format = useFormatter();
  const url = `https://doi.org/${report.doi}`;
  return (
    <LibraryPageShell
      icon={FileText}
      title={report.title}
      intro={
        <header className="relative isolate overflow-hidden p-5 sm:p-8">
          <IntroGlow rings={false} />
          <div className="grid gap-6 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-8 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
            {/* The title page, not the PDF's own first page: the file is no longer public. */}
            <PaperCover className="w-28 opacity-60 grayscale sm:w-auto sm:self-start" {...REPORT_COVER} title={report.title} authors={report.authors} source={report.series} year={report.year} type="report" image={null} href={null} pdf={false} />
            <div className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone="danger" icon={CircleX}>
                  {t("status")}
                </StatusChip>
                <StatusChip tone="neutral">{format.dateTime(report.withdrawnAt, { day: "numeric", month: "long", year: "numeric" })}</StatusChip>
              </div>
              <p dir="auto" className="mt-4 text-pretty text-2xl font-semibold leading-tight tracking-tight sm:text-[2rem]">
                {report.title}
              </p>
              {report.authors.length ? (
                <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                  <Users aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>{report.authors.join(", ")}</span>
                </p>
              ) : null}
              <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                <BookOpen aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="italic text-foreground">{report.series}</span>
              </p>
              <div className="mt-2 flex min-w-0 items-center gap-2 text-sm">
                <Hash aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span dir="ltr" className="min-w-0 truncate font-mono">{report.doi}</span>
                <TooltipHint label={t("copyDoi")}>
                  <Button variant="ghost" size="icon-xs" aria-label={t("copyDoi")} className="text-muted-foreground" onClick={() => void navigator.clipboard.writeText(url).then(() => toast.success(t("doiCopied")))}>
                    <Copy />
                  </Button>
                </TooltipHint>
              </div>
              <p className="mt-6 max-w-xl text-sm/6 text-muted-foreground">
                {t("body", { series: report.series })}
              </p>
            </div>
          </div>
        </header>
      }
    >
      {null}
    </LibraryPageShell>
  );
}
