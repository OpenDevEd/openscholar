"use client";

// One of your workspaces to pick (#651): an app connected with /connect draws on the credits of
// the one picked.

import { useFormatter, useTranslations } from "next-intl";
import { Check } from "@/components/icons";
import { LIST } from "@/components/settings/parts";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useWorkspaces, WorkspaceTile, type WorkspaceRow } from "./parts";

/**
 * `except` leaves one out, such as the one an item is moving from; `detail` says what each line under its name says,
 * its credits unless given; `refused` says why one can't be picked, which then shows in its place, the line off.
 */
export function WorkspacePicker({ value, onChange, disabled = false, except, detail, refused }: { value: Id<"workspaces"> | undefined; onChange: (workspaceId: Id<"workspaces">) => void; disabled?: boolean; except?: Id<"workspaces">; detail?: (workspace: WorkspaceRow) => string; refused?: (workspace: WorkspaceRow) => string | undefined }) {
  const t = useTranslations("workspaces");
  const tc = useTranslations("common");
  const format = useFormatter();
  const workspaces = useWorkspaces();
  return (
    <div role="radiogroup" aria-label={t("workspace")} className={LIST}>
      {(workspaces.list ?? []).filter((workspace) => workspace.workspaceId !== except).map((workspace) => {
        const on = workspace.workspaceId === value;
        const why = refused?.(workspace);
        return (
          <button
            key={workspace.workspaceId}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled || why !== undefined}
            onClick={() => onChange(workspace.workspaceId)}
            className={cn("flex w-full items-center gap-3 p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50", on ? "bg-primary/5" : "enabled:hover:bg-muted/50")}
          >
            <WorkspaceTile workspace={workspace} className="self-start" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{workspace.name}</span>
              <span className="block text-xs tabular-nums text-muted-foreground">{why ?? (detail ? detail(workspace) : t("creditsLeft", { credits: format.number(Math.floor(workspace.credits ?? 0)) }))}</span>
            </span>
            <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
              {on ? <Check className="size-3" /> : null}
            </span>
          </button>
        );
      })}
      {workspaces.more ? (
        <button type="button" disabled={workspaces.loading} onClick={workspaces.loadMore} className="flex w-full items-center justify-center px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-60">
          {tc("showMore")}
        </button>
      ) : null}
    </div>
  );
}
