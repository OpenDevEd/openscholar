"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useBucketStore } from "@/lib/store/bucket";
import { useTranslations } from "next-intl";
import { FileText, MessageSquare, Bot } from "lucide-react";

interface ChatStartReviewProps {
  modelId: Id<"models"> | null;
}

export function ChatStartReview({ modelId }: ChatStartReviewProps) {
  const t = useTranslations("extraction");
  const order = useBucketStore((s) => s.order);
  const items = useBucketStore((s) => s.items);
  const models = useQuery(api.chat.model.listChatModels, {});

  const { totalPapers, withAbstract } = useMemo(() => {
    let total = 0;
    let withAbs = 0;
    for (const k of order) {
      const item = items[k];
      if (!item || item.status !== "ready") continue;
      total += 1;
      if (item.abstract && item.abstract.trim().length > 0) withAbs += 1;
    }
    return { totalPapers: total, withAbstract: withAbs };
  }, [order, items]);

  const modelName = useMemo(() => {
    if (!models || !modelId) return null;
    return models.find((m) => m._id === modelId)?.name ?? null;
  }, [models, modelId]);

  return (
    <div
      data-role="chat-start-review"
      className="max-w-xl mx-auto space-y-6"
    >
      <div className="text-center">
        <h2 className="text-2xl font-bold text-foreground mb-2">
          {t("chatStartReviewTitle")}
        </h2>
        <p className="text-muted-foreground">
          {t("chatStartReviewSubtitle")}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted p-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">
              {t("chatStartReviewPapers", { count: totalPapers })}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("chatStartReviewAbstracts", { count: withAbstract })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted p-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">
              {modelName ?? t("chatStartReviewNoModel")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("chatStartReviewModelHint")}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
        <MessageSquare className="h-4 w-4 mt-0.5 shrink-0" />
        <p>{t("chatStartReviewCta")}</p>
      </div>
    </div>
  );
}
