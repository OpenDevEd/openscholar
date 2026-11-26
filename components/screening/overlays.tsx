"use client";

// Everything that opens over one screening, from its own pages and from its row in the list: its
// activity, export, people and move, and the confirmations for finishing it, deleting it, adding a
// reviewer, taking one off and making one a viewer. Both places open these same ones, so they say
// and do the same.

import { useState } from "react";
import useSWR from "swr";
import { CircleCheck, CirclePause, Coins, Copy, Download, History, LogOut, Move, Play, RefreshCw, RotateCcw, Settings2, Trash2, UserPlus, Users } from "@/components/icons";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { NodeCard, type MapModel } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";
import { showStyledToast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { MoveDialog } from "@/components/workspaces/move-dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { collectionName, growing, modelsOf, num, peopleOf, plural, withoutReviewer, type Reviewer, type Screening, inQuotes } from "./data";
import { ActivitySheet, PeopleDialog, useSharing, type ExportTab } from "./dialogs";
import { ExportDialog } from "./export-dialog";
import { EffectList, NO_PREVIEW, effectLines } from "./effects";
import { newHref, settingsHref } from "./links";
import { Panel, ReviewerMark, OpenPapersChips } from "./pieces";
import { credits, readingOf, type Open, perPaper } from "./store";
import { ConfirmChange } from "./team";

export type Over = "activity" | "export" | "people" | "move" | "finish" | "delete" | "leave";

/**
 * The screening's menu: the same items under the same names wherever it opens, over the open screening and in its row
 * of the list. A member changes it from here. Someone it is shared with from outside can take a copy or leave it.
 */
export function ScreeningMenuItems({ open, show, bar = false }: { open: Open; show: (what: Over) => void; /** Over the open screening: what its bar shows as a button at a width is left out of the menu at that width, and its tabs hold the settings. */ bar?: boolean }) {
  const { screening } = open;
  const id = screening.id;
  const member = open.canChange;
  const live = !screening.finishedAt;
  return (
    <>
      {member && !bar ? <DropdownMenuItem asChild><NextLink href={settingsHref(id)}><Settings2 />Settings</NextLink></DropdownMenuItem> : null}
      <DropdownMenuItem className={bar ? "xl:hidden" : undefined} onSelect={() => show("activity")}><History />Activity</DropdownMenuItem>
      <DropdownMenuItem className={bar ? "xl:hidden" : undefined} onSelect={() => show("export")}><Download />Export</DropdownMenuItem>
      <DropdownMenuItem className={bar ? "sm:hidden" : undefined} onSelect={() => show("people")}><Users />People</DropdownMenuItem>
      <DropdownMenuSeparator className={bar ? "xl:hidden" : undefined} />
      {member ? (live ? <DropdownMenuItem onSelect={() => show("finish")}><CircleCheck />Mark as finished</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void open.reopen()}><RotateCcw />Reopen</DropdownMenuItem>) : null}
      {member && live && modelsOf(screening).length ? (screening.paused ? <DropdownMenuItem onSelect={() => void open.resume()}><Play />Resume models</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void open.pause()}><CirclePause />Pause models</DropdownMenuItem>) : null}
      {member && growing(screening).length ? <DropdownMenuItem disabled={Boolean(screening.checking)} onSelect={() => void open.check()}><RefreshCw />Check for new papers</DropdownMenuItem> : null}
      <DropdownMenuItem asChild><NextLink href={newHref(id)}><Copy />Duplicate as a new screening</NextLink></DropdownMenuItem>
      {member ? <DropdownMenuItem onSelect={() => show("move")}><Move />Move to another workspace</DropdownMenuItem> : null}
      {/* In the widest windows the bar over a screening has this as a button. */}
      {member && live && !open.isReviewer ? <DropdownMenuItem className={bar ? "2xl:hidden" : undefined} onSelect={() => void open.join()}><UserPlus />Join as a reviewer</DropdownMenuItem> : null}
      {member ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => show("delete")}><Trash2 />Delete</DropdownMenuItem>
        </>
      ) : open.guest ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => show("leave")}><LogOut />Leave this screening</DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

/**
 * The overlays of one screening and the ways to open them. `start` opens one at once, for a row's menu
 * in the list. `onClosed` runs when the last of them has closed, and `onDeleted` after a deletion.
 */
export function useScreeningOverlays(state: Open | null, { start = null, onClosed, onDeleted }: { start?: Over | null; onClosed?: () => void; onDeleted?: () => void } = {}) {
  const [over, setOver] = useState<Over | null>(start);
  const [exportTab, setExportTab] = useState<ExportTab>("papers");
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
  const collection = collectionName(screening);
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
                ...(modelsOf(screening).length ? [`Its ${modelsOf(screening).length === 1 ? "model is" : "models are"} paid from ${own ? "your own" : `${to.name}'s`} credits from now on`] : []),
                ...(peopleOf(screening).some((one) => one.id !== state.me) ? [own ? "Its other reviewers keep it, as its guests" : `Its other reviewers keep it, as its guests where they aren't in ${to.name}`] : []),
                ...(collection && screening.destination.kind !== "community" ? [`Papers it has saved stay where they are, and the ones it includes from now on are saved in ${own ? "your own" : `${to.name}'s`} library`] : []),
                ...(screening.living && from ? [`Its sources stay in ${from.kind === "personal" ? "your own workspace" : from.name}, and it goes on checking them there`] : []),
                ...(from?.kind === "organization" ? [`Members of ${from.name} who aren't its reviewers no longer see it`] : []),
              ]}
              none="Nothing else changes"
            />
          );
        }}
      />
      <ConfirmChange open={over === "finish"} title="Mark this screening as finished?" confirm="Mark as finished" onClose={close} onConfirm={() => void state.finish().catch(failed)}>
        <EffectList
          lines={[
            ...(unsettled ? [`${plural(unsettled, "paper is", "papers are")} not settled, and ${unsettled === 1 ? "stays" : "stay"} as ${unsettled === 1 ? "it is" : "they are"}`] : []),
            ...(state.reading.length ? ["The models stop reading"] : []),
            ...(screening.living ? ["It stops checking for new papers"] : []),
            "It moves to Finished in the list, and can be reopened or changed at any time",
          ]}
        />
        {/* The papers that would be left unsettled, one press away. */}
        {unsettled ? <OpenPapersChips id={id} conflict={state.counts.conflict} waiting={state.counts.waiting} onClick={close} /> : null}
      </ConfirmChange>
      <ConfirmChange open={over === "delete"} variant="destructive" title={`Delete ${inQuotes(screening.name)}?`} confirm="Delete" onClose={close} onConfirm={() => void state.remove().then(() => onDeleted?.(), failed)}>
        <EffectList lines={["Its votes and its settings go with it", ...(collection && state.counts.include ? [`The ${plural(state.counts.include, "paper", "papers")} saved to ${inQuotes(collection)} stay there`] : []), "This can't be undone"]} />
      </ConfirmChange>
      {/* A guest gives up their own place: what they voted stays, and what they hadn't goes to the others, as when a member takes them off. */}
      <ConfirmChange open={over === "leave"} title="Leave this screening?" confirm="Leave" onClose={close} onConfirm={() => void leave({ id }).then(() => onDeleted?.(), failed)}>
        <EffectList
          lines={[
            mine?.cast ? `Your ${plural(mine.cast, "vote keeps", "votes keep")} counting` : "You have cast no vote",
            ...(mine?.waiting ? [`The ${plural(mine.waiting, "paper", "papers")} you had not voted on ${mine.waiting === 1 ? "goes" : "go"} to the other reviewers`] : []),
            "It leaves your list, and you can open it again only once it is shared with you again",
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

const failed = (error: unknown) => showStyledToast("error", getErrorMessage(error, "That didn't work. Try again."));

/**
 * Asks before a reviewer is put on a screening, saying first what that does as the server counts it for that change:
 * the papers a person gets, and what a model reads and costs. Someone invited by email has no papers until they join.
 */
function AddReviewer({ open, reviewer, onConfirm, onClose }: { open: Open; reviewer: Reviewer | null; onConfirm: (reviewer: Reviewer) => Promise<unknown>; onClose: () => void }) {
  const { screening } = open;
  const id = screening.id as Id<"screeningJobs">;
  const previewChange = useWorkspaceAction(api.screening.effects.preview);
  const change = !reviewer || reviewer.email ? null : reviewer.model ? { addModels: [{ model: reviewer.model.id, ...(reviewer.model.effort ? { effort: reviewer.model.effort } : {}) }] } : { addPeople: [reviewer.id as Id<"users">] };
  const counted = useSWR(change ? ["screening-add", id, reviewer!.id] : null, () => previewChange({ jobId: id, change: change! }), { revalidateOnFocus: false });
  const preview = counted.data ?? NO_PREVIEW;
  const noCriteria = Boolean(reviewer?.model && !screening.criteria.length);
  const after: Screening | null = reviewer ? { ...screening, reviewers: [...screening.reviewers.filter((one) => one.id !== reviewer.id), reviewer] } : null;
  return (
    <ConfirmChange open={reviewer !== null} title={reviewer ? `Add ${reviewer.name} as a reviewer?` : ""} confirm="Add as reviewer" disabled={noCriteria || (change !== null && counted.isLoading)} onClose={onClose} onConfirm={() => void (reviewer && onConfirm(reviewer).catch(failed))}>
      {reviewer && after ? (
        <>
          {reviewer.model ? (
            <NodeCard model={reviewer.model} paidBy="credits" tabIndex={-1} note={<span className="tabular-nums">{perPaper(reviewer.model)}</span>} />
          ) : (
            <Panel className="flex items-center gap-3 p-3">
              <ReviewerMark reviewer={reviewer} className="size-9" />
              <p className="min-w-0 truncate text-sm font-medium">{reviewer.name}</p>
            </Panel>
          )}
          {noCriteria ? (
            <Panel tone="warning" className="space-y-3 rounded-xl p-3">
              <p className="text-sm ink-warning">A model votes by answering the criteria, and this screening has none yet. It would include every paper it reads.</p>
              <Button asChild variant="outline" size="sm"><NextLink href={settingsHref(id, "criteria")} onClick={onClose}>Add criteria</NextLink></Button>
            </Panel>
          ) : (
            <EffectList lines={effectLines(screening, after, preview, { me: open.me, wallet: open.wallet, waiting: Boolean(open.waitingFor) })} />
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
    <ConfirmChange open={reviewer !== null} title={!reviewer ? "" : viewer ? `Stop ${reviewer.name} voting?` : me ? "Leave this screening?" : `Take ${reviewer.name} off this screening?`} confirm={viewer ? "Make them a viewer" : me ? "Leave" : "Take off"} disabled={counted.isLoading} onClose={close} onConfirm={() => void (reviewer && onConfirm(reviewer, discard).catch(failed))}>
      {reviewer ? <EffectList lines={[...effectLines(screening, withoutReviewer(screening, reviewer, discard, now), preview, { me: open.me }), ...(viewer ? ["As a viewer they see every paper and every vote"] : [])]} moves={preview.moves} screening={screening.id} /> : null}
      {/* Their work stands unless whoever takes them off says otherwise: the votes stop counting only where that is asked for, and what it undoes shows above before it is done. */}
      {reviewer && votes && !viewer ? (
        <label className="flex items-start gap-3 rounded-xl border border-border-subtle p-2.5 text-sm">
          <span className="min-w-0 flex-1">
            <span className="font-medium">Stop counting {me ? "your" : "their"} {plural(votes, "vote", "votes")}</span>
            <span className="block text-xs text-muted-foreground">{discard ? `${me ? "Your" : "Their"} votes stay on record and stop counting.` : `${me ? "Your" : "Their"} votes keep counting.`}</span>
          </span>
          <Switch checked={discard} onCheckedChange={setDiscard} aria-label={`Stop counting ${me ? "your" : "their"} votes`} />
        </label>
      ) : null}
    </ConfirmChange>
  );
}

/** What the workspace has to pay a model with: where that runs out before the model has read every paper, how far it gets. */
function Credits({ cost, papers, wallet, onAddCredits }: { /** What reading those papers costs the model at most. */ cost: number; papers: number; wallet: number; onAddCredits: () => void }) {
  if (cost <= wallet) return <p className="text-xs tabular-nums text-muted-foreground">{credits(wallet)} credits in the workspace now</p>;
  const paid = Math.floor((papers * wallet) / cost);
  return (
    <Panel tone="warning" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl p-3">
      <Coins className="mt-0.5 size-4 shrink-0 self-start ink-warning" />
      <p className="min-w-0 flex-1 text-sm tabular-nums ink-warning">{credits(wallet)} credits pay for {paid ? `about ${num(paid)}` : "none"} of its {num(papers)} papers. It stops there until credits are added.</p>
      <Button asChild variant="outline" size="sm"><NextLink href="/settings/billing" onClick={onAddCredits}><Coins />Add credits</NextLink></Button>
    </Panel>
  );
}
