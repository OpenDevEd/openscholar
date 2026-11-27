"use client";
"use no memo"; // try/finally in handlers

// Moving an item to another of your workspaces (#654): you pick one, see what goes with it, and
// go with it, so it stays open in the workspace it moved to.

import { collectionHref } from "@/lib/library/links";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { IconButton } from "@/components/assistant/parts";
import { ArrowRight, Info, X } from "@/components/icons";
import { Chip } from "@/components/screening/parts";
import { Zone } from "@/components/settings/parts";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, focusContent } from "@/components/ui/dialog";
import { showStyledToast } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { panelPlace, withThread, workspaceKey } from "@/lib/assistant/place";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { workspaceHref } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { useCurrentWorkspace, useWorkspaces } from "./parts";
import { switchTarget } from "@/lib/workspaces/paths";
import { WorkspacePicker } from "./workspace-picker";
import { screeningPath } from "@/lib/screening/links";

export type Movable = "collection" | "search" | "screening" | "extraction" | "chat" | "author" | "community";

/** What goes with each kind of item, as chips. */
const GOES = {
  collection: ["itsPapers", "ratingsInIt", "activity"],
  author: ["publications", "editors", "activity"],
  search: ["resultsRatings", "screeningAnswers", "earlierQueries", "activity"],
  screening: ["itsPapers", "votes", "settings", "activity"],
  extraction: ["answers", "questions", "pdfs", "activity"],
  chat: ["messages", "files"],
  community: ["address", "settings", "peopleWithRoles"],
} as const;

/** Where the item opens in the workspace it moved to. */
const PAGE: Record<Exclude<Movable, "chat">, (id: string) => string> = {
  collection: collectionHref,
  author: (id) => `/authors/${id}`,
  search: (id) => `/results/${id}`,
  screening: screeningPath,
  extraction: (id) => `/extraction/${id}`,
  community: (id) => `/evidence-communities/${id}/configuration`,
};

export type MoveEffects = (to: { name: string; kind: "personal" | "organization" }, from: { name: string; kind: "personal" | "organization" } | undefined) => ReactNode;

/**
 * `from` is the workspace the item is in, when the page isn't (a profile opened by its public
 * link); `onMoved` hears the move done, before the page goes to where the item went. `effects` is
 * what else the move changes for this item, said once a workspace is picked.
 */
export function MoveDialog({ open, onOpenChange, ...item }: { open: boolean; onOpenChange: (open: boolean) => void; kind: Movable; id: string; name: string; from?: Id<"workspaces">; onMoved?: () => void; /** Goes to the item where it went, where the page it was on knows better than a replace: its own pages left out of the way back. */ lead?: (href: string) => void; effects?: MoveEffects }) {
  const page = useWorkspace();
  // Read here, while the dialog is shut, so it opens knowing whether the item can move. The same read inside shares it.
  useProtectedQuery(api.workspaces.move.held, inWorkspace(item.from ?? page, { kind: item.kind, id: item.id }));
  useProtectedQuery(api.workspaces.move.refusals, item.kind === "community" || item.kind === "author" ? inWorkspace(item.from ?? page, { kind: item.kind, id: item.id }) : "skip");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} onOpenAutoFocus={focusContent} className="top-[max(1rem,12dvh)] flex max-h-[min(40rem,calc(88dvh-1rem))] max-w-lg translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0">
        {/* Inside the content, so what was picked starts blank each time. */}
        <Move close={() => onOpenChange(false)} {...item} />
      </DialogContent>
    </Dialog>
  );
}

function Move({ close, kind, id, name, from: itemWorkspace, onMoved, lead, effects }: { close: () => void; kind: Movable; id: string; name: string; from?: Id<"workspaces">; onMoved?: () => void; lead?: (href: string) => void; effects?: MoveEffects }) {
  const t = useTranslations("workspaces.move");
  const tc = useTranslations("common");
  const router = useRouter();
  const page = useWorkspace();
  const current = useCurrentWorkspace();
  const workspaces = useWorkspaces();
  const workspaceId = itemWorkspace ?? page;
  const from = itemWorkspace ? workspaces.list?.find((workspace) => workspace.workspaceId === itemWorkspace) : current;
  const { data: held } = useProtectedQuery(api.workspaces.move.held, inWorkspace(workspaceId, { kind, id }));
  // The workspaces that won't take it, which the picker shows as such before one is picked: only a community or an author profile is turned away.
  const refusals = useProtectedQuery(api.workspaces.move.refusals, kind === "community" || kind === "author" ? inWorkspace(workspaceId, { kind, id }) : "skip").data?.page;
  const checking = (kind === "community" || kind === "author") && refusals === undefined;
  const refusalOf = (workspace: { workspaceId: string }) => {
    const refusal = refusals?.find((row) => row.workspaceId === workspace.workspaceId)?.refusal;
    return refusal ? t(`refused.${refusal}`) : undefined;
  };
  const run = useMutation(api.workspaces.move.move);
  const [to, setTo] = useState<Id<"workspaces">>();
  const [busy, setBusy] = useState(false);
  const target = workspaces.list?.find((workspace) => workspace.workspaceId === to);

  const go = async () => {
    if (!target || held || !workspaceId) return;
    setBusy(true);
    try {
      await run({ workspaceId, kind, id, to: target.workspaceId });
    } catch (error) {
      showStyledToast("error", getErrorMessage(error, tc("somethingWentWrong")));
      setBusy(false);
      return;
    }
    onMoved?.();
    // You go with it: in the workspace it moved to, it's the item open, a chat in the panel included.
    const slug = target.kind === "organization" ? target.slug : undefined;
    if (kind === "chat") {
      panelPlace.set((place) => withThread(withThread(place, workspaceKey(window.location.pathname), null), slug ?? "", id));
      router.push(switchTarget(slug, window.location.pathname, window.location.search.slice(1)));
      // The item's page in the workspace it went to takes the place of the page it left, where it is no longer: Back never returns there.
    } else if (lead) lead(workspaceHref(slug, PAGE[kind](id)));
    else router.replace(workspaceHref(slug, PAGE[kind](id)));
    close();
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base">{t(kind)}</DialogTitle>
          <DialogDescription className="truncate text-xs">{name}</DialogDescription>
        </div>
        <IconButton label={tc("close")} icon={<X className="size-4" />} onClick={close} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Known before the dialog opens wherever it's mounted while shut. Where it isn't, the warning slides in. */}
        <AutoHeight>
          {held ? (
            <div className="pb-6">
              <p className="flex items-start gap-2.5 rounded-2xl bg-warning/10 p-3 text-sm ink-warning">
                <Info className="mt-0.5 size-4 shrink-0" />
                {held}
              </p>
            </div>
          ) : null}
        </AutoHeight>
        <div className="space-y-6">
          <Zone label={t("fromTo", { workspace: from?.name ?? "" })}>
            <WorkspacePicker
              value={to}
              onChange={setTo}
              disabled={Boolean(held) || busy}
              except={workspaceId}
              refused={refusalOf}
              detail={(workspace) => (workspace.kind === "personal" ? t("onlyYou") : t("membersSee", { count: workspace.members ?? 0 }))}
            />
          </Zone>
          <Zone label={t("goesWithIt")}>
            <div className="flex flex-wrap gap-1.5">
              {GOES[kind].map((what) => (
                <Chip key={what} className="text-foreground">
                  {t(`goes.${what}`)}
                </Chip>
              ))}
            </div>
            {kind === "collection" ? <p className="px-1 text-xs text-muted-foreground">{from?.kind === "organization" ? t("libraryKeeps", { workspace: from.name }) : t("yourLibraryKeeps")}</p> : null}
            {kind === "community" ? <p className="px-1 text-xs text-muted-foreground">{t("workspaceOwnsIt")}</p> : null}
          </Zone>
          {effects && !held ? (
            <Zone label={t("whatElseChanges")}>{target ? effects(target, from ?? undefined) : <p className="px-1 text-sm text-muted-foreground">{t("pickToSee")}</p>}</Zone>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border/50 px-4 py-3">
        <Button variant="ghost" onClick={close}>
          {tc("cancel")}
        </Button>
        {/* Until it's known whether it can move, it can't. */}
        {/* Until it's known which workspaces turn it away, nothing is moved; a picked one turned away isn't either. */}
        <Button disabled={!target || held !== null || busy || checking || (target && refusalOf(target) !== undefined)} onClick={() => void go()}>
          {target ? t("moveTo", { workspace: target.name }) : t("move")}
          <ArrowRight />
        </Button>
      </div>
    </>
  );
}
