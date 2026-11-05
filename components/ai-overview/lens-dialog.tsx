"use client";

// Making or changing a lens for AI overviews (#967). Its state is inside DialogContent, so each opening starts from the
// lens it opened on.

import { useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import type { Infer } from "convex/values";
import { api } from "@/convex/_generated/api";
import { INSTRUCTION_MAX, NAME_MAX, type overviewLensValidator } from "@/convex/research/overviewValidators";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Users } from "@/components/icons";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import { trackOverview } from "@/lib/posthog-overview";

export type Lens = Infer<typeof overviewLensValidator>;
type Scope = { accountId: string; workspaceId: Id<"workspaces"> };

export function LensDialog({ scope, lens, open, onOpenChange }: { scope: Scope; lens: Lens | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <LensForm key={lens?.id ?? "new"} scope={scope} lens={lens} done={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function LensForm({ scope, lens, done }: { scope: Scope; lens: Lens | null; done: () => void }) {
  const t = useTranslations("overview.dialog");
  const toast = useAppToast();
  const save = useMutation(api.research.overviews.saveLens);
  const [name, setName] = useState(lens?.name ?? "");
  const [instruction, setInstruction] = useState(lens?.instruction ?? "");
  const [shared, setShared] = useState(lens?.shared ?? false);
  const [saving, setSaving] = useState(false);
  const ready = name.trim() && instruction.trim() && !saving;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!ready) return;
        setSaving(true);
        try {
          await save({ ...scope, ...(lens ? { id: lens.id } : {}), name, instruction, shared });
          trackOverview("overview_lens_saved", { shared, edited: Boolean(lens) });
          done();
        } catch (error) {
          toast.error(lens ? t("editTitle") : t("newTitle"), getErrorMessage(error, ""));
          setSaving(false);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{lens ? t("editTitle") : t("newTitle")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <label className="grid gap-1.5 text-sm font-medium">
        {t("name")}
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} maxLength={NAME_MAX} autoFocus />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        {t("instruction")}
        <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t("instructionPlaceholder")} className="min-h-24 font-normal" maxLength={INSTRUCTION_MAX} />
      </label>
      <label className="flex items-center gap-3 rounded-xl bg-inset px-3 py-2.5 text-sm">
        <Users className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">{t("share")}</span>
        <Switch checked={shared} onCheckedChange={setShared} />
      </label>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={done}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={!ready}>
          {lens ? t("save") : t("add")}
        </Button>
      </DialogFooter>
    </form>
  );
}
