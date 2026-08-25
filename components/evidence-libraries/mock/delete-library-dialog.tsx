"use client";

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
import type { MockLibrary } from "@/lib/evidence-libraries/mock/data";
import { useEvidenceLibraryMockStore } from "@/lib/evidence-libraries/mock/store";

export function DeleteLibraryDialog({
  library,
  open,
  onOpenChange,
  onDeleted,
}: {
  library: MockLibrary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const t = useTranslations("evidenceLibraryMock.deleteDialog");
  const tc = useTranslations("common");
  const deleteLibrary = useEvidenceLibraryMockStore((s) => s.deleteLibrary);
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const matches = library !== null && typed.trim() === library.name;

  function handleOpenChange(next: boolean) {
    if (!next) setTyped("");
    onOpenChange(next);
  }

  function confirm() {
    if (!library || !matches) return;
    deleteLibrary(library.id);
    toast(t("startedTitle"), {
      description: t("startedDescription", { name: library.name }),
    });
    setTyped("");
    onDeleted?.();
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {library
              ? t("body", { name: library.name, address: library.address })
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {library ? (
          <div className="space-y-2">
            <Label htmlFor={inputId}>
              {t("typeToConfirm", { name: library.name })}
            </Label>
            <Input
              id={inputId}
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={library.name}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!matches}
            onClick={confirm}
            variant="destructive"
          >
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
