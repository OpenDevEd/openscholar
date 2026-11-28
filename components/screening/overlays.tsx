"use client";

// Everything that opens over one screening, from its own pages and from its row in the list: its
// activity, export, people and move, and the confirmations for finishing it, deleting it, adding a
// reviewer, taking one off and making one a viewer. Both places open these same ones, so they say
// and do the same.

import { parseAsString, parseAsStringLiteral, useQueryState, useQueryStates } from "nuqs";
import { innerStep, leaveBehind, useOpenInAddress } from "./address";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
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
import { blindOf, growing, modelKey, modelsOf, peopleOf, withTwins, withoutReviewer, type Reviewer, type Screening } from "./data";
import { useKept } from "./drafts";
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

const CHANGES = ["add", "off", "viewer"] as const;
export const OVERS = ["activity", "export", "people", "move", "finish", "delete", "leave", "stopEmails", "confirm"] as const;
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
      {/* Its emails go to its reviewers and to whoever settles its conflicts: each of them turns their own off here, and on again, on a finished screening too. */}
      {open.isReviewer || open.canResolve || open.guest === "editor" ? (
        <DropdownMenuItem onSelect={() => (open.emails ? show("stopEmails") : void open.setEmails(true).then(() => toast(t("menu.emailsOn"))).catch(failed(t)))}>
          {open.emails ? <><BellOff />{t("menu.stopEmails")}</> : <><Mail />{t("menu.emailAgain")}</>}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator className={bar ? "xl:hidden" : undefined} />
      {member ? (live ? <DropdownMenuItem onSelect={() => show("finish")}><CircleCheck />{t("markFinished")}</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void open.reopen()}><RotateCcw />{t("reopen")}</DropdownMenuItem>) : null}
      {member && live && modelsOf(screening).length ? (screening.paused ? <DropdownMenuItem onSelect={() => void open.resume()}><Play />{t("resumeModels")}</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void open.pause()}><CirclePause />{t("menu.pauseModels")}</DropdownMenuItem>) : null}
      {member && growing(screening).length ? <DropdownMenuItem disabled={Boolean(screening.checking || open.gathering)} onSelect={() => void open.check()}><RefreshCw />{t(screening.finishedAt ? "checkReopens" : "checkNew")}</DropdownMenuItem> : null}
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
 * The overlays of one screening and the ways to open them, kept in the address over its pages and over the list's row
 * (./address.ts): opening one is a step in the history, Back closes it, and closing it steps back. `onDeleted` runs
 * after a deletion.
 */
export function useScreeningOverlays(state: Open | null, { onDeleted }: { onDeleted?: () => void } = {}) {
  const t = useTranslations("screening.frame");
  const common = useTranslations("common");
  // The router as it is, for an address already in the workspace it names (a screening moved to another).
  const nextRouter = useRouter();
  const words = useWords();
  const [over, setOver] = useOpenInAddress("over", OVERS, { inner: ["tab", "whose", "group", "row", "who", "change"] });
  // An email's "Turn off emails" link opens the screening with ?emails=off: it asks before it turns them off.
  const [emailsLink, setEmailsLink] = useQueryState("emails");
  // The Export dialog's tab, in the address with it: each tab is a step, Back returns to the one before, and closing Export goes back over all of them.
  const [tabInAddress, setTabInAddress] = useQueryState("tab", parseAsStringLiteral(EXPORT_TABS).withOptions({ history: "push", scroll: false }));
  const exportTab = tabInAddress ?? "papers";
  const setExportTab = (tab: ExportTab) => void setTabInAddress(tab === "papers" ? null : tab, innerStep());
  // A reviewer about to be added, one about to be taken off and one about to be made a viewer: each says what it does before it happens.
  const [adding, setAdding] = useState<Reviewer | null>(null);
  const [leaving, setLeaving] = useState<Reviewer | null>(null);
  const [demoting, setDemoting] = useState<Reviewer | null>(null);
  // A confirmation is open over the page as anything else is (`over=confirm`), a step of its own: asked from People, it goes back to People once answered.
  const [fromPeople, setFromPeople] = useState(false);
  // A delete or leave confirmed: the dialog's own close is skipped, since leading away closes it.
  const going = useRef(false);
  // Who a confirmation is about, and the change, are in the address with it: Forward or a reload asks about the same reviewer again.
  const [about, setAbout] = useQueryStates({ who: parseAsString, change: parseAsStringLiteral(CHANGES) }, { history: "push", scroll: false });
  // Someone being added is kept with the tab as they were picked, since no list on the page holds them.
  const kept = useKept((store) => store.adding);
  const keep = useKept((store) => store.set);
  // One confirmation at a time: whatever was asked before (and left by Back) is cleared first.
  const ask = (set: (reviewer: Reviewer) => void, reviewer: Reviewer, people: boolean, change: (typeof CHANGES)[number]) => { setAdding(null); setLeaving(null); setDemoting(null); set(reviewer); if (change === "add") keep({ adding: reviewer }); setFromPeople(people); void setAbout({ who: reviewer.id, change }); setOver("confirm"); };
  const leave = useWorkspaceMutation(api.sharing.guests.leave);
  const add = useWorkspaceMutation(api.screening.reviewers.add);
  const remove = useWorkspaceMutation(api.screening.reviewers.remove);
  const sharing = useSharing((state?.screening.id ?? "") as Id<"screeningJobs">);
  const controls = {
    show: (next: Over) => setOver(next),
    exportTo: (tab: ExportTab) => { setExportTab(tab); setOver("export"); },
    add: (reviewer: Reviewer) => ask(setAdding, reviewer, false, "add"),
    takeOff: (reviewer: Reviewer) => ask(setLeaving, reviewer, false, "off"),
  };
  if (!state) return { ...controls, overlays: null };

  const { screening } = state;
  const { id } = screening;
  const close = () => { setOver(null); setAdding(null); setLeaving(null); setDemoting(null); };
  // A screening deleted or left: its own pages lead away to the list in place of this entry; over the list, the dialog takes itself out of the address.
  const gone = () => { if (onDeleted) onDeleted(); else setOver(null, { inPlace: true }); };
  // Asked from People, the confirmation is a step on top of it: answering it steps back to People, as Back would.
  // Whether the entry under this one is People, read from the browser's history where it can say (after a reload or Forward too), else from where it was asked.
  const peopleUnder = () => {
    const list = (window as Window & { navigation?: { currentEntry?: { index: number } | null; entries: () => Array<{ url: string | null }> } }).navigation;
    const at = list?.currentEntry?.index;
    const under = list && at !== undefined && at > 0 ? list.entries()[at - 1]?.url : undefined;
    return under ? new URL(under).searchParams.get("over") === "people" : fromPeople;
  };
  const answered = () => { setAdding(null); setLeaving(null); setDemoting(null); if (peopleUnder()) window.history.back(); else close(); };
  // Reached again by Forward or a reload, a confirmation asks about whoever the address names: someone on the screening by their id, someone being added as they were picked. One no longer to be asked about (added since, or taken off) is People, where it was asked.
  const named = (change: (typeof CHANGES)[number]) => (about.change === change && about.who ? (screening.reviewers.find((one) => one.id === about.who && !one.left) ?? null) : null);
  const onIt = (reviewer: Reviewer) => (reviewer.email ? state.invited.some((one) => one.email?.toLowerCase() === reviewer.email!.toLowerCase()) : screening.reviewers.some((one) => !one.left && (reviewer.model ? one.model !== undefined && modelKey(one.model) === modelKey(reviewer.model) : one.id === reviewer.id)));
  const addingNow = adding ?? (about.change === "add" && kept?.id === about.who && !onIt(kept) ? kept : null);
  const leavingNow = leaving ?? named("off");
  const demotingNow = demoting ?? named("viewer");
  const confirming = over === "confirm" && Boolean(addingNow || leavingNow || demotingNow);
  const unsettled = state.counts.conflict + state.counts.waiting;
  const mine = screening.reviewers.find((one) => one.id === state.me && !one.left)?.tally;
  const collection = words.collectionName(screening);
  // Once added, they are no longer asked about: Forward over the question opens People.
  const confirmAdd = (reviewer: Reviewer) => addOf(reviewer).then((done) => { keep({ adding: undefined }); return done; });
  const addOf = (reviewer: Reviewer) =>
    reviewer.model ? add({ jobId: id, model: { model: reviewer.model.id, ...(reviewer.model.effort ? { effort: reviewer.model.effort } : {}) } }) : reviewer.email ? sharing.invite(reviewer.email) : reviewer.guest ? sharing.give(reviewer.id as Id<"users">) : add({ jobId: id, personId: reviewer.id as Id<"users"> });

  const overlays = (
    <>
      <ActivitySheet open={over === "activity"} onClose={close} state={state} />
      {/* Its files are read only once it is opened. */}
      {over === "export" ? <ExportDialog open onClose={close} state={state} tab={exportTab} onTab={setExportTab} /> : null}
      <PeopleDialog open={over === "people" || (over === "confirm" && !confirming)} onClose={close} state={state} onAdd={(reviewer) => ask(setAdding, reviewer, true, "add")} onRemove={(reviewer) => ask(setLeaving, reviewer, true, "off")} onDemote={(reviewer) => ask(setDemoting, reviewer, true, "viewer")} />
      <MoveDialog
        open={over === "move"}
        // Moved, it leads to the workspace it went to: the dialog's own close, a step back, would cancel that.
        onMoved={() => { going.current = true; }}
        // From one of its own pages, every page of it in the workspace it left is out of the way back.
        lead={(href) => (/\/screening\/[^/]+/.test(window.location.pathname) ? leaveBehind(window.location.pathname.replace(/\/(screen|papers|settings)$/, ""), (how) => nextRouter[how](href)) : nextRouter.replace(href))}
        onOpenChange={(next) => !next && !going.current && close()}
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
        open={over === "stopEmails" || (emailsLink === "off" && state.emails && (state.isReviewer || state.canResolve || state.guest === "editor"))}
        title={t("stopEmails.title")}
        confirm={t("stopEmails.confirm")}
        cancel={t("stopEmails.cancel")}
        onClose={() => { close(); void setEmailsLink(null); }}
        onConfirm={() => void state.setEmails(false).then(() => { close(); void setEmailsLink(null); toast(t("menu.emailsOff")); }).catch(failed(t))}
      >
        <p className="text-sm text-muted-foreground">{t("stopEmails.says")}</p>
      </ConfirmChange>
      {/* The link in an email that turns them off, followed when they are off already: it says so, with the way to have them again, never a page that does nothing. */}
      {(() => {
        // Someone still on it can have them again, a guest given it to vote on while it is finished among them. Anyone else gets none from it, whatever an old email offered.
        const receives = state.isReviewer || state.canResolve || state.guest === "editor";
        return (
          <ConfirmChange
            open={emailsLink === "off" && !(state.emails && receives)}
            title={t("menu.emailsOff")}
            confirm={receives ? t("menu.emailAgain") : common("close")}
            cancel={receives ? t("stopEmails.keepOff") : null}
            onClose={() => void setEmailsLink(null)}
            onConfirm={() => (receives ? void state.setEmails(true).then(() => toast(t("menu.emailsOn"))).catch(failed(t)) : undefined)}
          />
        );
      })()}
      <ConfirmChange open={over === "finish"} title={t("finish.title")} confirm={t("markFinished")} onClose={close} onConfirm={() => void state.finish().catch(failed(t))}>
        <EffectList
          lines={[
            ...(unsettled ? [t("finish.unsettled", { count: unsettled })] : []),
            t("finish.votingStops"),
            ...({ all: [t("finish.votesShow")], people: [t("finish.peopleVotesShow")], none: [], done: [] } as const)[blindOf(screening, state.invited)],
            ...(state.reading.length ? [t("finish.modelsStop")] : []),
            ...(screening.living ? [t("finish.checksStop")] : []),
            t("finish.movesToFinished"),
          ]}
        />
        {/* The papers that would be left unsettled, one press away. */}
        {unsettled ? <OpenPapersChips id={id} conflict={state.counts.conflict} waiting={state.counts.waiting} /> : null}
      </ConfirmChange>
      {/* Whoever made it deletes it, or an admin of its workspace (convex/workspaces/actor.ts `requireMakerOrAdmin`): the menu offers it to nobody else. */}
      {/* Once confirmed, it leads away at once, before the screening's pages can redraw it as gone: the page it leads to takes this entry's place, and Forward never returns to the dialog. If the server refuses, a toast says so. */}
      <ConfirmChange open={over === "delete"} variant="destructive" title={t("delete.title", { name: words.quoted(screening.name) })} confirm={t("menu.delete")} onClose={() => !going.current && close()} onConfirm={() => { going.current = true; gone(); void state.remove().catch(failed(t)); }}>
        <EffectList lines={[t("delete.goes"), ...(collection && state.counts.include ? [t("delete.saved", { count: state.counts.include, collection: words.quoted(collection) })] : collection && screening.destination.collection ? [t("delete.collectionStays", { collection: words.quoted(collection) })] : []), t("delete.final")]} />
      </ConfirmChange>
      {/* A guest gives up their own place: what they voted stays, and what they hadn't goes to the others, as when a member takes them off. */}
      <ConfirmChange open={over === "leave"} title={t("leave.title")} confirm={t("leave.confirm")} onClose={() => !going.current && close()} onConfirm={() => { going.current = true; gone(); void leave({ id }).catch(failed(t)); }}>
        <EffectList
          lines={[
            mine?.cast ? t("leave.votesCount", { count: mine.cast }) : t("leave.noVotes"),
            ...(mine?.waiting ? [t("leave.papersGo", { count: mine.waiting })] : []),
            t("leave.fromList"),
          ]}
        />
      </ConfirmChange>
      <AddReviewer open={state} reviewer={confirming ? addingNow : null} onConfirm={confirmAdd} onClose={answered} />
      {/* Keyed by who it is about, so a choice made for someone else (Stop counting votes) never carries over. */}
      <TakeOff key={`off:${leavingNow?.id ?? ""}`} open={state} reviewer={confirming ? leavingNow : null} onConfirm={(reviewer, discard) => (reviewer.row ? remove({ jobId: id, reviewerId: reviewer.row, discard }) : Promise.resolve(null))} onClose={answered} />
      <TakeOff key={`viewer:${demotingNow?.id ?? ""}`} open={state} reviewer={confirming ? demotingNow : null} viewer onConfirm={(reviewer) => sharing.demote(reviewer.id as Id<"users">)} onClose={answered} />
    </>
  );
  return { ...controls, overlays };
}

/** Asks the server again to count what a change does, where it couldn't: the same as Settings offers. */
function CountAgain({ onClick }: { onClick: () => void }) {
  const t = useTranslations("screening.effects");
  return <Button variant="outline" size="sm" className="mt-2.5" onClick={onClick}><RefreshCw />{t("countAgain")}</Button>;
}

/** What a confirmation says while the server counts what the change does, or once it couldn't: never a change of nothing. */
const uncounted = (t: (key: "counting" | "countFailed") => string, counted: { data?: unknown; error?: unknown }) => (counted.error ? t("countFailed") : counted.data ? undefined : t("counting"));

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
              <Button asChild variant="outline" size="sm"><NextLink href={settingsHref(id, "criteria")}>{screening.criteria.length ? t("add.markMustHave") : t("add.addCriteria")}</NextLink></Button>
            </Panel>
          ) : (
            <EffectList lines={!change || counted.data ? effectLines(say, screening, after, preview, { me: open.me, wallet: open.wallet, waiting: Boolean(open.waitingFor), openNow: open.counts.waiting + open.counts.conflict }) : []} none={change ? uncounted(say.t, counted) : undefined} />
          )}
          {change && counted.error ? <CountAgain onClick={() => void counted.mutate()} /> : null}
          {/* A model reads the papers still open: the ones already settled are not read again, and are not paid for. */}
          {reviewer.model && open.wallet !== undefined && counted.data ? <Credits cost={readingOf(after, reviewer.model, preview.joining[reviewer.id]?.reads ?? 0)} papers={preview.joining[reviewer.id]?.reads ?? 0} wallet={open.wallet} /> : null}
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
    <ConfirmChange open={reviewer !== null} title={!reviewer ? "" : viewer ? t("takeOff.viewerTitle", { name: reviewer.name }) : me ? t("leave.title") : t("takeOff.title", { name: reviewer.name })} confirm={viewer ? t("takeOff.makeViewer") : me ? t("leave.confirm") : t("takeOff.confirm")} disabled={counted.isValidating || Boolean(counted.error)} onClose={close} onConfirm={() => void (reviewer && onConfirm(reviewer, discard).catch(failed(t)))}>
      {/* What the change does as counted for the choice as it now stands: the count for the choice before stays dimmed while the new one is read, and confirming waits for it. */}
      {reviewer ? <div className={cn("transition-opacity", counted.isValidating && "opacity-55")}><EffectList lines={counted.data && !counted.error ? [...effectLines(say, screening, withoutReviewer(screening, reviewer, discard, now), preview, { me: open.me }), ...(viewer ? [t("takeOff.asViewer")] : [])] : []} moves={counted.error ? [] : preview.moves} none={uncounted(say.t, counted)} screening={screening.id} />{counted.error ? <CountAgain onClick={() => void counted.mutate()} /> : null}</div> : null}
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
function Credits({ cost, papers, wallet }: { /** What reading those papers costs the model at most. */ cost: number; papers: number; wallet: number }) {
  const t = useTranslations("screening.frame");
  const words = useWords();
  if (cost <= wallet) return <p className="text-xs tabular-nums text-muted-foreground">{t("credits.inWorkspace", { credits: words.creditsOf(wallet) })}</p>;
  const paid = Math.floor((papers * wallet) / cost);
  return (
    <Panel tone="warning" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl p-3">
      <Coins className="mt-0.5 size-4 shrink-0 self-start ink-warning" />
      <p className="min-w-0 flex-1 text-sm tabular-nums ink-warning">{t("credits.payFor", { some: String(paid > 0), credits: words.creditsOf(wallet), paid, papers })}</p>
      <Button asChild variant="outline" size="sm"><NextLink href="/settings/billing"><Coins />{t("addCredits")}</NextLink></Button>
    </Panel>
  );
}
