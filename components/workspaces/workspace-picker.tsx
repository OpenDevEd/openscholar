"use client";

// One of your workspaces to pick (#651): an app connected with /connect draws on the credits of
// the one picked.

import { useFormatter, useTranslations } from "next-intl";
import { Check } from "@/components/icons";
import { LIST } from "@/components/settings/parts";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useWorkspaces, WorkspaceTile } from "./parts";

export function WorkspacePicker({ value, onChange, disabled = false }: { value: Id<"workspaces"> | undefined; onChange: (workspaceId: Id<"workspaces">) => void; disabled?: boolean }) {
  const t = useTranslations("workspaces");
  const tc = useTranslations("common");
  const format = useFormatter();
  const workspaces = useWorkspaces();
  return (
    <div role="radiogroup" aria-label={t("workspace")} className={LIST}>
      {(workspaces.list ?? []).map((workspace) => {
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
              <span className="block text-xs tabular-nums text-muted-foreground">{t("creditsLeft", { credits: format.number(Math.floor(workspace.credits ?? 0)) })}</span>
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
