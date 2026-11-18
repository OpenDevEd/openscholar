"use client";

import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { SearchX, ArrowRight, Loader2, CircleAlert, BookOpen, RefreshCw } from "@/components/icons";
import { useTranslations } from "next-intl";
import type { QueryErrorDetail } from "@/lib/search/search-error";
import { OQL_REFERENCE_URL } from "@/lib/openalex/oql";
import { SEARCH_SOURCE_NAMES } from "@/lib/search/source";
import { useSearchSource } from "@/lib/search/use-search-source";

type NoResultsVariant = "search" | "filter";

interface NoResultsProps {
  query?: string;
  variant?: NoResultsVariant;
  onTryNewSearch?: () => void;
}

export function NoResults({ query, variant = "search", onTryNewSearch }: NoResultsProps) {
  const t = useTranslations("search");
  const tc = useTranslations("common");

  const isFilter = variant === "filter";

  const title = isFilter ? t("noResultsMatchFilters") : tc("noResultsFound");
  const subtitle = isFilter
    ? tc("tryAdjustingSearch")
    : query
      ? t("nothingMatched", { query })
      : t("noResultsNoFilter");

  return (
    <div className="flex items-center justify-center py-16 md:py-24">
      <motion.div
        className="flex flex-col items-center text-center max-w-md px-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      >
        {/* Icon */}
        <motion.div
          className="mb-6"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <SearchX className="h-12 w-12 text-muted-foreground opacity-40" />
        </motion.div>

        {/* Typography hierarchy */}
        <motion.div
          className="space-y-2 mb-6 w-full min-w-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {/* A query with no spaces in it wraps where it must, and three lines of one are enough to know it by. */}
          <p className="line-clamp-3 text-base text-muted-foreground leading-relaxed [overflow-wrap:anywhere]">
            {subtitle}
          </p>
        </motion.div>

        {/* Suggestions */}
        <motion.div
          className="flex flex-wrap justify-center gap-2 mb-8 text-xs text-muted-foreground/70"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.15 }}
        >
          <span className="px-2.5 py-1 rounded-full bg-inset">
            {t("tryBroaderTerms")}
          </span>
          <span className="hidden sm:inline-block px-2.5 py-1 rounded-full bg-inset">
            {t("checkSpelling")}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-inset">
            {t("adjustFilters")}
          </span>
        </motion.div>

        {/* Action */}
        {onTryNewSearch && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.2 }}
          >
            <Button
              onClick={onTryNewSearch}
              variant="outline"
              className="group gap-2 h-10 px-5"
            >
              {tc("newSearch")}
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
            </Button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

/** Why the search source rejected the query, where it stopped, and how to fix it. */
export function QueryErrorState({ detail, oql }: { detail: QueryErrorDetail; oql: boolean }) {
  const t = useTranslations("search");
  const source = useSearchSource();
  const tsc = useTranslations("searchCommand");
  const problem = detail.problem.charAt(0).toUpperCase() + detail.problem.slice(1);
  // OpenAlex's own fix for this one points at an internal registry.
  const fix = /^unknown field/i.test(detail.problem) ? t("oqlUnknownFieldFix") : detail.fix;

  return (
    <div className="flex items-center justify-center py-16 md:py-24">
      <motion.div
        role="alert"
        className="flex flex-col items-center text-center max-w-xl px-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      >
        <CircleAlert className="mb-6 h-12 w-12 text-destructive opacity-60" aria-hidden />
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
          {t("queryErrorTitle", { source: SEARCH_SOURCE_NAMES[source] })}
        </h2>
        <p className="mt-2 text-base text-foreground">{problem}</p>
        {detail.near && (
          <pre className="mt-5 w-full whitespace-pre-wrap break-all rounded-lg bg-inset px-4 py-3 text-start font-mono text-xs leading-relaxed text-muted-foreground">
            {detail.near.before}
            <mark className="rounded-sm bg-destructive/15 px-0.5 text-destructive">{detail.near.token}</mark>
            {detail.near.after}
          </pre>
        )}
        {fix && <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{fix}</p>}
        {oql && (
          <a
            href={OQL_REFERENCE_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <BookOpen className="size-4" aria-hidden />
            {tsc("oqlReference")}
          </a>
        )}
      </motion.div>
    </div>
  );
}

/**
 * The search didn't run because the browser's check wasn't passed (lib/visitor-pass.ts): the visitor sent it away, or
 * it couldn't run here. Trying again asks for it again. Its words are the signed-out overview's for the same check.
 */
export function UncheckedState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("overview");
  return (
    <div className="flex items-center justify-center py-16 md:py-24">
      <motion.div
        role="alert"
        className="flex flex-col items-center text-center max-w-xl px-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      >
        <CircleAlert className="mb-6 h-12 w-12 text-destructive opacity-60" aria-hidden />
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">{t("failed.verify")}</h2>
        <Button onClick={onRetry} variant="outline" className="mt-6 h-10 gap-2 px-5">
          <RefreshCw aria-hidden /> {t("tryAgain")}
        </Button>
      </motion.div>
    </div>
  );
}

type LoadingResultsVariant = "full" | "banner";

interface LoadingResultsProps {
  variant?: LoadingResultsVariant;
}

export function LoadingResults({ variant = "full" }: LoadingResultsProps) {
  const t = useTranslations("search");

  if (variant === "banner") {
    return (
      <div role="status" className="fade-enter inline-flex items-center gap-2 rounded-full border border-border-subtle bg-card px-3 py-1.5 text-sm shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        {t("updatingResults")}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-16 md:py-24">
      <motion.div
        className="flex flex-col items-center text-center max-w-md px-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      >
        {/* Animated loader */}
        <motion.div
          className="mb-6"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <Loader2 className="h-12 w-12 text-muted-foreground opacity-40 animate-spin" />
        </motion.div>

        {/* Typography */}
        <motion.div
          className="space-y-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
            {t("searching")}
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed">
            {t("searchingDescription")}
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
