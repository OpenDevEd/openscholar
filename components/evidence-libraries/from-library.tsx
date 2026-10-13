"use client";

// What an Evidence Library handed over (plans/evidence-library-sources), before it becomes a screening or an
// extraction: its records, search or collection as the person may read it, and the questions the reader's Smart
// screening asked, which extraction takes as they are and screening takes where they're yes or no.

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useFormatter, useTranslations } from "next-intl";
import { AiIcon, AlignLeft, ArrowUpRight, Folder, Hash, ListChecks, MessagesSquare, Search, ToggleLeft, Unlink, type AppIcon } from "@/components/icons";
import { PageWrapper } from "@/components/PageWrapper";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { ListEmpty } from "@/components/evidence-libraries/list-controls";
import { Chip } from "@/components/screening/parts";
import { SourceRow } from "@/components/screening/source-row";
import { RowFacts, rowIcon, useRowLabel } from "@/components/screening/library-sources";
import { LIST, Zone } from "@/components/settings/parts";
import { PageStepper } from "@/components/shared/page-stepper";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipHint } from "@/components/ui/tooltip";
import type { api } from "@/convex/_generated/api";
import { LIBRARY_SOURCE_MAX } from "@/lib/evidence-libraries/source-address";
import { isFrozen, rowKey, screeningQuestionsOf, setOfRow } from "@/lib/evidence-libraries/reader-sources";
import { paperKey, paperPage } from "@/lib/papers/paper-ref";
import { useExtractionStore } from "@/lib/store/extraction";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { useWorkspace } from "@/lib/workspaces/url";

export type Opened = FunctionReturnType<typeof api.evidenceLibraries.handoffs.open>;
type Field = Exclude<Opened, { gone: true }>["fields"][number];

const PAGE = 5;
const ROW = 57;
const TYPE_ICON: Record<Field["type"], AppIcon> = { string: AlignLeft, number: Hash, boolean: ToggleLeft };
const FROM_ICON: Record<Exclude<Opened, { gone: true }>["from"], AppIcon> = { smartScreening: MessagesSquare, search: Search, collection: Folder };
type Sort = "given" | "newest" | "title";

export function FromLibrary({ handoffId, opened }: { handoffId: string; opened: Opened }) {
  const t = useTranslations("fromLibrary");
  const ts = useTranslations("screeningPage");
  const te = useTranslations("extraction");
  const tl = useTranslations("librarySources");
  const tc = useTranslations("common");
  const router = useWorkspaceRouter();
  const workspaceId = useWorkspace();
  const format = useFormatter();
  const labelOf = useRowLabel();
  const { draftJob, setSource, addQuestion, updateQuestion, setDraftJobName } = useExtractionStore();
  const [sort, setSort] = useState<Sort>("given");
  const [page, setPage] = useState(1);

  const why = "gone" in opened ? t("goneHint") : "error" in opened.found ? t(`problem.${opened.found.error}`) : null;
  if ("gone" in opened || "error" in opened.found) {
    return (
      <PageWrapper>
        <LibraryPageShell title={t("gone")} backHref="/screening" backLabel={tc("cancel")}>
          <ListEmpty icon={Unlink}>{why}</ListEmpty>
        </LibraryPageShell>
      </PageWrapper>
    );
  }

  const { from, fields, records } = opened;
  const { row, library } = opened.found;
  const label = labelOf(row);
  const count = isFrozen(row) ? Math.min(row.records, LIBRARY_SOURCE_MAX) : row.records;
  const yesNo = screeningQuestionsOf(fields);
  // Questions that came along and none of them yes or no leave screening nothing to ask.
  const screenable = fields.length === 0 || yesNo.length > 0;
  const sorted = !records || sort === "given" ? (records ?? []) : [...records].sort((a, b) => (sort === "title" ? a.title.localeCompare(b.title) : (b.year ?? 0) - (a.year ?? 0)));
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const shown = sorted.slice((page - 1) * PAGE, page * PAGE);

  const extract = () => {
    if (!workspaceId) return;
    setSource(workspaceId, { key: rowKey(row), set: setOfRow(row), label, total: count, first: 1, last: count, scope: "all", held: { library, row } });
    // A question already in the draft takes the type and meaning the library sent.
    for (const field of fields) {
      const asked = draftJob.questions.find((q) => q.question.toLowerCase() === field.label.toLowerCase());
      const change = { type: field.type, description: field.description || undefined };
      if (asked) updateQuestion(asked.key, change);
      else addQuestion({ question: field.label, ...change });
    }
    if (!draftJob.name.trim()) setDraftJobName(label);
    router.push("/extraction/new");
  };
  // Screening asks yes or no: a yes or no question comes along as what it asks, the others stay behind.
  const screen = () => router.push(`/screening?handoff=${encodeURIComponent(handoffId)}`);

  return (
    <PageWrapper>
      <LibraryPageShell icon={null} image={library.faviconUrl} title={t("title", { library: library.name })} backHref="/screening" backLabel={tc("cancel")} allowOverflow>
        <div className="space-y-8 p-4 pb-24 sm:p-6">
          <Zone label={ts("papers")} aside={<Chip icon={FROM_ICON[from]}>{t(`from.${from}`)}</Chip>}>
            <div className={LIST}>
              <SourceRow
                on
                onToggle={() => undefined}
                icon={rowIcon(row, [library])}
                label={label}
                detail={
                  <span className="flex min-w-0 gap-1">
                    <RowFacts row={row} pasted={false} address={library.address} />
                    {isFrozen(row) && row.records > LIBRARY_SOURCE_MAX ? <Chip>{tl("firstOf", { count: LIBRARY_SOURCE_MAX, total: row.records })}</Chip> : null}
                  </span>
                }
                count={<Chip>{ts("paperCount", { count })}</Chip>}
              />
            </div>
            {records?.length ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between gap-2 pl-1">
                  <span className="text-xs text-muted-foreground">{t("theRecords")}</span>
                  <Select
                    value={sort}
                    onValueChange={(next) => {
                      setSort(next as Sort);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger size="sm" aria-label={t("sort")} className="h-8 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["given", "newest", "title"] as const).map((id) => (
                        <SelectItem key={id} value={id}>
                          {t(`sortBy.${id}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div style={pages > 1 ? { minHeight: PAGE * ROW + 1 } : undefined}>
                  <ol className={LIST}>
                    {shown.map((record) => {
                      const href = paperPage(paperKey({ source: "library", libraryId: library.libraryId, key: record.key }), { libraryAddress: library.address });
                      return (
                        <li key={record.key} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                          <span className="min-w-0 flex-1">
                            <TooltipHint label={record.title} onlyWhenClipped>
                              <span className="block truncate text-sm font-medium">{record.title}</span>
                            </TooltipHint>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{format.list(record.authors, { type: "conjunction" })}</span>
                          </span>
                          {record.year ? <Chip>{record.year}</Chip> : null}
                          {href ? (
                            <TooltipHint label={t("open", { library: library.name })}>
                              <Button asChild variant="ghost" size="icon" className="size-8 text-muted-foreground">
                                <a href={href} target="_blank" rel="noreferrer" aria-label={t("open", { library: library.name })}>
                                  <ArrowUpRight />
                                </a>
                              </Button>
                            </TooltipHint>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
                {pages > 1 ? <PageStepper page={page} pageCount={pages} canPrevious={page > 1} canNext={page < pages} onPrevious={() => setPage(page - 1)} onNext={() => setPage(page + 1)} /> : null}
              </div>
            ) : null}
          </Zone>

          <Zone label={ts("questions")}>
            {fields.length ? (
              <ol className={LIST}>
                {fields.map((field, i) => {
                  const Icon = TYPE_ICON[field.type];
                  return (
                    <li key={field.label} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{field.label}</span>
                        {field.description ? (
                          <TooltipHint label={field.description} onlyWhenClipped>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{field.description}</span>
                          </TooltipHint>
                        ) : null}
                      </span>
                      <Chip icon={Icon}>{te(field.type === "string" ? "typeText" : field.type === "boolean" ? "typeYesNo" : "typeNumber")}</Chip>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className={`${LIST} px-4 py-8 text-center text-sm text-muted-foreground`}>{t("noQuestions")}</p>
            )}
          </Zone>

          {/* Screening asks yes or no: offered when no questions came, or some of them are yes or no. Each button says how many questions it takes. */}
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-border-subtle bg-background p-4 shadow-lg">
            {screenable ? (
              <Button variant="outline" className="min-w-44" onClick={screen} disabled={!count}>
                <ListChecks className="text-primary" />
                {fields.length ? t("screenWith", { count: yesNo.length }) : t("screen")}
              </Button>
            ) : null}
            <Button className="min-w-44" onClick={extract} disabled={!count}>
              <AiIcon />
              {fields.length ? t("extractWith", { count: fields.length }) : t("extract")}
            </Button>
          </div>
        </div>
      </LibraryPageShell>
    </PageWrapper>
  );
}
