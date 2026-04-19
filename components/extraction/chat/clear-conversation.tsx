"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/convex/_generated/api";
import { useAppToast } from "@/lib/toast";

interface ClearConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
}

/**
 * Controlled destructive-confirm dialog. Parent owns open state and
 * provides whatever trigger fits (DropdownMenuItem, Button, etc.) — the
 * old self-rendered icon-button was confusable with the model picker
 * and the "send" affordance, which is why the user called it deceptive.
 */
export function ClearConversationDialog({
  open,
  onOpenChange,
  threadId,
}: ClearConversationDialogProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const clearThread = useMutation(api.chat.messages.clearThread);

  const handleConfirm = useCallback(async () => {
    try {
      await clearThread({ threadId });
      onOpenChange(false);
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
  }, [clearThread, threadId, onOpenChange, toast, t]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-clear-conversation="true">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("chatClearTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("chatClearDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} variant="destructive">
            {t("chatClearConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
