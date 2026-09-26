"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useBucketStore } from "@/lib/store/bucket";
import { useExtractionStore } from "@/lib/store/extraction";
import { useTranslations } from "next-intl";
import {
  breakdownChatSources,
  summarizeChatSources,
  type ChatSourceBreakdownRow,
} from "@/lib/bucket/chat-source-stats";
import {
  BUCKET_SOURCE_LABELS,
  SOURCE_COLOR_VAR,
  SOURCE_ICON,
} from "@/lib/bucket/source-labels";
import { cn } from "@/lib/utils";

export function ChatStartReview() {
  const t = useTranslations("extraction");
  const order = useBucketStore((s) => s.order);
  const items = useBucketStore((s) => s.items);
  const jobName = useExtractionStore((s) => s.draftJob.name);
  const prefersReduced = useReducedMotion();

  const readyItems = useMemo(
    () => order.flatMap((key) => (items[key] ? [items[key]] : [])),
    [order, items],
  );

  const { totalPapers, unresolvedPapers } = useMemo(
    () => summarizeChatSources(readyItems),
    [readyItems],
  );

  const breakdown = useMemo(() => {
    const rows = breakdownChatSources(readyItems);
    // Concrete rows first, saved-searches last — the saved-search row has
    // a "row → papers" expansion affordance that reads better as a
    // footnote-adjacent final row.
    return rows.sort((a, b) => {
      if (a.isSavedSearch !== b.isSavedSearch) return a.isSavedSearch ? 1 : -1;
      return a.source.localeCompare(b.source);
    });
  }, [readyItems]);

  const sourceTypeCount = breakdown.length;
  const hasUnresolved = unresolvedPapers > 0;

  return (
    <motion.div
      data-role="chat-start-review"
      data-total-papers={totalPapers}
      data-unresolved-papers={unresolvedPapers}
      initial={prefersReduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-md space-y-8 py-6"
    >
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("chatStartReviewTitle")}
        </h2>
        {jobName.trim().length > 0 && (
          <p
            data-role="job-name"
            className="text-base italic text-muted-foreground"
          >
            &ldquo;{jobName}&rdquo;
          </p>
        )}
      </header>

      <p className="text-sm text-foreground">
        {t("chatReviewSummary", {
          papers: totalPapers,
          sources: sourceTypeCount,
        })}
      </p>

      <dl
        data-role="source-ledger"
        className="divide-y divide-border/60 border-y border-border/60"
      >
        {breakdown.map((row) => (
          <LedgerRow key={rowKey(row)} row={row} t={t} />
        ))}
      </dl>

      {hasUnresolved && (
        <p
          role="note"
          className="text-xs leading-relaxed text-muted-foreground"
        >
          {t("chatReviewSavedSearchFootnote", { count: unresolvedPapers })}
        </p>
      )}
    </motion.div>
  );
}

function rowKey(row: ChatSourceBreakdownRow): string {
  return `${row.source}:${row.isSavedSearch ? "saved" : "concrete"}`;
}

function LedgerRow({
  row,
  t,
}: {
  row: ChatSourceBreakdownRow;
  t: ReturnType<typeof useTranslations<"extraction">>;
}) {
  const label = row.isSavedSearch
    ? t("chatReviewSourceSavedSearch")
    : BUCKET_SOURCE_LABELS[row.source];
  const SourceIcon = SOURCE_ICON[row.source];

  return (
    <div
      data-source={row.source}
      data-saved-search={row.isSavedSearch || undefined}
      className="flex items-baseline justify-between gap-4 py-3"
    >
      <dt className="flex items-center gap-2 text-sm text-foreground">
        <span aria-hidden="true" className="inline-flex" style={{ color: `var(${SOURCE_COLOR_VAR[row.source]})` }}>
          <SourceIcon className="size-3.5" />
        </span>
        {label}
      </dt>
      <dd className="font-mono text-sm tabular-nums text-foreground">
        {row.isSavedSearch ? (
          <>
            <span>{row.rowCount}</span>
            <span
              aria-hidden="true"
              className="mx-1.5 text-muted-foreground"
            >
              →
            </span>
            <span>{row.paperCount}</span>
          </>
        ) : (
          <span>{row.paperCount}</span>
        )}
      </dd>
    </div>
  );
}
