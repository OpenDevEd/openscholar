"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Asks the owner to type the library name, then queues the development
 * teardown and sends them to the libraries page that shows its progress.
 */
export function DeleteLibraryDialog({
  libraryId,
  name,
  address,
  open,
  onOpenChange,
}: {
  libraryId: Id<"evidenceLibraries">;
  name: string;
  address: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.deleteDialog");
  const tc = useTranslations("common");
  const router = useRouter();
  const requestTeardown = useMutation(
    api.evidenceLibraries.teardown.requestDevelopmentTeardown,
  );
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const inputId = useId();
  const matches = typed.trim() === name;

  function handleOpenChange(next: boolean) {
    if (!next) setTyped("");
    onOpenChange(next);
  }

  function confirm(event: React.MouseEvent) {
    event.preventDefault();
    if (!matches || deleting) return;
    setDeleting(true);
    void requestTeardown({ libraryId, confirmationName: typed.trim() })
      .then((result) => {
        toast(t("startedTitle"), { description: t("startedDescription", { name }) });
        router.push(`/evidence-libraries/new?teardownOperationId=${result.operationId}`);
      })
      .catch(() => toast.error(t("error")))
      .finally(() => setDeleting(false));
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("body", { name, address })}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={inputId}>{t("typeToConfirm", { name })}</Label>
          <Input
            id={inputId}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={name}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={!matches || deleting} onClick={confirm} variant="destructive">
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
