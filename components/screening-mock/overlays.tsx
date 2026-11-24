"use client";

// Everything that opens over one screening, from its own pages and from its row in the list: its
// activity, export, share and move, and the confirmations for finishing it, deleting it, adding a
// reviewer and making one a viewer. Both places open these same ones, so they say and do the same.

import { useState } from "react";
import NextLink from "next/link";
import { GitCompare, Hourglass } from "@/components/icons";
import { NodeCard } from "@/components/settings/model-map";
import { Button } from "@/components/ui/button";
import type { Reviewer, Screening } from "./data";
import { ActivitySheet, ExportDialog, MoveDialog, ShareDialog, type ExportTab } from "./dialogs";
import { EffectList, collectionName, effectLines, effectMoves, movesText } from "./effects";
import { papersHref, settingsHref } from "./links";
import { LinkChip, Panel, ReviewerMark } from "./parts";
import { credits, paperCredits, useMock, type Open } from "./store";
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
  const withAdded = (reviewer: Reviewer): Screening => ({
    ...screening,
    reviewers: [...screening.reviewers.filter((one) => one.id !== reviewer.id), reviewer],
    viewers: screening.viewers?.filter((one) => one.id !== reviewer.id),
    reached: { ...screening.reached, [reviewer.id]: 0 },
  });
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
        onConfirm={() => state.update((s) => ({ ...s, finishedAt: Date.now(), living: undefined }), { what: "Marked the screening as finished", effect: [unsettled ? `${unsettled} papers were not settled` : "", screening.living ? "It stopped checking for new papers" : ""].filter(Boolean).join(". ") || undefined })}
      >
        <EffectList
          lines={[
            ...(unsettled ? [`${unsettled} ${unsettled === 1 ? "paper is" : "papers are"} not settled, and ${unsettled === 1 ? "stays" : "stay"} as ${unsettled === 1 ? "it is" : "they are"}`] : []),
            ...(state.reading.length ? ["The models stop reading"] : []),
            ...(screening.living ? ["It stops checking for new papers"] : []),
            "It moves to Finished in the list, and can be reopened or changed at any time",
          ]}
        />
        {/* The papers that would be left unsettled, one press away. */}
        {unsettled ? (
          <div className="flex flex-wrap gap-1.5">
            {state.counts.conflict ? <LinkChip href={papersHref(id, { result: "conflict" })} tone="info" icon={GitCompare} onClick={close}>{state.counts.conflict} in conflict</LinkChip> : null}
            {state.counts.waiting ? <LinkChip href={papersHref(id, { result: "waiting" })} icon={Hourglass} onClick={close}>{state.counts.waiting} waiting for votes</LinkChip> : null}
          </div>
        ) : null}
      </ConfirmChange>
      <ConfirmChange open={over === "delete"} variant="destructive" title={`Delete “${screening.name}”?`} confirm="Delete" onClose={close} onConfirm={() => { store.remove(id); onDeleted?.(); }}>
        <EffectList lines={["Its votes and its settings go with it", ...(collection && state.counts.include ? [`The ${state.counts.include} ${state.counts.include === 1 ? "paper" : "papers"} saved to ${collection} stay there`] : []), "This can't be undone"]} />
      </ConfirmChange>
      <ConfirmChange
        open={adding !== null}
        title={adding ? `Add ${adding.name} as a reviewer?` : ""}
        confirm="Add as reviewer"
        disabled={Boolean(adding?.model && !screening.criteria.length)}
        onClose={close}
        onConfirm={() => {
          if (!adding) return;
          const after = withAdded(adding);
          state.update(() => after, { what: `Added ${adding.name} as a reviewer`, effect: effectLines(screening, after)[0] });
        }}
      >
        {adding ? (
          <>
            {adding.model ? (
              <NodeCard model={adding.model} paidBy="credits" tabIndex={-1} note={<span className="tabular-nums">{credits(paperCredits(adding.model))} credits a paper</span>} />
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
              <EffectList lines={effectLines(screening, withAdded(adding))} moves={effectMoves(screening, withAdded(adding))} />
            )}
            {adding.model ? <p className="text-xs tabular-nums text-muted-foreground">{credits(store.wallet)} credits in the workspace now</p> : null}
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
        {demoting ? <EffectList lines={[...effectLines(screening, demoted(demoting)), "They go on seeing every paper and every vote"]} moves={effectMoves(screening, demoted(demoting))} /> : null}
      </ConfirmChange>
    </>
  );
  return { ...controls, overlays };
}
