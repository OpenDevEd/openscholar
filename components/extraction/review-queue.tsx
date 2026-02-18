"use client";
"use no memo"; // try/finally in handlers

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Quote } from "lucide-react";
import type { CitationPanelPayload } from "@/lib/extraction/citation-panel";
import { buildCitationPanelPayload } from "@/lib/extraction/citation-panel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useTranslations } from "next-intl";

type ReviewState = "unreviewed" | "accepted" | "rejected" | "needs_followup";

const defaultStates: ReviewState[] = ["unreviewed", "needs_followup"];

function parseCorrectedAnswer(raw: string, type?: string) {
  const value = raw.trim();
  if (!value) return undefined;

  if (type === "boolean") {
    if (["yes", "true", "1"].includes(value.toLowerCase())) return true;
    if (["no", "false", "0"].includes(value.toLowerCase())) return false;
    return undefined;
  }
  if (type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (type === "array") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}

export function ReviewQueue({
  jobId,
  onOpenCitationPanel,
  enabled = true,
}: {
  jobId: string;
  onOpenCitationPanel: (payload: CitationPanelPayload) => void;
  enabled?: boolean;
}) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");

  const [selectedStates, setSelectedStates] = useState<Set<ReviewState>>(
    new Set(defaultStates)
  );
  const [onlyInsufficientEvidence, setOnlyInsufficientEvidence] = useState(false);
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState("");
  const [correctedAnswer, setCorrectedAnswer] = useState("");
  const [saving, setSaving] = useState(false);

  const queueQuery = useProtectedQuery(
    api.extraction.queries.getReviewQueue,
    enabled
      ? ({
          jobId: jobId as any,
          states: Array.from(selectedStates),
          onlyInsufficientEvidence,
          limit: 250,
        } as any)
      : "skip",
  );
  const queue = queueQuery.data;
  const setReviewState = useMutation(api.extraction.mutations.setResultReviewState);

  const items = queue?.status === "ok" ? queue.items || [] : [];
  const current = items[index] || null;

  useEffect(() => {
    if (index < items.length) return;
    setIndex(Math.max(0, items.length - 1));
  }, [index, items.length]);

  useEffect(() => {
    setNote(current?.reviewNote || "");
    if (current?.correctedAnswer === undefined || current?.correctedAnswer === null) {
      setCorrectedAnswer("");
      return;
    }
    if (Array.isArray(current.correctedAnswer)) {
      setCorrectedAnswer(current.correctedAnswer.join(", "));
      return;
    }
    setCorrectedAnswer(String(current.correctedAnswer));
  }, [current?.resultId]);

  const handleSaveState = useCallback(
    async (state: ReviewState) => {
      if (!current || saving) return;
      setSaving(true);
      try {
        await setReviewState({
          resultId: current.resultId,
          state,
          note: note.trim() || undefined,
          correctedAnswer: parseCorrectedAnswer(correctedAnswer, current.questionType),
        } as any);
        setIndex((value) => Math.min(value + 1, Math.max(items.length - 1, 0)));
      } finally {
        setSaving(false);
      }
    },
    [current, saving, note, correctedAnswer, items.length, setReviewState]
  );

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (!current) return;

      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
        event.preventDefault();
        setIndex((value) => Math.min(value + 1, items.length - 1));
      }
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIndex((value) => Math.max(value - 1, 0));
      }
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        void handleSaveState("accepted");
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void handleSaveState("rejected");
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void handleSaveState("needs_followup");
      }
      if (event.key.toLowerCase() === "u") {
        event.preventDefault();
        void handleSaveState("unreviewed");
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [current, items.length, note, correctedAnswer, handleSaveState]);

  const counts = queue?.status === "ok" ? queue.counts : undefined;

  const citations = useMemo(() => {
    if (!current?.citations || !Array.isArray(current.citations)) return [];
    return current.citations.map((citation: any) => ({
      evidenceId: citation.evidenceId,
      page: citation.page,
      charRange: citation.charRange,
      text: citation.quote,
      validated: true,
      retrieval: citation.retrieval || {},
      citationStatus: current.citationStatus,
    }));
  }, [current]);

  if (!enabled) return null;

  function toggleState(state: ReviewState) {
    setSelectedStates((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
    setIndex(0);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{tc("queue")}: {counts?.total ?? 0}</Badge>
          <Badge variant="outline">{tc("unreviewed")}: {counts?.unreviewed ?? 0}</Badge>
          <Badge variant="outline">{t("needsFollowUp")}: {counts?.needsFollowup ?? 0}</Badge>
          <Badge variant="outline">{tc("insufficientEvidence")}: {counts?.insufficientEvidence ?? 0}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {(["unreviewed", "accepted", "rejected", "needs_followup"] as const).map((state) => {
            const reviewStateLabels: Record<ReviewState, string> = {
              unreviewed: tc("unreviewed"),
              accepted: tc("accepted"),
              rejected: tc("rejected"),
              needs_followup: t("needsFollowUp"),
            };
            return (
              <label key={state} className="inline-flex items-center gap-2">
                <Checkbox
                  checked={selectedStates.has(state)}
                  onCheckedChange={() => toggleState(state)}
                />
                <span>{reviewStateLabels[state]}</span>
              </label>
            );
          })}
          <label className="inline-flex items-center gap-2">
            <Checkbox
              checked={onlyInsufficientEvidence}
              onCheckedChange={(checked) => setOnlyInsufficientEvidence(Boolean(checked))}
            />
            <span>{t("onlyInsufficientEvidence")}</span>
          </label>
        </div>
      </div>

      {queueQuery.isDeferred || queue === undefined ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : queue.status !== "ok" ? (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-6 text-sm text-muted-foreground">
          {queue.status === "unauthenticated"
            ? t("signInToReview")
            : queue.status === "no_access"
              ? t("noAccessReview")
              : t("reviewUnavailable")}
        </div>
      ) : !current ? (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-6 text-sm text-muted-foreground">
          {t("noItemsMatch")}
        </div>
      ) : (
        <div className="rounded-lg border border-border/50 bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs text-muted-foreground">
                {tc("itemOfTotal", { current: index + 1, total: items.length })}
              </div>
              <div className="font-medium">{current.paperTitle}</div>
              <div className="text-sm text-muted-foreground">{current.question}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{
                ({
                  grounded: tc("grounded"),
                  best_effort: tc("bestEffort"),
                  insufficient_evidence: tc("insufficientEvidence"),
                  extraction_error: tc("extractionError"),
                } as Record<string, string>)[current.citationStatus ?? ""] ?? current.citationStatus
              }</Badge>
              <Badge variant="secondary">
                {Math.round((current.confidence || 0) * 100)}% {t("confidence")}
              </Badge>
              <Badge variant="outline">{
                ({
                  unreviewed: tc("unreviewed"),
                  accepted: tc("accepted"),
                  rejected: tc("rejected"),
                  needs_followup: t("needsFollowUp"),
                } as Record<string, string>)[current.reviewState ?? ""] ?? current.reviewState
              }</Badge>
            </div>
          </div>

          <div className="rounded border border-border/40 bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground mb-1">{tc("answer")}</div>
            <div className="text-sm">
              {Array.isArray(current.answer)
                ? current.answer.join("; ")
                : current.answer === null || current.answer === undefined
                  ? tc("unknown")
                  : String(current.answer)}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium">{t("reviewerNote")}</label>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={4}
                placeholder={t("reviewNotePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium">{t("correctedAnswer")}</label>
              <Input
                value={correctedAnswer}
                onChange={(event) => setCorrectedAnswer(event.target.value)}
                placeholder={
                  current.questionType === "array"
                    ? t("correctedAnswerList")
                    : current.questionType === "boolean"
                      ? t("correctedAnswerYesNo")
                      : t("correctedAnswerDefault")
                }
              />
              {citations.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!current) return;
                    const payload = buildCitationPanelPayload({
                      paperId: current.paperId as any,
                      paperTitle: current.paperTitle || null,
                      citations,
                      citationStatus: current.citationStatus,
                      answer: current.answer,
                      questionText: current.question || null,
                    });
                    if (!payload) return;
                    onOpenCitationPanel(payload);
                  }}
                  className="w-full"
                >
                  <Quote className="mr-2 h-3 w-3" />
                  {tc("viewCitation")}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSaveState("accepted")}
              disabled={saving}
            >
              {t("acceptA")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void handleSaveState("needs_followup")}
              disabled={saving}
            >
              {t("needsFollowUpF")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => void handleSaveState("rejected")}
              disabled={saving}
            >
              {t("rejectR")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleSaveState("unreviewed")}
              disabled={saving}
            >
              {t("clearReviewU")}
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIndex((value) => Math.max(value - 1, 0))}
                disabled={index === 0}
              >
                {tc("previous")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIndex((value) => Math.min(value + 1, items.length - 1))}
                disabled={index >= items.length - 1}
              >
                {tc("next")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
