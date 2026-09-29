"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import type { LinkSafetyModalProps } from "streamdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppToast } from "@/lib/toast";

/** Streamdown's check before opening a link from an answer, on the app's own dialog. */
export function LinkSafetyDialog({
  isOpen,
  onClose,
  onConfirm,
  url,
}: LinkSafetyModalProps) {
  const t = useTranslations("extraction");
  const appToast = useAppToast();

  const copy = () => {
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t("chatCopied")))
      .catch(() => appToast.clipboard.copyFailed(t("chatCopyLink")));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("chatLinkTitle")}</DialogTitle>
          <DialogDescription>{t("chatLinkDescription")}</DialogDescription>
        </DialogHeader>
        <p className="max-h-32 overflow-y-auto break-all rounded-md bg-muted p-3 font-mono text-sm">
          {url}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={copy}>
            <CopyIcon />
            {t("chatCopyLink")}
          </Button>
          <Button type="button" onClick={onConfirm}>
            <ExternalLinkIcon />
            {t("chatOpenLink")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Stable across renders so MessageResponse's memo holds. */
export const CHAT_LINK_SAFETY = {
  enabled: true,
  renderModal: (props: LinkSafetyModalProps) => <LinkSafetyDialog {...props} />,
};
