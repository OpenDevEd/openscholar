"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";
import { normalizeOpenAlexId } from "@/lib/openalex/normalize";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { showStyledToast } from "@/components/ui/sonner";
import {
  resolveToastError,
  getToastMessageKeyForErrorCode,
} from "@/lib/toast/error-resolver";

export function ManualIdsTab() {
  const t = useTranslations("extraction.selector");
  const tToast = useTranslations("toast");
  const resolveManualIds = useAction(api.openalex.actions.resolveManualIds);
  const { addToBasket } = useAddToBasket();
  const [idText, setIdText] = useState("");
  const [isResolving, setIsResolving] = useState(false);

  const handleResolve = useCallback(async () => {
    const lines = idText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return;

    // Pre-validate: filter out lines that don't normalize to valid OpenAlex IDs
    const validLines: string[] = [];
    for (const line of lines) {
      const normalized = normalizeOpenAlexId(line);
      if (normalized) {
        validLines.push(line);
      }
    }

    if (validLines.length === 0) {
      showStyledToast("error", t("manualResolveError"));
      return;
    }

    setIsResolving(true);
    try {
      const result = await resolveManualIds({ rawInputs: validLines });

      // Map resolved entries to basket format
      const toAdd = result.resolved.map(
        (r: { openalexId: string; title: string; doi?: string }) => ({
          rawId: r.openalexId,
          title: r.title,
          doi: r.doi ?? null,
          source: "manual" as const,
        }),
      );

      if (toAdd.length > 0) {
        const basketResult = addToBasket(toAdd);

        if (basketResult.dropped > 0) {
          toast.info(
            t("addedWithDropped", {
              added: basketResult.added,
              dropped: basketResult.dropped,
            }),
          );
        } else {
          toast.success(
            t("manualResolveSuccess", { added: basketResult.added }),
          );
        }
      }

      // Show error for unresolvable IDs
      if (result.unresolvable.length > 0) {
        showStyledToast("error", t("manualResolveError"), {
          description: result.unresolvable.join(", "),
        });
      }

      // Clear textarea on success (even partial)
      if (result.resolved.length > 0) {
        setIdText("");
      }
    } catch (error: unknown) {
      const resolved = resolveToastError(error, t("manualResolveError"));
      const messageKey = getToastMessageKeyForErrorCode(resolved.code);
      showStyledToast(
        "error",
        messageKey ? tToast(messageKey) : resolved.message,
      );
    } finally {
      setIsResolving(false);
    }
  }, [idText, resolveManualIds, addToBasket, t, tToast]);

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h3 className="text-sm font-semibold">{t("manualHeading")}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {t("manualBody")}
        </p>
      </div>

      <Textarea
        value={idText}
        onChange={(e) => setIdText(e.target.value)}
        placeholder={"W2741809807\nW3045892101\nhttps://openalex.org/W2741809807"}
        rows={8}
        className="font-mono text-sm"
        disabled={isResolving}
      />

      <Button
        onClick={handleResolve}
        disabled={idText.trim() === "" || isResolving}
      >
        {isResolving ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("manualResolving")}
          </span>
        ) : (
          t("manualResolve")
        )}
      </Button>
    </div>
  );
}
