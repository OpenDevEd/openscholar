"use client";

// Which workspace a new report will belong to (#1412), chosen where its licence and its payment are. The report is
// that workspace's from signing on: its members see it and its publication balance pays for it. Two walkers out of two
// with a lab published in their own workspace, because publishing never said which one it was in.

import { useTranslations } from "next-intl";
import { FieldHelp } from "@/components/reports/field-help";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WorkspaceTile, type WorkspaceRow } from "@/components/workspaces/parts";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

/** `workspaces` are the person's, their own first; `value` is the one the report is to belong to. */
export function WorkspaceChoice({ workspaces, value, onChange, heading }: { workspaces: WorkspaceRow[]; value: Id<"workspaces">; onChange: (workspaceId: Id<"workspaces">) => void; /** How the step names its sections. */ heading: string }) {
  const t = useTranslations("workspaces");
  return (
    <>
      <h3 className={heading}>
        {t("workspace")}
        <FieldHelp field="workspace" />
      </h3>
      {/* ponytail: lists the first page of the person's workspaces (20). Past that, page the list as the Move dialog's picker does. */}
      <Select value={value} onValueChange={(picked) => onChange(picked as Id<"workspaces">)}>
        {/* The step shows after the page has loaded, so its photos and logos fade in: here, and in the list, which is drawn outside the row. */}
        <SelectTrigger aria-label={t("workspace")} className={cn("w-full sm:w-72", AVATARS_FADE_IN)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={AVATARS_FADE_IN}>
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.workspaceId} value={workspace.workspaceId}>
              <span className="flex min-w-0 items-center gap-2">
                <WorkspaceTile workspace={workspace} size="xs" />
                <span className="truncate">{workspace.name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
