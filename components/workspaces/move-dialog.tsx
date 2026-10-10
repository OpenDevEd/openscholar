"use client";
"use no memo"; // try/finally in handlers

// Moving an item to another of your workspaces (#654): you pick one, see what goes with it, and
// go with it, so it stays open in the workspace it moved to.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconButton } from "@/components/assistant/parts";
import { ArrowRight, Info, X } from "@/components/icons";
import { Chip } from "@/components/screening/parts";
import { Zone } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, focusContent } from "@/components/ui/dialog";
import { showStyledToast } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { panelPlace, withThread, workspaceKey } from "@/lib/assistant/place";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { workspaceHref } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import { useCurrentWorkspace, useWorkspaces } from "./parts";
import { switchTarget } from "./switcher";
import { WorkspacePicker } from "./workspace-picker";

export type Movable = "collection" | "search" | "screening" | "extraction" | "chat" | "author";

/** What goes with each kind of item, as chips. */
const GOES = {
  collection: ["itsPapers", "ratingsInIt", "activity"],
  author: ["publications", "editors"],
  search: ["resultsRatings", "screeningAnswers", "earlierQueries", "activity"],
  screening: ["answers", "questions", "activity"],
  extraction: ["answers", "questions", "pdfs", "activity"],
  chat: ["messages", "files"],
} as const;

/** Where the item opens in the workspace it moved to. */
const PAGE: Record<Exclude<Movable, "chat">, (id: string) => string> = {
  collection: (id) => `/library?col=${id}`,
  author: (id) => `/authors/${id}`,
  search: (id) => `/results/${id}`,
  screening: (id) => `/screening?job=${id}`,
  extraction: (id) => `/extraction/${id}`,
};

/** `onMoved` hears the move done, before the page goes to where the item went. */
export function MoveDialog({ open, onOpenChange, ...item }: { open: boolean; onOpenChange: (open: boolean) => void; kind: Movable; id: string; name: string; onMoved?: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} onOpenAutoFocus={focusContent} className="top-[max(1rem,12dvh)] flex max-h-[min(40rem,calc(88dvh-1rem))] max-w-lg translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0">
        {/* Inside the content, so it starts blank each time and reads nothing while it's shut. */}
        <Move close={() => onOpenChange(false)} {...item} />
      </DialogContent>
    </Dialog>
  );
}

function Move({ close, kind, id, name, onMoved }: { close: () => void; kind: Movable; id: string; name: string; onMoved?: () => void }) {
  const t = useTranslations("workspaces.move");
  const tc = useTranslations("common");
  const router = useRouter();
  const workspaceId = useWorkspace();
  const from = useCurrentWorkspace();
  const workspaces = useWorkspaces();
  const { data: held } = useProtectedQuery(api.workspaces.move.held, inWorkspace(workspaceId, { kind, id }));
  const move = useWorkspaceMutation(api.workspaces.move.move);
  const [to, setTo] = useState<Id<"workspaces">>();
  const [busy, setBusy] = useState(false);
  const target = workspaces.list?.find((workspace) => workspace.workspaceId === to);

  const go = async () => {
    if (!target || held) return;
    setBusy(true);
    try {
      await move({ kind, id, to: target.workspaceId });
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
    } else router.push(workspaceHref(slug, PAGE[kind](id)));
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
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {held ? (
          <p className="flex items-start gap-2.5 rounded-2xl bg-warning/10 p-3 text-sm ink-warning">
            <Info className="mt-0.5 size-4 shrink-0" />
            {held}
          </p>
        ) : null}
        <Zone label={t("fromTo", { workspace: from?.name ?? "" })}>
          <WorkspacePicker
            value={to}
            onChange={setTo}
            disabled={Boolean(held) || busy}
            except={workspaceId}
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
        </Zone>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border/50 px-4 py-3">
        <Button variant="ghost" onClick={close}>
          {tc("cancel")}
        </Button>
        {/* Until it's known whether it can move, it can't. */}
        <Button disabled={!target || held !== null || busy} onClick={() => void go()}>
          {target ? t("moveTo", { workspace: target.name }) : t("move")}
          <ArrowRight />
        </Button>
      </div>
    </>
  );
}
