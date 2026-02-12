"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FilterState, Question } from "@/lib/extraction/filtering";
import { Loader2 } from "lucide-react";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

interface ReportBuilderProps {
  jobId: string;
  filters: FilterState;
  sortBy: string;
  viewMode: "table" | "cards" | "split";
  questions: Question[];
  onApplySavedView: (view: any) => void;
  canUseTemplates: boolean;
  canUseRunDiff: boolean;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function reportToMarkdown(report: any) {
  const header = [
    `# ${report.name}`,
    "",
    `Generated: ${new Date(report.generatedAt).toLocaleString()}`,
    "",
    `- Total papers: ${report.metrics.totalPapers}`,
    `- Answered rate: ${Math.round(report.metrics.answeredRate * 100)}%`,
    `- Grounded rate: ${Math.round(report.metrics.groundedRate * 100)}%`,
    `- Best effort rate: ${Math.round(report.metrics.bestEffortRate * 100)}%`,
    "",
  ];

  const sections = report.sections.flatMap((section: any) => [
    `## ${section.title}`,
    "",
    section.body,
    "",
  ]);
  return [...header, ...sections].join("\n");
}

export function ReportBuilder({
  jobId,
  filters,
  sortBy,
  viewMode,
  questions,
  onApplySavedView,
  canUseTemplates,
  canUseRunDiff,
}: ReportBuilderProps) {
  const t = useTranslations("reportBuilder");
  const tc = useTranslations("common");
  const router = useRouter();
  const savedViewsQuery = useProtectedQuery(api.extraction.queries.getSavedViews, {
    jobId: jobId as any,
  } as any);
  const templatesQuery = useProtectedQuery(api.extraction.queries.getWorkflowTemplates, {});
  const reportsQuery = useProtectedQuery(api.extraction.queries.getReportSnapshots, {
    jobId: jobId as any,
  } as any);
  const latestDiffQuery = useProtectedQuery(api.extraction.queries.getRunDiff, {
    jobId: jobId as any,
  } as any);
  const completedJobsQuery = useProtectedQuery(api.extraction.queries.getMyJobs, {
    status: "completed",
  });
  const savedViews = savedViewsQuery.data;
  const templates = templatesQuery.data;
  const reports = reportsQuery.data;
  const latestDiff = latestDiffQuery.data;
  const completedJobs = completedJobsQuery.data;

  const saveView = useMutation(api.extraction.mutations.saveExtractionSavedView);
  const deleteView = useMutation(api.extraction.mutations.deleteExtractionSavedView);
  const saveTemplate = useMutation(api.extraction.mutations.saveWorkflowTemplate);
  const deleteTemplate = useMutation(api.extraction.mutations.deleteWorkflowTemplate);
  const rerunTemplate = useMutation(api.extraction.mutations.startExtractionFromTemplate);
  const createReport = useMutation(api.extraction.mutations.createExtractionReportSnapshot);
  const createRunDiff = useMutation(api.extraction.mutations.createExtractionRunDiff);

  const [viewName, setViewName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [reportName, setReportName] = useState("");
  const [selectedBaselineJobId, setSelectedBaselineJobId] = useState<string>("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const isDeferred =
    savedViewsQuery.isDeferred ||
    templatesQuery.isDeferred ||
    reportsQuery.isDeferred ||
    latestDiffQuery.isDeferred ||
    completedJobsQuery.isDeferred;

  const savedViewsData = savedViews?.status === "ok" ? savedViews.views : [];
  const reportsData = reports?.status === "ok" ? reports.reports : [];
  const latestDiffData = latestDiff?.status === "ok" ? latestDiff.diff : null;

  const baselineOptions = useMemo(
    () => (completedJobs || []).filter((job) => job._id !== jobId),
    [completedJobs, jobId]
  );

  const latestReport = reportsData.length > 0 ? reportsData[0] : null;

  if (
    isDeferred ||
    savedViews === undefined ||
    templates === undefined ||
    reports === undefined ||
    latestDiff === undefined ||
    completedJobs === undefined
  ) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  async function handleSaveView() {
    if (!viewName.trim()) return;
    setBusyAction("save-view");
    try {
      await saveView({
        jobId: jobId as any,
        name: viewName.trim(),
        filters: {
          searchQuery: filters.searchQuery,
          confidenceRange: filters.confidenceRange,
          statusFilters: Array.from(filters.statusFilters),
        },
        sortBy,
        viewMode,
        selectedQuestionKeys: questions.map((question) => question.key),
      } as any);
      setViewName("");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) return;
    setBusyAction("save-template");
    try {
      await saveTemplate({
        jobId: jobId as any,
        name: templateName.trim(),
      });
      setTemplateName("");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateReport() {
    setBusyAction("create-report");
    try {
      await createReport({
        jobId: jobId as any,
        name: reportName.trim() || undefined,
        scope: {
          selectedQuestionKeys: questions.map((question) => question.key),
        },
      } as any);
      setReportName("");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateDiff() {
    if (!selectedBaselineJobId) return;
    setBusyAction("create-diff");
    try {
      await createRunDiff({
        jobId: jobId as any,
        baselineJobId: selectedBaselineJobId as any,
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
          <div className="text-sm font-medium">{t("savedViews")}</div>
          <div className="flex gap-2">
            <Input
              placeholder={t("viewName")}
              value={viewName}
              onChange={(event) => setViewName(event.target.value)}
            />
            <Button
              type="button"
              onClick={() => void handleSaveView()}
              disabled={busyAction !== null || !viewName.trim()}
            >
              {tc("save")}
            </Button>
          </div>
          <div className="space-y-2">
            {savedViewsData.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("noSavedViewsYet")}</div>
            ) : (
              savedViewsData.map((view: any) => (
                <div
                  key={view._id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/40 bg-muted/20 px-3 py-2"
                >
                  <div>
                    <div className="font-medium text-sm">{view.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("updated")} {new Date(view.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onApplySavedView(view)}
                    >
                      {t("apply")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void deleteView({ viewId: view._id })}
                    >
                      {tc("delete")}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
          <div className="text-sm font-medium">{t("workflowTemplates")}</div>
          {canUseTemplates ? (
            <>
              <div className="flex gap-2">
                <Input
                  placeholder={t("templateName")}
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                />
                <Button
                  type="button"
                  onClick={() => void handleSaveTemplate()}
                  disabled={busyAction !== null || !templateName.trim()}
                >
                  {tc("save")}
                </Button>
              </div>
              <div className="space-y-2">
                {(templates || []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t("noTemplatesYet")}</div>
                ) : (
                  (templates || []).map((template: any) => (
                    <div
                      key={template._id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/40 bg-muted/20 px-3 py-2"
                    >
                      <div>
                        <div className="font-medium text-sm">{template.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t("questionsCount", { count: template.questions?.length || 0 })}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            setBusyAction(`rerun-${template._id}`);
                            try {
                              const result = await rerunTemplate({ templateId: template._id });
                              router.push(`/extraction/${result.jobId}`);
                            } finally {
                              setBusyAction(null);
                            }
                          }}
                        >
                          {t("runAgain")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void deleteTemplate({ templateId: template._id })}
                        >
                          {tc("delete")}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t("workflowTemplatesPro")}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
        <div className="text-sm font-medium">{t("reportBuilderTitle")}</div>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder={t("reportName")}
            value={reportName}
            onChange={(event) => setReportName(event.target.value)}
            className="max-w-sm"
          />
          <Button
            type="button"
            onClick={() => void handleCreateReport()}
            disabled={busyAction !== null}
          >
            {t("generateReportSnapshot")}
          </Button>
        </div>
        {latestReport ? (
          <div className="rounded border border-border/40 bg-muted/20 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{latestReport.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t("generated")} {new Date(latestReport.generatedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadFile(
                      JSON.stringify(latestReport, null, 2),
                      `report-${latestReport._id}.json`,
                      "application/json"
                    )
                  }
                >
                  {t("exportJson")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadFile(
                      reportToMarkdown(latestReport),
                      `report-${latestReport._id}.md`,
                      "text/markdown"
                    )
                  }
                >
                  {t("exportMarkdown")}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">
                {t("answered")} {Math.round(latestReport.metrics.answeredRate * 100)}%
              </Badge>
              <Badge variant="outline">
                {t("grounded")} {Math.round(latestReport.metrics.groundedRate * 100)}%
              </Badge>
              <Badge variant="outline">
                {t("bestEffort")} {Math.round(latestReport.metrics.bestEffortRate * 100)}%
              </Badge>
            </div>
            <div className="space-y-3">
              {latestReport.sections.map((section: any) => (
                <div key={section.id}>
                  <div className="text-sm font-medium">{section.title}</div>
                  <pre className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                    {section.body}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">{t("noReportSnapshots")}</div>
        )}
      </div>

      <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
        <div className="text-sm font-medium">{t("changeAlerts")}</div>
        {canUseRunDiff ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedBaselineJobId}
                onChange={(event) => setSelectedBaselineJobId(event.target.value)}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="">{t("selectBaselineRun")}</option>
                {baselineOptions.map((job: any) => (
                  <option key={job._id} value={job._id}>
                    {job.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                onClick={() => void handleCreateDiff()}
                disabled={!selectedBaselineJobId || busyAction !== null}
              >
                {t("generateDiff")}
              </Button>
            </div>
            {latestDiffData ? (
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{t("newAnswersCount", { count: latestDiffData.summary.newAnswers })}</Badge>
                <Badge variant="outline">{t("changedAnswersCount", { count: latestDiffData.summary.changedAnswers })}</Badge>
                <Badge variant="outline">{t("removedAnswersCount", { count: latestDiffData.summary.removedAnswers })}</Badge>
                <Badge variant="outline">
                  {t("confidenceShiftsCount", { count: latestDiffData.summary.confidenceShifts })}
                </Badge>
                <Badge variant="outline">
                  {t("newlyInsufficientCount", { count: latestDiffData.summary.newlyInsufficientEvidence })}
                </Badge>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">{t("noDiffGenerated")}</div>
            )}
          </>
        ) : (
          <div className="text-sm text-muted-foreground">
            {t("changeAlertsPro")}
          </div>
        )}
      </div>
    </div>
  );
}
