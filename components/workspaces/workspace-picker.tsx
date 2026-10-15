"use client";

// One of your workspaces to pick (#651): an app connected with /connect draws on the credits of
// the one picked.

import { useFormatter, useTranslations } from "next-intl";
import { Check } from "@/components/icons";
import { LIST } from "@/components/settings/parts";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useWorkspaces, WorkspaceTile, type WorkspaceRow } from "./parts";

/** The workspaces a picker lists: the page's own once read, the server's `read` until then, and `include` wherever it is, as the one an address is in may be past the pages read. */
export function usePickable(read?: ServerRead, include?: WorkspaceRow | null) {
  const workspaces = useWorkspaces();
  const list = workspaces.list ?? read?.list ?? [];
  return {
    ...workspaces,
    list: include && !list.some((workspace) => workspace.workspaceId === include.workspaceId) ? [...list, include] : list,
    more: workspaces.list ? workspaces.more : !!read?.more,
  };
}

/** A first page of workspaces read on the server, so a picker has it from the first frame. */
export type ServerRead = { list: WorkspaceRow[]; more: boolean };

/** `except` leaves one out, such as the one an item is moving from; `detail` says what each line under its name says, its credits unless given; `read` and `include` as `usePickable` takes them. */
export function WorkspacePicker({ value, onChange, disabled = false, except, detail, read, include }: { value: Id<"workspaces"> | undefined; onChange: (workspaceId: Id<"workspaces">) => void; disabled?: boolean; except?: Id<"workspaces">; detail?: (workspace: WorkspaceRow) => string; read?: ServerRead; include?: WorkspaceRow | null }) {
  const t = useTranslations("workspaces");
  const tc = useTranslations("common");
  const format = useFormatter();
  const workspaces = usePickable(read, include);
  return (
    <div role="radiogroup" aria-label={t("workspace")} className={LIST}>
      {workspaces.list.filter((workspace) => workspace.workspaceId !== except).map((workspace) => {
        const on = workspace.workspaceId === value;
        return (
          <button
            key={workspace.workspaceId}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(workspace.workspaceId)}
            className={cn("flex w-full items-center gap-3 p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50", on ? "bg-primary/5" : "enabled:hover:bg-muted/50")}
          >
            <WorkspaceTile workspace={workspace} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{workspace.name}</span>
              <span className="block text-xs tabular-nums text-muted-foreground">{detail ? detail(workspace) : t("creditsLeft", { credits: format.number(Math.floor(workspace.credits ?? 0)) })}</span>
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
