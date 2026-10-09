"use client";

// Making and managing collections (#691): the same two dialogs from the sidebar, each paper's
// Save control and Manage, said for the workspace you're in. In your own a collection is only
// yours; in an organization every member can edit it.

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { create } from "zustand";
import { Check, Folder, Lock, PenLine, Plus, Search, Trash2, X } from "@/components/icons";
import { IconButton } from "@/components/assistant/parts";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { EASE } from "@/components/settings/model-map";
import { LIST, Paged, Tile } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipHint } from "@/components/ui/tooltip";
import { MemberFaces, useCurrentWorkspace, usePlanOf, WorkspaceTag } from "@/components/workspaces/parts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";

const FOLDER_TINT = "#e8890c";
/** Pinned from the top, so the name field never moves as the dialog grows. */
const DIALOG = "top-[max(1rem,12dvh)] flex max-h-[min(42rem,calc(88dvh-1rem))] max-w-lg translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0";

/** The large folder tile that heads a new or empty collection. */
function FolderTile() {
  return (
    <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `color-mix(in oklab, ${FOLDER_TINT} 18%, var(--background))`, color: FOLDER_TINT }}>
      <Folder className="size-6" />
    </span>
  );
}

/** A paper a new collection can start with, opened from its Save control. */
type StartingPaper = { title: string; add: (collectionId: Id<"collections">) => void };
/** Where focus goes as a dialog closes: these open from controls that aren't their trigger, or are gone by then. */
type ReturnFocus = () => HTMLElement | null | undefined;
const restoreFocus = (returnFocus: ReturnFocus | undefined) => (event: Event) => {
  const to = returnFocus?.();
  if (!to?.isConnected) return;
  event.preventDefault();
  to.focus();
};

export function NewCollectionDialog({ open, onOpenChange, paper, onCreated, returnFocus }: { open: boolean; onOpenChange: (open: boolean) => void; paper?: StartingPaper; onCreated?: (collectionId: Id<"collections">) => void; returnFocus?: ReturnFocus }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={DIALOG} onCloseAutoFocus={restoreFocus(returnFocus)}>
        {/* Inside the content, so it starts blank each time the dialog opens and reads nothing while it's shut. */}
        <NewCollection paper={paper} close={() => onOpenChange(false)} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  );
}

function NewCollection({ paper, close, onCreated }: { paper?: StartingPaper; close: () => void; onCreated?: (collectionId: Id<"collections">) => void }) {
  const t = useTranslations("libraryPage");
  const ts = useTranslations("saveToLibrary");
  const tc = useTranslations("common");
  const workspaceId = useWorkspace();
  const workspace = useCurrentWorkspace();
  const plan = usePlanOf(workspace ?? { kind: "personal", name: "" });
  const createCollection = useWorkspaceMutation(api.library.collections.createCollection);
  const { data: count } = useProtectedQuery(api.library.collections.countCollections, inWorkspace(workspaceId, {}));
  // The workspace's plan's most collections, as the server holds it to them; null for no limit.
  const { data: limits } = useProtectedQuery(api.billing.accounts.myLimits, inWorkspace(workspaceId, {}));
  const limit = limits === undefined ? undefined : (limits?.collections ?? null);
  const [name, setName] = useState("");
  const [withPaper, setWithPaper] = useState(true);
  const [creating, setCreating] = useState(false);
  const trimmed = name.trim();
  // Names aren't unique, so one already taken is pointed out, not refused.
  const search = useDebouncedValue(trimmed, 300);
  const { data: alike } = useProtectedQuery(api.library.collections.listCollections, inWorkspace(workspaceId, search ? { search, paginationOpts: { numItems: 10, cursor: null } } : "skip"));
  const twin = trimmed !== "" && alike?.page.some((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  const org = workspace?.kind === "organization";
  const full = typeof limit === "number" && count !== undefined && count >= limit;
  const reason = full ? t("planAllowsCollections", { plan: plan.name, limit }) : !trimmed ? t("nameTheCollection") : null;

  const make = () => {
    if (reason || creating) return;
    setCreating(true);
    createCollection({ name: trimmed })
      .then(({ id }) => {
        if (paper && withPaper) paper.add(id);
        close();
        onCreated?.(id);
      })
      .catch((error) => {
        console.error("[Library] Failed to create collection:", error);
        toast.error(ts("collectionError"));
        setCreating(false);
      });
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base">{ts("newCollection")}</DialogTitle>
          <DialogDescription className="sr-only">{t("newCollectionHint")}</DialogDescription>
        </div>
        <IconButton label={tc("close")} icon={<X className="size-4" />} onClick={close} />
      </div>
      <ScrollArea shades className="min-h-0 flex-1">
        <form
          className="space-y-5 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            make();
          }}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <FolderTile />
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog opens to name the collection
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("collectionNamePlaceholder")}
                aria-label={t("collectionNamePlaceholder")}
                maxLength={120}
                className="h-12 min-w-0 flex-1 rounded-xl border border-border/60 bg-background px-3.5 text-lg font-semibold tracking-tight outline-none placeholder:font-normal placeholder:text-muted-foreground focus:border-primary/40"
              />
            </div>
            <AnimatePresence initial={false}>
              {twin ? (
                <motion.div key="twin" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden pl-[3.75rem]">
                  <StatusChip tone="warning" icon={Folder}>
                    {org && workspace ? t("collectionNameTakenIn", { workspace: workspace.name }) : t("collectionNameTaken")}
                  </StatusChip>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <section className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t("whoSeesIt")}</p>
            <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-xl bg-inset p-2.5">
              {workspace ? <WorkspaceTag workspace={workspace} strong /> : null}
              {org ? (
                <>
                  <MemberFaces workspaceId={workspaceId} label={t("everyoneIn", { workspace: workspace.name })} ring="ring-(--color-inset)" />
                  <span className="ml-auto flex items-center gap-1.5 pr-1 text-xs text-muted-foreground">
                    <PenLine className="size-3.5" /> {t("everyMemberEdits")}
                  </span>
                </>
              ) : workspace ? (
                <span className="ml-auto flex items-center gap-1.5 pr-1 text-xs text-muted-foreground">
                  <Lock className="size-3.5" /> {t("onlyYou")}
                </span>
              ) : null}
            </div>
          </section>

          {paper ? (
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border-subtle p-3 transition-colors hover:bg-muted/60">
              <Checkbox checked={withPaper} onCheckedChange={(v) => setWithPaper(v === true)} aria-label={t("startWithPaper")} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">{t("startWith")}</span>
                <TooltipHint label={paper.title} onlyWhenClipped>
                  <span className="block truncate text-sm font-medium">{paper.title}</span>
                </TooltipHint>
              </span>
            </label>
          ) : null}
          <button type="submit" hidden />
        </form>
      </ScrollArea>

      <div className="flex flex-wrap items-center gap-3 border-t border-border/50 p-4">
        {count !== undefined && limit !== undefined ? <CollectionMeter count={count} limit={limit} plan={plan.name} /> : null}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={close}>
            {tc("cancel")}
          </Button>
          {reason && (full || trimmed) ? (
            <TooltipHint label={reason}>
              <span tabIndex={0} className="rounded-md">
                <Button disabled className="pointer-events-none">
                  <Plus /> {t("createCollection")}
                </Button>
              </span>
            </TooltipHint>
          ) : (
            <Button disabled={!trimmed || creating} onClick={make}>
              <Plus /> {t("createCollection")}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

/** Collections made against the plan: a bar while there's a limit, chips when there's none. */
function CollectionMeter({ count, limit, plan }: { count: number; limit: number | null; plan: string }) {
  const t = useTranslations("libraryPage");
  const format = useFormatter();
  if (limit === null) {
    return (
      <span className="flex items-center gap-1.5">
        <StatusChip tone="neutral" icon={Folder}>
          {t("collectionsCount", { count })}
        </StatusChip>
        <StatusChip tone="success" icon={Check}>
          {t("noCollectionLimit", { plan })}
        </StatusChip>
      </span>
    );
  }
  const share = Math.min(1, count / limit);
  return (
    <div className="w-44 space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          <Folder className="size-3.5 text-muted-foreground" /> {t("collectionsMeter")}
        </span>
        <span className="tabular-nums text-muted-foreground">{t("collectionsOf", { count: format.number(count), limit: format.number(limit) })}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <motion.div className={cn("h-full rounded-full", share >= 1 ? "bg-warning" : "bg-primary")} initial={false} animate={{ width: `${share * 100}%` }} transition={{ duration: 0.4, ease: EASE }} />
      </div>
    </div>
  );
}

/** How long a deleted collection can be put back. */
const UNDO_MS = 5000;

/** Collections deleted with their Undo still open: hidden at once, deleted when its time is up. Kept outside the dialog, so closing it doesn't drop a delete. */
const useDeleting = create<{ ids: string[] }>(() => ({ ids: [] }));

const MANAGE_PAGE = 8;
/** A row with its divider. */
const MANAGE_ROW_PX = 57;

/** Your collections a page at a time: rename, delete with Undo, and a new one through the dialog. */
export function ManageCollectionsDialog({ open, onOpenChange, onNew, returnFocus }: { open: boolean; onOpenChange: (open: boolean) => void; onNew: () => void; returnFocus?: ReturnFocus }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={DIALOG} onCloseAutoFocus={restoreFocus(returnFocus)}>
        <ManageCollections close={() => onOpenChange(false)} onNew={onNew} />
      </DialogContent>
    </Dialog>
  );
}

function ManageCollections({ close, onNew }: { close: () => void; onNew: () => void }) {
  const t = useTranslations("libraryPage");
  const ts = useTranslations("saveToLibrary");
  const tc = useTranslations("common");
  const workspaceId = useWorkspace();
  const workspace = useCurrentWorkspace();
  const renameCollection = useWorkspaceMutation(api.library.collections.renameCollection);
  const deleteCollection = useWorkspaceMutation(api.library.collections.deleteCollection);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 300);
  const { data: total } = useProtectedQuery(api.library.collections.countCollections, inWorkspace(workspaceId, {}));
  const list = useCursorPage(api.library.collections.listCollections, inWorkspace(workspaceId, { search: search || undefined }), MANAGE_PAGE);
  const deleting = useDeleting((s) => s.ids);
  const shown = list.items.filter((c) => !deleting.includes(c._id));
  const [editing, setEditing] = useState<Id<"collections"> | null>(null);
  const [draft, setDraft] = useState("");

  const startNew = () => {
    close();
    onNew();
  };
  const rename = (id: Id<"collections">, name: string) => {
    setEditing(id);
    setDraft(name);
  };
  const commit = (was: string) => {
    const name = draft.trim();
    if (editing && name && name !== was) {
      renameCollection({ collectionId: editing, name }).catch((error) => {
        console.error("[Library] Failed to rename collection:", error);
        toast.error(ts("collectionError"));
      });
    }
    setEditing(null);
  };
  const remove = (id: Id<"collections">, name: string) => {
    const keep = () => useDeleting.setState((s) => ({ ids: s.ids.filter((x) => x !== id) }));
    useDeleting.setState((s) => ({ ids: [...s.ids, id] }));
    const timer = setTimeout(() => {
      // A mutation resolves once the lists show it, so the row isn't shown again in between.
      deleteCollection({ collectionId: id })
        .catch((error) => {
          console.error("[Library] Failed to delete collection:", error);
          toast.error(t("deleteCollectionError"));
        })
        .finally(keep);
    }, UNDO_MS);
    toast(t("collectionDeleted"), {
      description: name,
      duration: UNDO_MS,
      action: {
        label: t("undoDelete"),
        onClick: () => {
          clearTimeout(timer);
          keep();
        },
      },
    });
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base">{t("manageCollectionsTitle")}</DialogTitle>
          <DialogDescription className="truncate text-xs">{workspace?.name}</DialogDescription>
        </div>
        <Button size="sm" onClick={startNew}>
          <Plus /> {ts("newCollection")}
        </Button>
        <IconButton label={tc("close")} icon={<X className="size-4" />} onClick={close} />
      </div>
      {total ? (
        <div className="px-4 pt-3">
          <label className="relative block">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchCollections")} aria-label={t("searchCollections")} className="h-9 rounded-lg pl-8 text-sm" />
          </label>
        </div>
      ) : null}
      <ScrollArea shades className="min-h-0 flex-1">
        <div className={cn("p-4", list.isLoading && "invisible")}>
          {shown.length || list.hasPages ? (
            <Paged pager={{ list, size: MANAGE_PAGE, total: search ? undefined : total }} rowHeight={MANAGE_ROW_PX} label={t("collectionsNoun")}>
              <ul className={LIST}>
                <AnimatePresence initial={false}>
                  {shown.map((c) => (
                    <motion.li key={c._id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: EASE }} className="flex items-center gap-3 p-2.5">
                      <Tile icon={Folder} tint={FOLDER_TINT} />
                      {editing === c._id ? (
                        <Input
                          // eslint-disable-next-line jsx-a11y/no-autofocus -- renaming starts in the field
                          autoFocus
                          onFocus={(e) => e.currentTarget.select()}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commit(c.name)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit(c.name);
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setEditing(null);
                            }
                          }}
                          aria-label={t("newName", { name: c.name })}
                          maxLength={120}
                          className="h-9 flex-1"
                        />
                      ) : (
                        <span className="min-w-0 flex-1" onDoubleClick={() => rename(c._id, c.name)}>
                          <TooltipHint label={c.name} onlyWhenClipped>
                            <span className="block truncate text-sm font-medium">{c.name}</span>
                          </TooltipHint>
                          <span className="block text-xs tabular-nums text-muted-foreground">{t("collectionItemCount", { count: c.itemCount })}</span>
                        </span>
                      )}
                      <IconButton small label={`${t("renameCollection")}: ${c.name}`} icon={<PenLine className="size-3.5" />} onClick={() => rename(c._id, c.name)} />
                      <IconButton small label={`${t("deleteCollection")}: ${c.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => remove(c._id, c.name)} />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </Paged>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
              <FolderTile />
              <div className="space-y-1">
                <p className="text-sm font-medium">{search ? t("noCollectionsMatchSearch") : t("emptyCollectionsTitle")}</p>
                {search ? null : <p className="mx-auto max-w-64 text-xs text-muted-foreground">{t("emptyCollectionsDescription")}</p>}
              </div>
              {search ? null : (
                <Button size="sm" onClick={startNew}>
                  <Plus /> {ts("newCollection")}
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </>
  );
}
