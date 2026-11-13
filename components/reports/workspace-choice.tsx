"use client";

// Which workspace a new report will belong to (#1412), chosen where its licence and its payment are. The report is
// that workspace's from signing on: its members see it and its publication balance pays for it. Two walkers out of two
// with a lab published in their own workspace, because publishing never said which one it was in.

import NextLink from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight, TriangleAlert } from "@/components/icons";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FieldHelp } from "@/components/reports/field-help";
import { PHONE_WRAP } from "@/components/reports/payment-choice";
import { Segmented } from "@/components/settings/parts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MemberFaces, WorkspaceTile, type WorkspaceRow } from "@/components/workspaces/parts";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

/** As many workspaces as sit side by side as a switch; more are a list to open. */
const SIDE_BY_SIDE = 2;

/**
 * `workspaces` are the person's, their own first; `value` is the one the report is to belong to. Beside the choice,
 * who will see the report there, or why the workspace picked can't start one, with where its plans are.
 */
export function WorkspaceChoice({ workspaces, value, onChange, heading, blocked }: { workspaces: WorkspaceRow[]; value: Id<"workspaces">; onChange: (workspaceId: Id<"workspaces">) => void; /** How the step names its sections. */ heading: string; /** Why the workspace picked starts no report now, said where it was picked: the button it shuts is a screen further down. */ blocked?: { why: string; plans: string } | null }) {
  const t = useTranslations("workspaces");
  const tf = useTranslations("publishReports.flow");
  const chosen = workspaces.find((workspace) => workspace.workspaceId === value);
  return (
    <>
      <h3 className={heading}>
        {t("workspace")}
        <FieldHelp field="workspace" />
      </h3>
      {/* The step shows after the page has loaded, so its photos and logos fade in. */}
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", AVATARS_FADE_IN)}>
        {workspaces.length <= SIDE_BY_SIDE ? (
          <Segmented
            size="md"
            label={t("workspace")}
            value={value}
            onChange={onChange}
            className={cn("max-w-full shrink flex-wrap rounded-[1.375rem]", PHONE_WRAP)}
            options={workspaces.map((workspace) => ({ id: workspace.workspaceId, label: workspace.name, lead: <WorkspaceTile workspace={workspace} size="xs" /> }))}
          />
        ) : (
          // ponytail: lists the first page of the person's workspaces (20). Past that, page the list as the Move dialog's picker does.
          <Select value={value} onValueChange={(picked) => onChange(picked as Id<"workspaces">)}>
            <SelectTrigger aria-label={t("workspace")} className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            {/* The list is drawn outside the row, so it is given the fade itself. */}
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
        )}
        {blocked ? (
          <p role="status" className="flex min-w-0 flex-1 basis-72 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
            <span className="flex min-w-0 flex-1 basis-56 items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
              <span className="text-pretty">{blocked.why}</span>
            </span>
            <Button size="sm" variant="outline" asChild>
              <NextLink href={blocked.plans}>
                {tf("seePlans")} <ArrowUpRight />
              </NextLink>
            </Button>
          </p>
        ) : chosen ? (
          <p key={chosen.workspaceId} className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
            {chosen.kind === "organization" ? <MemberFaces workspaceId={chosen.workspaceId} label={t("members", { count: chosen.members ?? 0 })} ring="ring-card" count={chosen.members} /> : null}
            {chosen.kind === "organization" ? t("move.membersSee", { count: chosen.members ?? 0 }) : t("move.onlyYou")}
          </p>
        ) : null}
      </div>
    </>
  );
}
