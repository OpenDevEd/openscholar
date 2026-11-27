"use client";

// Everything that opens over one screening, from its own pages and from its row in the list: its
// activity, export, people and move, and the confirmations for finishing it, deleting it, adding a
// reviewer, taking one off and making one a viewer. Both places open these same ones, so they say
// and do the same.

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useOpenInAddress } from "./address";
import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { BellOff, CircleCheck, CirclePause, Coins, Copy, Download, History, LogOut, Mail, Move, Play, RefreshCw, RotateCcw, Settings2, Trash2, UserPlus, Users } from "@/components/icons";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { NodeCard, type MapModel } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { showStyledToast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { MoveDialog } from "@/components/workspaces/move-dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { growing, modelsOf, peopleOf, withTwins, withoutReviewer, type Reviewer, type Screening } from "./data";
import { ActivitySheet, PeopleDialog, useSharing, type ExportTab } from "./dialogs";
import { ExportDialog } from "./export-dialog";
import { EffectList, NO_PREVIEW, effectLines } from "./effects";
import { newHref, settingsHref } from "./links";
import { Panel, ReviewerMark, OpenPapersChips } from "./pieces";
import { useCurrentWorkspace } from "@/components/workspaces/parts";
import { readingOf, type Open, perPaper } from "./store";
import { ConfirmChange } from "./team";
import { useWords } from "./words";

/** This part's messages, for a function that is handed them. */
type T = ReturnType<typeof useTranslations<"screening.frame">>;

export const OVERS = ["activity", "export", "people", "move", "finish", "delete", "leave", "stopEmails"] as const;
export type Over = (typeof OVERS)[number];
const EXPORT_TABS = ["papers", "votes", "flow", "methods", "record"] as const;

/**
 * The screening's menu: the same items under the same names wherever it opens, over the open screening and in its row
 * of the list. A member changes it from here. Someone it is shared with from outside can take a copy or leave it.
 */
export function ScreeningMenuItems({ open, show, bar = false }: { open: Open; show: (what: Over) => void; /** Over the open screening: what its bar shows as a button at a width is left out of the menu at that width, and its tabs hold the settings. */ bar?: boolean }) {
  const { screening } = open;
  const id = screening.id;
  const member = open.canChange;
  const live = !screening.finishedAt;
  const t = useTranslations("screening.frame");
  // Only whoever started it, or an admin of its workspace, deletes it: the others aren't offered what they can't do.
  const mayDelete = useCurrentWorkspace()?.role === "admin" || screening.createdBy === open.me;
  return (
    <>
      {member && !bar ? <DropdownMenuItem asChild><NextLink href={settingsHref(id)}><Settings2 />{t("settings")}</NextLink></DropdownMenuItem> : null}
      <DropdownMenuItem className={bar ? "xl:hidden" : undefined} onSelect={() => show("activity")}><History />{t("activity")}</DropdownMenuItem>
      <DropdownMenuItem className={bar ? "xl:hidden" : undefined} onSelect={() => show("export")}><Download />{t("export")}</DropdownMenuItem>
      <DropdownMenuItem className={bar ? "sm:hidden" : undefined} onSelect={() => show("people")}><Users />{t("people")}</DropdownMenuItem>
      {/* Its emails go to its reviewers and to whoever settles its conflicts: each of them turns their own off here, and on again. */}
      {live && (open.isReviewer || open.canResolve) ? (
        <DropdownMenuItem onSelect={() => (open.emails ? show("stopEmails") : void open.setEmails(true).then(() => toast(t("menu.emailsOn"))).catch(failed(t)))}>
          {open.emails ? <><BellOff />{t("menu.stopEmails")}</> : <><Mail />{t("menu.emailAgain")}</>}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator className={bar ? "xl:hidden" : undefined} />
      {member ? (live ? <DropdownMenuItem onSelect={() => show("finish")}><CircleCheck />{t("markFinished")}</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void open.reopen()}><RotateCcw />{t("reopen")}</DropdownMenuItem>) : null}
      {member && live && modelsOf(screening).length ? (screening.paused ? <DropdownMenuItem onSelect={() => void open.resume()}><Play />{t("resumeModels")}</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void open.pause()}><CirclePause />{t("menu.pauseModels")}</DropdownMenuItem>) : null}
      {member && growing(screening).length ? <DropdownMenuItem disabled={Boolean(screening.checking)} onSelect={() => void open.check()}><RefreshCw />{t("checkNew")}</DropdownMenuItem> : null}
      <DropdownMenuItem asChild><NextLink href={newHref({ from: id })}><Copy />{t("menu.duplicate")}</NextLink></DropdownMenuItem>
      {member ? <DropdownMenuItem onSelect={() => show("move")}><Move />{t("menu.move")}</DropdownMenuItem> : null}
      {/* In the widest windows the bar over a screening has this as a button. */}
      {member && live && !open.isReviewer ? <DropdownMenuItem className={bar ? "2xl:hidden" : undefined} onSelect={() => void open.join()}><UserPlus />{t("join")}</DropdownMenuItem> : null}
      {member && mayDelete ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => show("delete")}><Trash2 />{t("menu.delete")}</DropdownMenuItem>
        </>
      ) : !member && open.guest ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => show("leave")}><LogOut />{t("leaveScreening")}</DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

/**
 * The overlays of one screening and the ways to open them. `start` opens one at once, for a row's menu
 * in the list. `onClosed` runs when the last of them has closed, and `onDeleted` after a deletion.
 */
export function useScreeningOverlays(state: Open | null, { start = null, address = false, onClosed, onDeleted }: { start?: Over | null; /** Over an open screening, what is open is kept in the address: Back closes it (./address.ts). A list's row menu keeps it to itself. */ address?: boolean; onClosed?: () => void; onDeleted?: () => void } = {}) {
  const t = useTranslations("screening.frame");
  const words = useWords();
  const [kept, setKept] = useState<Over | null>(start);
  const [addressed, setAddressed] = useOpenInAddress("over", OVERS);
  const over = address ? addressed : kept;
  const setOver = (next: Over | null) => (address ? setAddressed(next) : setKept(next));
  // An email's "Turn off emails" link opens the screening with ?emails=off: it asks before it turns them off.
  const [emailsLink, setEmailsLink] = useQueryState("emails");
  // The Export dialog's tab, in the address with it, so a reload or Back keeps it.
  const [keptTab, setKeptTab] = useState<ExportTab>("papers");
  const [tabInAddress, setTabInAddress] = useQueryState("tab", parseAsStringLiteral(EXPORT_TABS).withOptions({ history: "replace", scroll: false }));
  const exportTab = address ? (tabInAddress ?? "papers") : keptTab;
  const setExportTab = (tab: ExportTab) => (address ? void setTabInAddress(tab === "papers" ? null : tab) : setKeptTab(tab));
  // A reviewer about to be added, one about to be taken off and one about to be made a viewer: each says what it does before it happens.
  const [adding, setAdding] = useState<Reviewer | null>(null);
  const [leaving, setLeaving] = useState<Reviewer | null>(null);
  const [demoting, setDemoting] = useState<Reviewer | null>(null);
  const leave = useWorkspaceMutation(api.sharing.guests.leave);
  const add = useWorkspaceMutation(api.screening.reviewers.add);
  const remove = useWorkspaceMutation(api.screening.reviewers.remove);
  const sharing = useSharing((state?.screening.id ?? "") as Id<"screeningJobs">);
  const controls = {
    show: (next: Over) => setOver(next),
    exportTo: (tab: ExportTab) => { setExportTab(tab); setOver("export"); },
    add: (reviewer: Reviewer) => setAdding(reviewer),
    takeOff: (reviewer: Reviewer) => setLeaving(reviewer),
  };
  if (!state) return { ...controls, overlays: null };

  const { screening } = state;
  const { id } = screening;
  const close = () => { setOver(null); setAdding(null); setLeaving(null); setDemoting(null); onClosed?.(); };
  const unsettled = state.counts.conflict + state.counts.waiting;
  const mine = screening.reviewers.find((one) => one.id === state.me && !one.left)?.tally;
  const collection = words.collectionName(screening);
  const confirmAdd = (reviewer: Reviewer) =>
    reviewer.model ? add({ jobId: id, model: { model: reviewer.model.id, ...(reviewer.model.effort ? { effort: reviewer.model.effort } : {}) } }) : reviewer.email ? sharing.invite(reviewer.email) : reviewer.guest ? sharing.give(reviewer.id as Id<"users">) : add({ jobId: id, personId: reviewer.id as Id<"users"> });

  const overlays = (
    <>
      <ActivitySheet open={over === "activity"} onClose={close} state={state} />
      {/* Its files are read only once it is opened. */}
      {over === "export" ? <ExportDialog open onClose={close} state={state} tab={exportTab} onTab={setExportTab} /> : null}
      <PeopleDialog open={over === "people"} onClose={close} state={state} onAdd={(reviewer) => { setOver(null); setAdding(reviewer); }} onRemove={(reviewer) => { setOver(null); setLeaving(reviewer); }} onDemote={(reviewer) => { setOver(null); setDemoting(reviewer); }} />
      <MoveDialog
        open={over === "move"}
        onOpenChange={(next) => !next && close()}
        kind="screening"
        id={id}
        name={screening.name}
        effects={(to, from) => {
          // Someone's own workspace is called by their name, which reads as a person here: it is said as theirs.
          const own = to.kind === "personal";
          return (
            <EffectList
              lines={[
                ...(modelsOf(screening).length ? [t("move.modelsPaid", { own: String(own), count: modelsOf(screening).length, to: to.name })] : []),
                ...(peopleOf(screening).some((one) => one.id !== state.me) ? [t("move.reviewersStay", { own: String(own), to: to.name })] : []),
                ...(collection && screening.destination.kind !== "community" ? [t("move.papersStay", { own: String(own), to: to.name })] : []),
                ...(screening.living && from ? [t("move.sourcesStay", { own: String(from.kind === "personal"), from: from.name })] : []),
                ...(from?.kind === "organization" ? [t("move.membersLose", { from: from.name })] : []),
              ]}
              none={t("move.nothingElse")}
            />
          );
        }}
      />
      <ConfirmChange
        open={over === "stopEmails" || (emailsLink === "off" && state.emails && (state.isReviewer || state.canResolve))}
        title={t("stopEmails.title")}
        confirm={t("stopEmails.confirm")}
        cancel={t("stopEmails.cancel")}
        onClose={() => { close(); void setEmailsLink(null); }}
        onConfirm={() => void state.setEmails(false).then(() => { close(); void setEmailsLink(null); toast(t("menu.emailsOff")); }).catch(failed(t))}
      >
        <p className="text-sm text-muted-foreground">{t("stopEmails.says")}</p>
      </ConfirmChange>
      <ConfirmChange open={over === "finish"} title={t("finish.title")} confirm={t("markFinished")} onClose={close} onConfirm={() => void state.finish().catch(failed(t))}>
        <EffectList
          lines={[
            ...(unsettled ? [t("finish.unsettled", { count: unsettled })] : []),
            t("finish.votingStops"),
            ...(screening.rule.blind === "after" ? [t("finish.votesShow")] : []),
            ...(state.reading.length ? [t("finish.modelsStop")] : []),
            ...(screening.living ? [t("finish.checksStop")] : []),
            t("finish.movesToFinished"),
          ]}
        />
        {/* The papers that would be left unsettled, one press away. */}
        {unsettled ? <OpenPapersChips id={id} conflict={state.counts.conflict} waiting={state.counts.waiting} onClick={close} /> : null}
      </ConfirmChange>
      {/* Whoever made it deletes it, or an admin of its workspace (convex/workspaces/actor.ts `requireMakerOrAdmin`): the menu offers it to nobody else. */}
      <ConfirmChange open={over === "delete"} variant="destructive" title={t("delete.title", { name: words.quoted(screening.name) })} confirm={t("menu.delete")} onClose={close} onConfirm={() => void state.remove().then(() => onDeleted?.(), failed(t))}>
        <EffectList lines={[t("delete.goes"), ...(collection && state.counts.include ? [t("delete.saved", { count: state.counts.include, collection: words.quoted(collection) })] : []), t("delete.final")]} />
      </ConfirmChange>
      {/* A guest gives up their own place: what they voted stays, and what they hadn't goes to the others, as when a member takes them off. */}
      <ConfirmChange open={over === "leave"} title={t("leave.title")} confirm={t("leave.confirm")} onClose={close} onConfirm={() => void leave({ id }).then(() => onDeleted?.(), failed(t))}>
        <EffectList
          lines={[
            mine?.cast ? t("leave.votesCount", { count: mine.cast }) : t("leave.noVotes"),
            ...(mine?.waiting ? [t("leave.papersGo", { count: mine.waiting })] : []),
            t("leave.fromList"),
          ]}
        />
      </ConfirmChange>
      <AddReviewer open={state} reviewer={adding} onConfirm={confirmAdd} onClose={close} />
      <TakeOff open={state} reviewer={leaving} onConfirm={(reviewer, discard) => (reviewer.row ? remove({ jobId: id, reviewerId: reviewer.row, discard }) : Promise.resolve(null))} onClose={close} />
      <TakeOff open={state} reviewer={demoting} viewer onConfirm={(reviewer) => sharing.demote(reviewer.id as Id<"users">)} onClose={close} />
    </>
  );
  return { ...controls, overlays };
}

const failed = (t: T) => (error: unknown) => showStyledToast("error", getErrorMessage(error, t("failed")));

/**
 * Asks before a reviewer is put on a screening, saying first what that does as the server counts it for that change:
 * the papers a person gets, and what a model reads and costs. Someone invited by email has no papers until they join.
 */
function AddReviewer({ open, reviewer, onConfirm, onClose }: { open: Open; reviewer: Reviewer | null; onConfirm: (reviewer: Reviewer) => Promise<unknown>; onClose: () => void }) {
  const { screening } = open;
  const id = screening.id as Id<"screeningJobs">;
  const t = useTranslations("screening.frame");
  const words = useWords();
  const say = { words, t: useTranslations("screening.effects") };
  const list = useTranslations("screening.list");
  const previewChange = useWorkspaceAction(api.screening.effects.preview);
  const change = !reviewer || reviewer.email ? null : reviewer.model ? { addModels: [{ model: reviewer.model.id, ...(reviewer.model.effort ? { effort: reviewer.model.effort } : {}) }] } : { addPeople: [reviewer.id as Id<"users">] };
  const counted = useSWR(change ? ["screening-add", id, reviewer!.id] : null, () => previewChange({ jobId: id, change: change! }), { revalidateOnFocus: false });
  const preview = counted.data ?? NO_PREVIEW;
  // A model excludes only for a must-have it fails: without one it would include every paper it reads, and the server refuses it (convex/screening/reviewers.ts).
  const noCriteria = Boolean(reviewer?.model && !screening.criteria.some((criterion) => criterion.must));
  const after: Screening | null = reviewer ? withTwins({ ...screening, reviewers: [...screening.reviewers.filter((one) => one.id !== reviewer.id), reviewer] }, words.modelAtEffort) : null;
  return (
    <ConfirmChange open={reviewer !== null} title={reviewer ? t("add.title", { name: reviewer.name }) : ""} confirm={t("add.confirm")} disabled={noCriteria || (change !== null && (counted.isLoading || Boolean(counted.error)))} onClose={onClose} onConfirm={() => void (reviewer && onConfirm(reviewer).catch(failed(t)))}>
      {reviewer && after ? (
        <>
          {reviewer.model ? (
            <NodeCard model={reviewer.model} paidBy="credits" tabIndex={-1} note={<span className="tabular-nums">{perPaper({ words, t: list }, reviewer.model)}</span>} />
          ) : (
            <Panel className="flex items-center gap-3 p-3">
              <ReviewerMark reviewer={reviewer} className="size-9" />
              <p className="min-w-0 truncate text-sm font-medium">{reviewer.name}</p>
            </Panel>
          )}
          {noCriteria ? (
            <Panel tone="warning" className="space-y-3 rounded-xl p-3">
              <p className="text-sm ink-warning">{screening.criteria.length ? t("add.noMustHave") : t("add.noCriteria")}</p>
              <Button asChild variant="outline" size="sm"><NextLink href={settingsHref(id, "criteria")} onClick={onClose}>{screening.criteria.length ? t("add.markMustHave") : t("add.addCriteria")}</NextLink></Button>
            </Panel>
          ) : (
            <EffectList lines={effectLines(say, screening, after, preview, { me: open.me, wallet: open.wallet, waiting: Boolean(open.waitingFor), openNow: open.counts.waiting + open.counts.conflict })} />
          )}
          {/* A model reads the papers still open: the ones already settled are not read again, and are not paid for. */}
          {reviewer.model && open.wallet !== undefined ? <Credits cost={readingOf(after, reviewer.model, preview.joining[reviewer.id]?.reads ?? 0)} papers={preview.joining[reviewer.id]?.reads ?? 0} wallet={open.wallet} onAddCredits={onClose} /> : null}
        </>
      ) : null}
    </ConfirmChange>
  );
}

/**
 * Asks before a reviewer is taken off a screening, leaves it, or is made a viewer, saying first what that does as the
 * server counts it for that change. One confirmation, wherever a reviewer is taken off.
 */
export function TakeOff({ open, reviewer, viewer = false, onConfirm, onClose }: { open: Open; reviewer: Reviewer | null; /** They keep the screening, to look at. */ viewer?: boolean; onConfirm: (reviewer: Reviewer, discard: boolean) => Promise<unknown>; onClose: () => void }) {
  const { screening } = open;
  const t = useTranslations("screening.frame");
  const say = { words: useWords(), t: useTranslations("screening.effects") };
  const [discard, setDiscard] = useState(false);
  const [now] = useState(() => Date.now());
  const previewChange = useWorkspaceAction(api.screening.effects.preview);
  const row = reviewer?.row;
  const counted = useSWR(row ? ["screening-leave", screening.id, row, discard] : null, () => previewChange({ jobId: screening.id as Id<"screeningJobs">, change: { remove: [{ reviewerId: row!, ...(discard ? { discard: true } : {}) }] } }), { revalidateOnFocus: false, keepPreviousData: true });
  const preview = counted.data ?? NO_PREVIEW;
  const me = reviewer?.id === open.me;
  const votes = reviewer?.tally?.cast ?? 0;
  const close = () => { setDiscard(false); onClose(); };
  return (
    <ConfirmChange open={reviewer !== null} title={!reviewer ? "" : viewer ? t("takeOff.viewerTitle", { name: reviewer.name }) : me ? t("leave.title") : t("takeOff.title", { name: reviewer.name })} confirm={viewer ? t("takeOff.makeViewer") : me ? t("leave.confirm") : t("takeOff.confirm")} disabled={counted.isLoading} onClose={close} onConfirm={() => void (reviewer && onConfirm(reviewer, discard).catch(failed(t)))}>
      {reviewer ? <EffectList lines={[...effectLines(say, screening, withoutReviewer(screening, reviewer, discard, now), preview, { me: open.me }), ...(viewer ? [t("takeOff.asViewer")] : [])]} moves={preview.moves} screening={screening.id} /> : null}
      {/* Their work stands unless whoever takes them off says otherwise: the votes stop counting only where that is asked for, and what it undoes shows above before it is done. */}
      {reviewer && votes && !viewer ? (
        <label className="flex items-start gap-3 rounded-xl border border-border-subtle p-2.5 text-sm">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{t("takeOff.stopCounting", { me: String(me), count: votes })}</span>
            <span className="block text-xs text-muted-foreground">{discard ? t("takeOff.discarded", { me: String(me) }) : t("takeOff.kept", { me: String(me) })}</span>
          </span>
          <Switch checked={discard} onCheckedChange={setDiscard} aria-label={t("takeOff.stopCountingLabel", { me: String(me) })} />
        </label>
      ) : null}
    </ConfirmChange>
  );
}

/** What the workspace has to pay a model with: where that runs out before the model has read every paper, how far it gets. */
function Credits({ cost, papers, wallet, onAddCredits }: { /** What reading those papers costs the model at most. */ cost: number; papers: number; wallet: number; onAddCredits: () => void }) {
  const t = useTranslations("screening.frame");
  const words = useWords();
  if (cost <= wallet) return <p className="text-xs tabular-nums text-muted-foreground">{t("credits.inWorkspace", { credits: words.creditsOf(wallet) })}</p>;
  const paid = Math.floor((papers * wallet) / cost);
  return (
    <Panel tone="warning" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl p-3">
      <Coins className="mt-0.5 size-4 shrink-0 self-start ink-warning" />
      <p className="min-w-0 flex-1 text-sm tabular-nums ink-warning">{t("credits.payFor", { some: String(paid > 0), credits: words.creditsOf(wallet), paid, papers })}</p>
      <Button asChild variant="outline" size="sm"><NextLink href="/settings/billing" onClick={onAddCredits}><Coins />{t("addCredits")}</NextLink></Button>
    </Panel>
  );
}
