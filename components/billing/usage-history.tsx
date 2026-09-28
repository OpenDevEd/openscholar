"use client";

import Link from "next/link";
import {
  FileSearch,
  KeyRound,
  Languages,
  ListFilter,
  MessageSquare,
  Search,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useProtectedPaginatedQuery } from "@/lib/auth/use-auth-query";

const PAGE_SIZE = 25;

const KIND_ICONS: Record<string, LucideIcon> = {
  chat: MessageSquare,
  extraction: FileSearch,
  screening: ListFilter,
  search: Search,
  translation: Languages,
  wallet_api: KeyRound,
  refund: Undo2,
};

/**
 * Every settled charge, newest first, or only one job's when the URL has
 * `?jobId=` (the job cost badge links here). Invoices live in the Stripe portal.
 */
export function UsageHistory() {
  const t = useTranslations("billingPage.usage");
  const format = useFormatter();
  const [jobId, setJobId] = useQueryState("jobId");
  const filter = jobId ? { jobId: jobId as Id<"extractionJobs"> } : {};
  const usage = useProtectedPaginatedQuery(api.billing.usage.listMine, filter, {
    initialNumItems: PAGE_SIZE,
  });
  const isEmpty = usage.hasLoadedFirstPage && usage.results.length === 0;

  return (
    <section className="space-y-3" aria-labelledby="usage-history-title">
      <div className="flex h-8 items-center justify-between">
        <h3 id="usage-history-title" className="text-sm font-medium">
          {t("title")}
        </h3>
        {jobId && (
          <Button variant="ghost" size="sm" onClick={() => setJobId(null)}>
            {t("showAll")}
          </Button>
        )}
      </div>
      <div className="h-[28rem] overflow-y-auto rounded-xl border border-border/50 bg-muted/30">
        {isEmpty ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ul aria-busy={!usage.hasLoadedFirstPage}>
            {usage.results.map((row) => {
              const Icon = KIND_ICONS[row.kind] ?? Search;
              return (
                <li
                  key={row._id}
                  className="flex h-14 items-center gap-3 border-b border-border/30 px-4 last:border-b-0"
                >
                  <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {row.jobId ? (
                        <Link href={`/extraction/${row.jobId}`} className="hover:underline">
                          {row.description}
                        </Link>
                      ) : (
                        row.description
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t(`kinds.${row.kind}`)}
                    </div>
                  </div>
                  <time
                    dateTime={new Date(row.createdAt).toISOString()}
                    className="flex-shrink-0 text-xs text-muted-foreground tabular-nums"
                  >
                    {format.dateTime(new Date(row.createdAt), {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  <span className="w-20 flex-shrink-0 text-right font-mono text-sm tabular-nums">
                    −{format.number(row.credits)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {usage.status === "CanLoadMore" && (
          <div className="flex justify-center p-3">
            <Button variant="ghost" size="sm" onClick={() => usage.loadMore(PAGE_SIZE)}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
