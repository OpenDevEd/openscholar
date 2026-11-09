"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Hourglass, PublishIcon } from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";

/** Owners and editors may publish; everyone else's papers wait in the review queue. */
export const publishes = (role: string | null | undefined) => role === "owner" || role === "editor";

/**
 * Where papers go: straight onto the community, or into its review queue. Owners and editors get both, Publish
 * first; everyone else gets Send for review alone. The same choice everywhere papers are added: the Sources tab,
 * Discover and the record editor.
 */
export function PublishChoice({
  canPublish,
  disabled,
  sending,
  onSend,
  size = "default",
}: {
  canPublish: boolean;
  disabled?: boolean;
  /** Which button was pressed, while its request runs. */
  sending?: "publish" | "queue" | null;
  onSend: (publish: boolean) => void;
  size?: "sm" | "default";
}) {
  const t = useTranslations("addedPapers");
  const busy = Boolean(sending);
  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        type="button"
        size={size}
        variant={canPublish ? "outline" : "default"}
        disabled={disabled || busy}
        onClick={() => onSend(false)}
      >
        {sending === "queue" ? <Spinner /> : <Hourglass />}
        {t("sendToQueue")}
      </Button>
      {canPublish ? (
        <Button type="button" size={size} disabled={disabled || busy} onClick={() => onSend(true)}>
          {sending === "publish" ? <Spinner /> : <PublishIcon />}
          {t("publish")}
        </Button>
      ) : null}
    </div>
  );
}
