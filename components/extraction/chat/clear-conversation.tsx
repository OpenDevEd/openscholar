"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { Trash2Icon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import { useAppToast } from "@/lib/toast";

export interface ClearConversationProps {
  threadId: string;
  disabled: boolean;
}

export function ClearConversation({
  threadId,
  disabled,
}: ClearConversationProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const [open, setOpen] = useState(false);
  const clearThread = useMutation(api.chat.messages.clearThread);

  const handleConfirm = useCallback(async () => {
    try {
      await clearThread({ threadId });
      setOpen(false);
      // Return focus to the composer textarea after the dialog closes.
      // data-chat-composer="true" is set on the PromptInput root; the
      // textarea is its only focusable child.
      requestAnimationFrame(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '[data-chat-composer] textarea',
        );
        textarea?.focus();
      });
    } catch (err) {
      toast.error(t("chatFailedMessage"));
      console.error("clear thread failed", err);
    }
  }, [clearThread, threadId, toast, t]);

  const button = (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      aria-label={t("chatClearTitle")}
      data-action="clear"
      data-disabled={disabled}
    >
      <Trash2Icon className="size-4" />
    </Button>
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {disabled ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{button}</span>
            </TooltipTrigger>
            <TooltipContent>{t("chatWaitForResponse")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
      )}

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("chatClearTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("chatClearDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            variant="destructive"
          >
            {t("chatClearConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
