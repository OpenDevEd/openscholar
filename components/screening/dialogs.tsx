"use client";

// What opens over an open screening: its activity, and everyone who is on it or has it.
// Every row that names a paper, a check, a setting or a person opens it, and closes what it is in on the way.

import { useDeferredValue, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { IconButton } from "@/components/assistant/parts";
import { AiIcon, ArrowRight, ChevronRight, Clock, X } from "@/components/icons";
import { SharePanel, type ShareRole } from "@/components/shared/share-panel";
import { Segmented } from "@/components/settings/parts";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EmailAvatar, ROLE_ICONS } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { showStyledToast } from "@/components/ui/sonner";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { WorkspaceTile } from "@/components/workspaces/parts";
import { GuestMeter } from "@/components/workspaces/share-dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { inWorkspace, useWorkspace, useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { changeOpens, changeSays } from "./activity-words";
import { modelKey, inOrder, invitedReviewer, lookOf, modelReviewer, modelsOf, peopleOf, personReviewer, type Reviewer } from "./data";
import { gotThrough, theirsOf } from "@/lib/screening/rules";
import { papersHref } from "./links";
import { Help, ReviewerMark, ReviewerName, ShutNote } from "./pieces";
import { pdfsOf, perPaper, type Open } from "./store";
import { AddModel } from "./team";
import { useWords } from "./words";

/** What a screening exports, a tab each (./export-dialog.tsx). */
export type ExportTab = "papers" | "votes" | "flow" | "methods" | "record";

/** Changes the activity reads at a time. */
const CHANGES = 30;

/** What has happened in the screening, newest first: every change to it, who made it, and what it did. Each opens what it changed. */
export function ActivitySheet({ open, onClose, state }: { open: boolean; onClose: () => void; state: Open }) {
  const { screening } = state;
  const workspaceId = useWorkspace();
  const t = useTranslations("screening.frame");
  const words = useWords();
  const effects = useTranslations("screening.effects");
  // Read while the sheet is shut, so it opens with its rows in it.
  const changes = usePaginatedQuery(api.screening.view.activity, inWorkspace(workspaceId, { jobId: screening.id }), { initialNumItems: CHANGES });
  const mine = screening.reviewers.find((one) => one.id === state.me)?.tally?.cast ?? 0;
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className={`flex w-full flex-col gap-0 p-0 sm:max-w-md ${AVATARS_FADE_IN}`}>
        <SheetHeader className="border-b border-border-subtle p-5">
          <SheetTitle>{t("activity")}</SheetTitle>
          <SheetDescription className="sr-only">{t("activitySheet.says")}</SheetDescription>
        </SheetHeader>
        <ScrollArea shades className="min-h-0 flex-1">
          <ol className="divide-y divide-border-subtle">
            {changes.results.map((change) => {
              const scheduled = change.code === "scheduledCheck";
              const reviewer = screening.reviewers.find((one) => one.id === change.by.id);
              const href = changeOpens(screening.id, change);
              const { what, effect } = changeSays({ words, t: effects }, change);
              const body = (
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm">{what}</span>
                  {effect ? <span className="block text-xs text-muted-foreground">{effect}</span> : null}
                </span>
              );
              return (
                <li key={change.id} className="flex items-start gap-3 px-5 py-3.5">
                  {scheduled ? <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Clock className="size-3.5" /></span> : <IdentityAvatar name={change.by.name} imageUrl={change.by.imageUrl} className="size-7" />}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex min-h-7 items-center gap-3 text-sm font-medium">
                      {scheduled ? (
                        t("activitySheet.scheduled")
                      ) : reviewer ? (
                        <NextLink href={papersHref(screening.id, { reviewer: reviewer.id })} onClick={onClose} className="min-w-0 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                          <ReviewerName reviewer={reviewer} you={reviewer.id === state.me} />
                        </NextLink>
                      ) : (
                        <span className="truncate">{change.by.name}</span>
                      )}
                      <span className="ms-auto shrink-0 text-xs font-normal text-muted-foreground">{words.ago(change.at)}</span>
                    </p>
                    {href ? (
                      <NextLink href={href} onClick={onClose} className="-mx-2 flex items-start gap-2 rounded-lg px-2 py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50">
                        {body}
                        <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      </NextLink>
                    ) : (
                      <div className="flex py-1">{body}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {changes.status === "CanLoadMore" || changes.status === "LoadingMore" ? (
            <div className="p-3"><Button variant="ghost" size="sm" className="h-8 w-full" disabled={changes.status === "LoadingMore"} onClick={() => changes.loadMore(CHANGES)}>{t("activitySheet.earlier")}</Button></div>
          ) : null}
        </ScrollArea>
        {mine ? (
          <div className="border-t border-border-subtle p-4">
            <Button asChild variant="outline" className="w-full">
              <NextLink href={papersHref(screening.id, { reviewer: state.me })} onClick={onClose}>
                {t("activitySheet.yourVotes", { count: mine })}
                <ArrowRight />
              </NextLink>
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

type Role = "reviewer" | "viewer";
/** A guest's place as sharing keeps it, by what it is called on a screening. */
const GUEST_ROLE = { reviewer: "editor", viewer: "viewer" } as const;
/** People the panel reads at a time, and offers before anything is typed. */
const PAGE = 25;
const SUGGESTED = 8;

/**
 * Everyone on a screening, in one place: its workspace, whose members all see it and change it, the
 * people and the models that review it, and whoever it is shared with from outside. A member of its
 * workspace adds a reviewer or a model here, and shares it with someone outside to vote or to look.
 * Adding a reviewer, taking one off and making one a viewer each say first what they do
 * (`onAdd`, `onRemove`, `onDemote`).
 */
export function PeopleDialog({ open, onClose, state, onAdd, onRemove, onDemote }: { open: boolean; onClose: () => void; state: Open; onAdd: (reviewer: Reviewer) => void; onRemove: (reviewer: Reviewer) => void; onDemote: (reviewer: Reviewer) => void }) {
  const { screening } = state;
  const id = screening.id;
  const workspaceId = useWorkspace();
  const t = useTranslations("screening.frame");
  const words = useWords();
  const list = useTranslations("screening.list");
  const ROLES: Array<ShareRole<Role>> = [
    { id: "reviewer", kind: "edit", label: t("peopleDialog.reviewer"), can: t("peopleDialog.reviewerCan") },
    { id: "viewer", kind: "view", label: t("peopleDialog.viewer"), can: t("peopleDialog.viewerCan") },
  ];
  const [query, setQuery] = useState("");
  const text = useDeferredValue(query.trim());
  // What the people added from the field become. A finished screening takes no reviewer until it is reopened (convex/screening/reviewers.ts `add`): whoever is added then looks at it.
  const [asked, setAddAs] = useState<Role>("reviewer");
  const finished = Boolean(screening.finishedAt);
  const addAs: Role = finished ? "viewer" : asked;
  const may = state.canChange;
  const shared = inWorkspace(workspaceId, may ? { kind: "screening" as const, id: id as string } : "skip");
  // Read while the panel is shut, so it opens with everyone in it. Guests and invitations are the workspace's to read.
  const room = useProtectedQuery(api.sharing.guests.room, shared).data;
  const guests = usePaginatedQuery(api.sharing.guests.list, shared, { initialNumItems: PAGE });
  const invited = usePaginatedQuery(api.sharing.guests.invited, shared, { initialNumItems: PAGE });
  const members = useProtectedQuery(api.screening.reviewers.candidates, inWorkspace(workspaceId, may && open && addAs === "reviewer" ? { text, paginationOpts: { cursor: null, numItems: SUGGESTED } } : "skip")).data;
  const outside = usePaginatedQuery(api.sharing.guests.candidates, inWorkspace(workspaceId, may && open ? { kind: "screening" as const, id: id as string, ...(text ? { text } : {}) } : "skip"), { initialNumItems: SUGGESTED });
  const give = useWorkspaceMutation(api.sharing.guests.add);
  const invite = useWorkspaceAction(api.sharing.invitations.invite);
  const setRole = useWorkspaceMutation(api.sharing.guests.setRole);
  const unshare = useWorkspaceMutation(api.sharing.guests.remove);
  const failed = (error: unknown) => showStyledToast("error", getErrorMessage(error, t("failed")));

  const workspace = screening.workspace;
  const people = inOrder(peopleOf(screening), state.me);
  const models = modelsOf(screening);
  const on = new Set(people.map((one) => one.id));
  // Whoever it is shared with to look: its guests who don't vote.
  const viewers = guests.results.filter((guest) => !on.has(guest.userId));
  const detail = (one: Reviewer) => (one.id === screening.createdBy ? t("peopleDialog.startedIt") : words.standsTo(one));
  // Someone in the workspace is put on it as a reviewer. Someone outside it is given it, to vote or to look.
  const candidates = [
    ...(addAs === "reviewer" ? (members?.page ?? []).filter((person) => !on.has(person.id)).map((person) => ({ key: person.id as string, avatar: <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-9" />, name: person.name, detail: words.t("person.member"), pick: () => onAdd(personReviewer({ id: person.id, name: person.name, ...(person.imageUrl ? { imageUrl: person.imageUrl } : {}) }, Date.now())) })) : []),
    ...[...new Map(outside.results.map((person) => [person.userId, person])).values()].map((person) => ({
      key: person.userId as string,
      avatar: <IdentityAvatar name={person.name || person.email} imageUrl={person.imageUrl} className="size-9" />,
      name: person.name || person.email,
      detail: words.t("person.guest"),
      pick: () => (addAs === "reviewer" ? onAdd(personReviewer({ id: person.userId, name: person.name || person.email, ...(person.imageUrl ? { imageUrl: person.imageUrl } : {}), guest: true }, Date.now())) : void give({ kind: "screening", id, personId: person.userId, role: "viewer" }).catch(failed)),
    })),
  ];
  const loading = (addAs === "reviewer" && members === undefined) || outside.status === "LoadingFirstPage";
  const more = [guests, invited].find((list) => list.status === "CanLoadMore");
  const limit = room?.limit ?? null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className={`top-[max(1rem,12dvh)] flex max-h-[min(42rem,calc(88dvh-1rem))] max-w-lg translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 ${AVATARS_FADE_IN}`}>
        <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex items-center gap-1 text-base">
              {t("people")}
              <Help title={t("peopleDialog.helpTitle")}>
                {workspace.kind === "personal" ? (
                  <>
                    <p>{t("peopleDialog.personalIn", { you: String(state.canChange), workspace: workspace.name })}</p>
                    <p>{t("peopleDialog.personalElse")}</p>
                  </>
                ) : (
                  <>
                    <p>{t("peopleDialog.membersSee", { workspace: workspace.name })}</p>
                    <p>{t("peopleDialog.outsideHas", { workspace: workspace.name })}</p>
                  </>
                )}
                {models.length ? <p>{t("peopleDialog.modelToo", { you: String(workspace.kind === "personal" && state.canChange), workspace: workspace.name })}</p> : null}
                {screening.rule.blind === "after" ? <p>{words.t("votesHiddenSays")}</p> : null}
              </Help>
            </DialogTitle>
            <DialogDescription className="truncate text-xs">{screening.name}</DialogDescription>
          </div>
          <IconButton label={t("peopleDialog.close")} icon={<X className="size-4" />} onClick={onClose} />
        </div>
        {may ? (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            {finished ? <div className="min-w-0 flex-1"><ShutNote by="member">{t("peopleDialog.finishedAdds")}</ShutNote></div> : (
              <>
                <span className="text-xs font-medium text-muted-foreground">{t("peopleDialog.addAs")}</span>
                <Segmented label={t("peopleDialog.addAs")} value={addAs} onChange={setAddAs} options={ROLES.map((role) => ({ id: role.id, label: role.label, icon: ROLE_ICONS[role.kind] }))} />
              </>
            )}
            {finished ? null : (
              <AddModel taken={models.map((model) => modelKey(model.model!))} pdfs={pdfsOf(screening.sources)} onPick={(model) => onAdd(modelReviewer(model, Date.now()))}>
                <Button variant="outline" size="sm" className="ms-auto h-8"><AiIcon />{t("peopleDialog.addModel")}</Button>
              </AddModel>
            )}
          </div>
        ) : (
          // Someone it is shared with from outside sees who is on it. Adding people is said to be the members' to do, where the field would be.
          <div className="px-4 pt-3"><ShutNote by="member">{t("peopleDialog.membersAdd", { workspace: workspace.name })}</ShutNote></div>
        )}
        <SharePanel<Role>
          roles={ROLES}
          adding={
            may
              ? {
                  query,
                  onQuery: setQuery,
                  candidates: loading && !candidates.length ? undefined : candidates,
                  more: outside.status === "CanLoadMore" || outside.status === "LoadingMore" ? { loading: outside.status === "LoadingMore", load: () => outside.loadMore(SUGGESTED) } : undefined,
                  // Someone invited to vote goes through the same question as anyone added as a reviewer.
                  invite: (email) => (addAs === "reviewer" ? onAdd(invitedReviewer(email, Date.now())) : void invite({ kind: "screening", id, email, role: "viewer" }).catch(failed)),
                  has: (email) => invited.results.some((invitation) => invitation.email === email) || guests.results.some((guest) => guest.email.toLowerCase() === email),
                  full: limit !== null && (room?.used ?? 0) >= limit ? t("peopleDialog.full", { workspace: workspace.name, count: limit }) : undefined,
                }
              : undefined
          }
          entries={[
            // An organization's members all have it. A person's own workspace has one member, who is listed below where they review it: a row for the workspace would name them twice.
            ...(workspace.kind === "personal" && people.some((one) => one.id === screening.createdBy) ? [] : [{ key: "workspace", avatar: <WorkspaceTile workspace={lookOf(workspace)} size="row" />, name: workspace.name, detail: workspace.kind === "personal" ? t("peopleDialog.ownWorkspace") : t("peopleDialog.everyMember"), role: { kind: "member" as const, label: t("peopleDialog.canChange") } }]),
            ...people.map((one) => ({
              key: one.id,
              avatar: <ReviewerMark reviewer={one} className="size-9" />,
              name: one.name,
              you: one.id === state.me,
              detail: one.tally ? t("peopleDialog.votedOn", { detail: detail(one), done: gotThrough(one.tally), of: theirsOf(one.tally) }) : detail(one),
              // A guest who votes can be made a viewer by whoever may change the screening. A member is a reviewer or isn't: taking them off leaves them a member, who still sees it. Whoever only looks at the list reads one word for every reviewer, guest or member.
              ...(one.guest && may ? { role: "reviewer" as const, onRole: (role: Role) => { if (role === "viewer") onDemote(one); } } : { role: { kind: "edit" as const, label: t("peopleDialog.reviewer") } }),
              ...(may ? { onRemove: () => onRemove(one) } : {}),
            })),
            ...models.map((one) => ({
              key: one.id,
              avatar: <ReviewerMark reviewer={one} className="size-9" />,
              name: one.name,
              detail: t("peopleDialog.modelRead", { failed: String(Boolean(one.tally?.failed)), price: perPaper({ words, t: list }, one.model!), done: gotThrough(one.tally), of: theirsOf(one.tally) }),
              role: { kind: "edit" as const, label: t("peopleDialog.model") },
              ...(may ? { onRemove: () => onRemove(one) } : {}),
            })),
            ...viewers.map((guest) => ({
              key: guest.userId as string,
              avatar: <IdentityAvatar name={guest.name || guest.email} imageUrl={guest.imageUrl} className="size-9" />,
              name: guest.name || guest.email,
              detail: words.t("person.guest"),
              // Made a reviewer from here, while the screening is open.
              ...(finished ? { role: { kind: "view" as const, label: t("peopleDialog.viewer") } } : { role: "viewer" as const, onRole: (role: Role) => { if (role === "reviewer") onAdd(personReviewer({ id: guest.userId, name: guest.name || guest.email, ...(guest.imageUrl ? { imageUrl: guest.imageUrl } : {}), guest: true }, Date.now())); } }),
              onRemove: () => void unshare({ kind: "screening", id, guest: { userId: guest.userId } }).catch(failed),
            })),
            ...invited.results.map((invitation) => ({
              key: invitation.email,
              avatar: <EmailAvatar />,
              name: invitation.email,
              detail: invitation.delivery === "failed" ? t("peopleDialog.notSent") : invitation.role === "editor" ? words.t(finished ? "person.invitedFinished" : "person.invited") : words.t("person.invitedToLook"),
              role: (invitation.role === "editor" ? "reviewer" : "viewer") as Role,
              onRole: (role: Role) => void setRole({ kind: "screening", id, guest: { email: invitation.email }, role: GUEST_ROLE[role] }).catch(failed),
              onRemove: () => void unshare({ kind: "screening", id, guest: { email: invitation.email } }).catch(failed),
            })),
          ]}
          foot={
            may ? (
              <>
                {more ? <Button variant="ghost" size="sm" className="h-8 w-full" onClick={() => more.loadMore(PAGE)}>{t("peopleDialog.showMore")}</Button> : null}
                <GuestMeter room={room} />
              </>
            ) : undefined
          }
          // The screening's own address, without its workspace: a guest opens it in theirs, and a member is taken to the workspace it is in.
          onCopy={() => navigator.clipboard.writeText(`${window.location.origin}/screening/${id}`)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** What it takes to share a screening with someone outside its workspace, for whoever confirms adding them (./overlays.tsx). */
export function useSharing(jobId: Id<"screeningJobs">) {
  const give = useWorkspaceMutation(api.sharing.guests.add);
  const invite = useWorkspaceAction(api.sharing.invitations.invite);
  const setRole = useWorkspaceMutation(api.sharing.guests.setRole);
  return {
    /** Gives it to someone the person can pick by name, to vote. */
    give: (personId: Id<"users">) => give({ kind: "screening", id: jobId, personId, role: "editor" }),
    /** Invites an address to vote. */
    invite: (email: string) => invite({ kind: "screening", id: jobId, email, role: "editor" }),
    /** Makes a guest who votes one who looks. */
    demote: (userId: Id<"users">) => setRole({ kind: "screening", id: jobId, guest: { userId }, role: "viewer" }),
  };
}
