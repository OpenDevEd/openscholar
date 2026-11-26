"use client";

// Everything that opens over one screening, from its own pages and from its row in the list: its
// activity, export, people and move, and the confirmations for finishing it, deleting it, adding a
// reviewer, taking one off and making one a viewer. Both places open these same ones, so they say
// and do the same.

import { useState } from "react";
import { Coins } from "@/components/icons";
import { NodeCard, type MapModel } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";
import { showStyledToast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { MoveDialog } from "@/components/workspaces/move-dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { useWorkspaceMutation } from "@/lib/workspaces/url";
import { collectionName, num, plural, readersOf, type Reviewer, inQuotes } from "./data";
import { ActivitySheet, PeopleDialog, useSharing, type ExportTab } from "./dialogs";
import { ExportDialog } from "./export-dialog";
import { EffectList, type EffectLine } from "./effects";
import { settingsHref } from "./links";
import { Panel, ReviewerMark, OpenPapersChips } from "./parts";
import { credits, paperCredits, type Open, perPaper } from "./store";
import { ConfirmChange } from "./team";

export type Over = "activity" | "export" | "people" | "move" | "finish" | "delete";

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
  const [discard, setDiscard] = useState(false);
  const [demoting, setDemoting] = useState<Reviewer | null>(null);
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
  const close = () => { setOver(null); setAdding(null); setLeaving(null); setDiscard(false); setDemoting(null); onClosed?.(); };
  const failed = (error: unknown) => showStyledToast("error", getErrorMessage(error, "That didn't work. Try again."));
  const unsettled = state.counts.conflict + state.counts.waiting;
  const collection = collectionName(screening);
  const open = state.counts.conflict + state.counts.waiting;
  // What a model put on the screening still has to read: the papers still open, fewer when it comes back with votes it had cast.
  const toRead = (model: Reviewer) => { const back = screening.reviewers.find((one) => one.id === model.id || (one.model && model.model && one.model.id === model.model.id && one.model.effort === model.model.effort)); return back && !back.discarded ? Math.max(0, open - (back.tally?.cast ?? 0)) : open; };
  const { people, each } = readersOf(screening);
  const leavingMe = leaving?.id === state.me;
  const leavingVotes = leaving?.tally?.cast ?? 0;

  // What each of these does, in the lines every confirmation shows. The counts are the screening's own, as it stands.
  const addingLines = (reviewer: Reviewer): EffectLine[] => {
    const held = screening.gathered !== undefined ? "once all its papers arrive" : screening.finishedAt ? "once the screening is reopened" : screening.paused ? "once the models resume" : state.outOfCredits ? "once the workspace has enough credits for its next paper" : "as soon as it is added";
    if (reviewer.model) {
      const reads = toRead(reviewer);
      return [
        reads ? { text: `${reviewer.name} reads ${reads === state.total ? `all ${plural(reads, "paper", "papers")}` : `the ${plural(reads, "paper", "papers")} not settled yet`}`, when: held, kind: "cost", credits: reads * paperCredits(reviewer.model) } : { text: screening.gathered !== undefined ? `${reviewer.name} starts once the papers arrive` : `${reviewer.name} has no papers left to read` },
        ...(screening.reviewers.some((one) => !one.left) ? [{ text: "Votes already cast stay as they are" }, ...(screening.rule.settle !== "one" ? [{ text: screening.rule.settle === "all" ? "Once every vote on a paper is in, votes that differ put it in conflict" : "Once every vote on a paper is in, an even split puts it in conflict" }] : [])] : []),
      ];
    }
    if (reviewer.email) return [{ text: `${reviewer.name} gets an invitation by email, and papers once they join`, kind: "mail" }];
    // An even share of the places nobody has voted from: where everyone reads every paper, all of the open ones.
    const share = screening.rule.each === "all" ? open : Math.round((state.counts.waiting * each) / (people.length + 1));
    return [
      { text: share ? `${reviewer.name} gets about ${plural(share, "open paper", "open papers")}, an even share, and an email saying so` : `${reviewer.name} joins and gets an email saying so. Every open paper already has its reviewers, so none goes to them yet`, kind: "join" },
      ...(screening.reviewers.some((one) => !one.left) ? [{ text: "Votes already cast stay as they are" }] : []),
    ];
  };
  const leavingLines = (reviewer: Reviewer, thrown: boolean): EffectLine[] => {
    const [whose, who] = reviewer.id === state.me ? ["Your", "you"] : [`${reviewer.name}'s`, reviewer.name];
    const [cast, waiting] = [reviewer.tally?.cast ?? 0, reviewer.tally?.waiting ?? 0];
    return [
      !cast ? { text: reviewer.id === state.me ? "You have cast no vote" : `${reviewer.name} has cast no vote` } : thrown ? { text: `${whose} ${plural(cast, "vote stays", "votes stay")} on record and ${cast === 1 ? "stops" : "stop"} counting`, kind: "leave" } : { text: `${whose} ${plural(cast, "vote keeps", "votes keep")} counting`, kind: "held" },
      ...(waiting && reviewer.kind === "person" ? [{ text: people.length > 1 ? `The ${plural(waiting, "paper", "papers")} ${who} had not voted on ${waiting === 1 ? "goes" : "go"} to the other reviewers` : `The ${plural(waiting, "paper", "papers")} ${who} had not voted on ${waiting === 1 ? "waits" : "wait"} for another reviewer`, kind: "join" as const }] : []),
      ...(thrown && cast ? [{ text: "The papers those votes settled are open again, unless someone settled them by hand" }] : []),
      ...(reviewer.id === screening.rule.resolver && screening.rule.settle !== "one" ? [{ text: reviewer.id === state.me ? "Conflicts go to whoever started the screening once you leave" : `${reviewer.name} settled conflicts. They go to whoever started the screening from now on` }] : []),
    ];
  };

  const confirmAdd = () => {
    if (!adding) return;
    const done = adding.model ? add({ jobId: id, model: { model: adding.model.id, ...(adding.model.effort ? { effort: adding.model.effort } : {}) } }) : adding.email ? sharing.invite(adding.email) : adding.guest ? sharing.give(adding.id as Id<"users">) : add({ jobId: id, personId: adding.id as Id<"users"> });
    void done.catch(failed);
  };

  const overlays = (
    <>
      <ActivitySheet open={over === "activity"} onClose={close} state={state} />
      {/* Its files are read only once it is opened. */}
      {over === "export" ? <ExportDialog open onClose={close} state={state} tab={exportTab} onTab={setExportTab} /> : null}
      <PeopleDialog open={over === "people"} onClose={close} state={state} onAdd={(reviewer) => { setOver(null); setAdding(reviewer); }} onRemove={(reviewer) => { setOver(null); setLeaving(reviewer); }} onDemote={(reviewer) => { setOver(null); setDemoting(reviewer); }} />
      <MoveDialog open={over === "move"} onOpenChange={(next) => !next && close()} kind="screening" id={id} name={screening.name} />
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
      <ConfirmChange open={adding !== null} title={adding ? `Add ${adding.name} as a reviewer?` : ""} confirm="Add as reviewer" disabled={Boolean(adding?.model && !screening.criteria.length)} onClose={close} onConfirm={confirmAdd}>
        {adding ? (
          <>
            {adding.model ? (
              <NodeCard model={adding.model} paidBy="credits" tabIndex={-1} note={<span className="tabular-nums">{perPaper(adding.model)}</span>} />
            ) : (
              <Panel className="flex items-center gap-3 p-3">
                <ReviewerMark reviewer={adding} className="size-9" />
                <p className="min-w-0 truncate text-sm font-medium">{adding.name}</p>
              </Panel>
            )}
            {adding.model && !screening.criteria.length ? (
              <Panel tone="warning" className="space-y-3 rounded-xl p-3">
                <p className="text-sm ink-warning">A model votes by answering the criteria, and this screening has none yet. It would include every paper it reads.</p>
                <Button asChild variant="outline" size="sm"><NextLink href={settingsHref(id, "criteria")} onClick={close}>Add criteria</NextLink></Button>
              </Panel>
            ) : (
              <EffectList lines={addingLines(adding)} />
            )}
            {/* A model reads the papers still open: the ones already settled are not read again, and are not paid for. */}
            {adding.model && state.wallet !== undefined ? <Credits model={adding.model} papers={toRead(adding)} wallet={state.wallet} onAddCredits={close} /> : null}
          </>
        ) : null}
      </ConfirmChange>
      <ConfirmChange
        open={leaving !== null}
        title={leavingMe ? "Leave this screening?" : leaving ? `Take ${leaving.name} off this screening?` : ""}
        confirm={leavingMe ? "Leave" : "Take off"}
        onClose={close}
        onConfirm={() => leaving?.row && void remove({ jobId: id, reviewerId: leaving.row, discard }).catch(failed)}
      >
        {leaving ? <EffectList lines={leavingLines(leaving, discard)} /> : null}
        {/* Their work stands unless whoever takes them off says otherwise: the votes go only where that is asked for, and what it undoes shows above before it is done. */}
        {leaving && leavingVotes ? (
          <label className="flex items-start gap-3 rounded-xl border border-border-subtle p-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">Throw out {leavingMe ? "your" : "their"} {plural(leavingVotes, "vote", "votes")}</span>
              <span className="block text-xs text-muted-foreground">{discard ? `${leavingMe ? "Your" : "Their"} votes stay on record and stop counting.` : `${leavingMe ? "Your" : "Their"} votes keep counting.`}</span>
            </span>
            <Switch checked={discard} onCheckedChange={setDiscard} aria-label={`Throw out ${leavingMe ? "your" : "their"} votes`} />
          </label>
        ) : null}
      </ConfirmChange>
      <ConfirmChange open={demoting !== null} title={demoting ? `Stop ${demoting.name} voting?` : ""} confirm="Make them a viewer" onClose={close} onConfirm={() => demoting && void sharing.demote(demoting.id as Id<"users">).catch(failed)}>
        {demoting ? <EffectList lines={[...leavingLines(demoting, false), "As a viewer they see every paper and every vote"]} /> : null}
      </ConfirmChange>
    </>
  );
  return { ...controls, overlays };
}

/** What the workspace has to pay a model with: where that runs out before the model has read every paper, how far it gets. */
function Credits({ model, papers, wallet, onAddCredits }: { model: MapModel; papers: number; wallet: number; onAddCredits: () => void }) {
  const each = paperCredits(model);
  if (each * papers <= wallet) return <p className="text-xs tabular-nums text-muted-foreground">{credits(wallet)} credits in the workspace now</p>;
  const paid = Math.floor(wallet / each);
  return (
    <Panel tone="warning" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl p-3">
      <Coins className="mt-0.5 size-4 shrink-0 self-start ink-warning" />
      <p className="min-w-0 flex-1 text-sm tabular-nums ink-warning">{credits(wallet)} credits pay for {paid ? `about ${num(paid)}` : "none"} of its {num(papers)} papers. It stops there until credits are added.</p>
      <Button asChild variant="outline" size="sm"><NextLink href="/settings/billing" onClick={onAddCredits}><Coins />Add credits</NextLink></Button>
    </Panel>
  );
}
