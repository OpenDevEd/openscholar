"use client";

import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { SearchX, ArrowRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface NoResultsProps {
  query?: string;
  onTryNewSearch?: () => void;
}

export function NoResults({ query, onTryNewSearch }: NoResultsProps) {
  const t = useTranslations("search");
  const tc = useTranslations("common");
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
          className="space-y-2 mb-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
            {tc("noResultsFound")}
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed">
            {query ? (
              t("nothingMatched", { query })
            ) : (
              t("noResultsNoFilter")
            )}
          </p>
        </motion.div>

        {/* Suggestions */}
        <motion.div
          className="flex flex-wrap justify-center gap-2 mb-8 text-xs text-muted-foreground/70"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.15 }}
        >
          <span className="px-2.5 py-1 rounded-full bg-muted/50">
            {t("tryBroaderTerms")}
          </span>
          <span className="hidden sm:inline-block px-2.5 py-1 rounded-full bg-muted/50">
            {t("checkSpelling")}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-muted/50">
            {t("adjustFilters")}
          </span>
        </motion.div>

        {/* Action */}
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
      </motion.div>
    </div>
  );
}

export function LoadingResults() {
  const t = useTranslations("search");
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
