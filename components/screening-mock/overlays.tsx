"use client";

// Everything that opens over one screening, from its own pages and from its row in the list: its
// activity, export, share and move, and the confirmations for finishing it, deleting it, adding a
// reviewer and making one a viewer. Both places open these same ones, so they say and do the same.

import { useState } from "react";
import NextLink from "next/link";
import { Coins } from "@/components/icons";
import { NodeCard, type MapModel } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";
import { num, plural, projected, readNext, withAdded, type Reviewer, type Screening, inQuotes } from "./data";
import { ActivitySheet, ExportDialog, MoveDialog, ShareDialog, type ExportTab } from "./dialogs";
import { EffectList, ON_SAVE, collectionName, effectLines, effectMoves, movesText } from "./effects";
import { settingsHref } from "./links";
import { Panel, ReviewerMark, OpenPapersChips } from "./parts";
import { credits, paperCredits, useMock, type Open, walletOf, toppedUp, perPaper } from "./store";
import { ConfirmChange } from "./team";

export type Over = "activity" | "export" | "share" | "move" | "finish" | "delete";

/**
 * The overlays of one screening and the ways to open them. `start` opens one at once, for a row's menu
 * in the list. `onClosed` runs when the last of them has closed, and `onDeleted` after a deletion.
 */
export function useScreeningOverlays(state: Open | null, { start = null, onClosed, onDeleted }: { start?: Over | null; onClosed?: () => void; onDeleted?: () => void } = {}) {
  const store = useMock();
  const [over, setOver] = useState<Over | null>(start);
  const [exportTab, setExportTab] = useState<ExportTab>("papers");
  // A reviewer about to be added, and one about to be made a viewer: each says what it does before it happens.
  const [adding, setAdding] = useState<Reviewer | null>(null);
  const [demoting, setDemoting] = useState<Reviewer | null>(null);
  const controls = {
    show: (next: Over) => setOver(next),
    exportTo: (tab: ExportTab) => { setExportTab(tab); setOver("export"); },
    add: (reviewer: Reviewer) => setAdding(reviewer),
  };
  if (!state) return { ...controls, overlays: null };

  const { screening } = state;
  const { id } = screening;
  const close = () => { setOver(null); setAdding(null); setDemoting(null); onClosed?.(); };
  const unsettled = state.counts.conflict + state.counts.waiting;
  const collection = collectionName(screening);
  // What a model put on the screening still has to read, as adding it would leave things: the open papers it hasn't read, fewer when it comes back with votes it had cast.
  const toRead = (model: Reviewer) => {
    const next = projected(screening, withAdded(screening, model));
    return readNext(next, next.reviewers.find((one) => one.id === model.id)!, Infinity, () => Infinity).read;
  };
  const demoted = (reviewer: Reviewer): Screening => ({ ...screening, reviewers: screening.reviewers.map((one) => (one.id === reviewer.id ? { ...one, left: Date.now() } : one)), viewers: [...(screening.viewers ?? []), { ...reviewer, left: undefined }] });

  const overlays = (
    <>
      <ActivitySheet open={over === "activity"} onClose={close} state={state} />
      <ExportDialog open={over === "export"} onClose={close} state={state} tab={exportTab} onTab={setExportTab} />
      <ShareDialog open={over === "share"} onClose={close} state={state} onPromote={(viewer) => { setOver(null); setAdding({ ...viewer, addedAt: Date.now() }); }} onDemote={(reviewer) => { setOver(null); setDemoting(reviewer); }} />
      <MoveDialog open={over === "move"} onClose={close} screening={screening} me={state.me} onMove={(to, what) => state.update((s) => ({ ...s, workspace: to }), { what })} />
      <ConfirmChange
        open={over === "finish"}
        title="Mark this screening as finished?"
        confirm="Mark as finished"
        onClose={close}
        onConfirm={() => state.update((s) => ({ ...s, finishedAt: Date.now(), living: undefined }), { what: "Marked the screening as finished", effect: [unsettled ? `${plural(unsettled, "paper was", "papers were")} not settled` : "", screening.living ? "It stopped checking for new papers" : ""].filter(Boolean).join(". ") || undefined })}
      >
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
      <ConfirmChange open={over === "delete"} variant="destructive" title={`Delete ${inQuotes(screening.name)}?`} confirm="Delete" onClose={close} onConfirm={() => { store.remove(id); onDeleted?.(); }}>
        <EffectList lines={["Its votes and its settings go with it", ...(collection && state.counts.include ? [`The ${plural(state.counts.include, "paper", "papers")} saved to ${inQuotes(collection)} stay there`] : []), "This can't be undone"]} />
      </ConfirmChange>
      <ConfirmChange
        open={adding !== null}
        title={adding ? `Add ${adding.name} as a reviewer?` : ""}
        confirm="Add as reviewer"
        disabled={Boolean(adding?.model && !screening.criteria.length)}
        onClose={close}
        onConfirm={() => {
          if (!adding) return;
          const after = withAdded(screening, adding);
          state.update(() => after, { what: `Added ${adding.name} as a reviewer`, effect: effectLines(screening, after)[0] });
        }}
      >
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
              // Here nothing is saved apart from the adding itself.
              <EffectList lines={effectLines(screening, withAdded(screening, adding)).map((line) => line.replace(ON_SAVE, "as soon as it is added"))} moves={effectMoves(screening, withAdded(screening, adding))} unseen={(paper) => !state.canSee(paper)} />
            )}
            {/* A model reads the papers still open: the ones already settled are not read again, and are not paid for. */}
            {adding.model ? <Credits model={adding.model} papers={toRead(adding)} wallet={walletOf(screening, store)} onAddCredits={() => { store.set(toppedUp(screening, store)); close(); }} /> : null}
          </>
        ) : null}
      </ConfirmChange>
      <ConfirmChange
        open={demoting !== null}
        title={demoting ? `Stop ${demoting.name} voting?` : ""}
        confirm="Make them a viewer"
        onClose={close}
        onConfirm={() => demoting && state.update(() => demoted(demoting), { what: `Made ${demoting.name} a viewer`, effect: [...effectLines(screening, demoted(demoting)), movesText(effectMoves(screening, demoted(demoting)))].filter(Boolean).join(". ") || undefined })}
      >
        {demoting ? <EffectList lines={[...effectLines(screening, demoted(demoting)), "They go on seeing every paper and every vote"]} moves={effectMoves(screening, demoted(demoting))} unseen={(paper) => !state.canSee(paper)} /> : null}
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
      {/* The mock has no payment: going to billing adds the credits, and Back returns here with them. */}
      <Button asChild variant="outline" size="sm"><NextLink href="/settings/billing" onClick={onAddCredits}><Coins />Add credits</NextLink></Button>
    </Panel>
  );
}
