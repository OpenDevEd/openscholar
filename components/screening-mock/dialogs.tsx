"use client";

// What opens over an open screening: its activity, and what can be taken out of it.

import { useState } from "react";
import { Check, Copy, Download, Info, X } from "@/components/icons";
import { IconButton } from "@/components/assistant/parts";
import { Chip } from "@/components/screening/parts";
import { PickMark } from "@/components/screening/source-row";
import { SharePanel, type ShareRole } from "@/components/shared/share-panel";
import { WorkspaceTile } from "@/components/workspaces/parts";
import { LIST, Segmented } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { DECISION_LABEL, NOW, PEOPLE, RESULT_LABEL, STAGE_LABEL, WORKSPACES, activeReviewers, agreement, ago, count, invitedReviewer, keptOf, modelsOf, peopleOf, personOf, personReviewer, failedLabel, reasonOf, taken, workspaceOf, type Paper, type Result, type Reviewer, type Screening } from "./data";
import { EffectList } from "./effects";
import { ReviewerMark, VoteMark } from "./parts";
import { credits, type Open } from "./store";

const save = (name: string, type: string, text: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
};
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Every change made to the screening, newest first: who, what, and what it did. */
export function ActivitySheet({ open, onClose, screening }: { open: boolean; onClose: () => void; screening: Open["screening"] }) {
  const changes = [...screening.changes].reverse();
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className={`w-full gap-0 p-0 sm:max-w-md ${AVATARS_FADE_IN}`}>
        <SheetHeader className="border-b border-border-subtle p-5">
          <SheetTitle>Activity</SheetTitle>
          <SheetDescription>Every change to this screening, and what it did</SheetDescription>
        </SheetHeader>
        <ol className="divide-y divide-border-subtle overflow-y-auto">
          {changes.map((change, i) => {
            const person = personOf(change.by);
            return (
              <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                <IdentityAvatar name={person?.name ?? change.by} imageUrl={person?.imageUrl} className="size-7" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm"><span className="font-medium">{person?.name ?? change.by}</span> <span className="text-muted-foreground">{ago(change.at)}</span></p>
                  <p className="text-sm">{change.what}</p>
                  {change.effect ? <p className="text-xs text-muted-foreground">{change.effect}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </SheetContent>
    </Sheet>
  );
}

const SHARE_ROLES: Array<ShareRole<"reviewer" | "viewer">> = [
  { id: "reviewer", kind: "edit", label: "Votes", can: "Votes on papers" },
  { id: "viewer", kind: "view", label: "Views", can: "Sees everything, doesn't vote" },
];

/**
 * Who has a screening: its workspace, whose members all see it, then each person on it and whether
 * they vote. Someone from outside is added here to look, and made a reviewer to vote.
 */
export function ShareDialog({ open, onClose, state, onPromote, onDemote }: { open: boolean; onClose: () => void; state: Open; onPromote: (viewer: Reviewer) => void; onDemote: (reviewer: Reviewer) => void }) {
  const { screening } = state;
  const [query, setQuery] = useState("");
  const workspace = workspaceOf(screening);
  const people = peopleOf(screening);
  const viewers = screening.viewers ?? [];
  const on = [...people, ...viewers];
  const words = query.trim().toLowerCase();
  // Someone added in this sitting is told so: the row says how they hear of it.
  const detail = (one: Reviewer) => (one.email ? "Invited by email, joins when they accept" : one.addedAt > NOW ? "Told by email just now, with a link" : personOf(one.id)?.guest ? "From outside this workspace" : `In ${workspace.name}`);
  const share = (viewer: Reviewer) => state.update((s) => ({ ...s, viewers: [...(s.viewers ?? []), viewer] }), { what: `Shared it with ${viewer.name}`, effect: "They see every paper and every vote, and aren't dealt papers" });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className={`top-[max(1rem,12dvh)] flex max-h-[min(40rem,calc(88dvh-1rem))] max-w-lg translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 ${AVATARS_FADE_IN}`}>
        <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">Share this screening</DialogTitle>
            <DialogDescription className="truncate text-xs">{screening.name}</DialogDescription>
          </div>
          <IconButton label="Close" icon={<X className="size-4" />} onClick={onClose} />
        </div>
        <SharePanel
          roles={SHARE_ROLES}
          adding={
            state.canChange
              ? {
                  query,
                  onQuery: setQuery,
                  // Its workspace's members have it already: the people to add are the ones outside it.
                  candidates: PEOPLE.filter((person) => person.guest && !on.some((one) => one.id === person.id) && (!words || person.name.toLowerCase().includes(words))).map((person) => ({ key: person.id, avatar: <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-9" />, name: person.name, detail: "Outside this workspace", pick: () => share(personReviewer(person, Date.now())) })),
                  invite: (email) => share(invitedReviewer(email, Date.now())),
                  has: (email) => on.some((one) => one.email === email),
                }
              : undefined
          }
          entries={[
            { key: "workspace", avatar: <WorkspaceTile workspace={{ kind: workspace.kind, name: workspace.name, imageUrl: workspace.imageUrl, colour: workspace.colour, workspaceId: workspace.id }} size="row" />, name: workspace.name, detail: workspace.members, role: { kind: "member", label: "See it and can change it" } },
            ...people.map((one) => ({ key: one.id, avatar: <ReviewerMark reviewer={one} className="size-9" />, name: one.name, you: one.id === state.me, detail: detail(one), role: "reviewer" as const, onRole: state.canChange ? (role: "reviewer" | "viewer") => role === "viewer" && onDemote(one) : undefined })),
            ...viewers.map((one) => ({ key: one.id, avatar: <ReviewerMark reviewer={one} className="size-9" />, name: one.name, you: one.id === state.me, detail: detail(one), role: "viewer" as const, onRole: state.canChange ? (role: "reviewer" | "viewer") => role === "reviewer" && onPromote(one) : undefined, onRemove: state.canChange ? () => state.update((s) => ({ ...s, viewers: s.viewers?.filter((viewer) => viewer.id !== one.id) }), { what: `Stopped sharing it with ${one.name}` }) : undefined })),
          ]}
          foot={
            <div className="space-y-1.5 px-1 text-xs text-muted-foreground">
              <p className="flex items-start gap-2"><Info className="mt-px size-3.5 shrink-0" />Someone who views sees every paper and every vote. Someone who votes is a reviewer, and is dealt papers.</p>
              {screening.rule.blind === "after" ? <p className="ps-5.5">Votes are blind for whoever still has to vote on a paper: nobody sees its other votes before casting their own.</p> : null}
            </div>
          }
          onCopy={() => navigator.clipboard.writeText(window.location.href)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Moves a screening to another of your workspaces, saying first what goes with it and who pays for its models from then on. */
export function MoveDialog({ open, onClose, screening, me, onMove }: { open: boolean; onClose: () => void; screening: Screening; me: string; onMove: (workspace: string, what: string) => void }) {
  const [to, setTo] = useState<string | null>(null);
  const from = workspaceOf(screening);
  const target = WORKSPACES.find((one) => one.id === to);
  const models = modelsOf(screening);
  const staying = peopleOf(screening).filter((one) => one.id !== me).length;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { onClose(); setTo(null); } }}>
      <DialogContent className={`max-w-md ${AVATARS_FADE_IN}`}>
        <DialogHeader>
          <DialogTitle>Move this screening</DialogTitle>
          <DialogDescription className="truncate">{screening.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div role="radiogroup" aria-label={`Move it from ${from.name} to`} className="space-y-1">
            <p className="pb-1 text-xs font-medium text-muted-foreground">From {from.name} to</p>
            {WORKSPACES.filter((one) => one.mine && one.id !== from.id).map((one) => (
              <button key={one.id} type="button" role="radio" aria-checked={to === one.id} onClick={() => setTo(one.id)} className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start transition-colors hover:bg-muted ${to === one.id ? "bg-primary/5" : ""}`}>
                <WorkspaceTile workspace={{ kind: one.kind, name: one.name, imageUrl: one.imageUrl, colour: one.colour, workspaceId: one.id }} size="row" className="self-start" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{one.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{one.members}</span>
                </span>
                <Chip>{credits(one.credits)} credits</Chip>
                <PickMark on={to === one.id} />
              </button>
            ))}
          </div>
          {target ? (
            <EffectList
              lines={[
                "Its papers, votes, settings and activity go with it",
                ...(models.length ? [`Its ${models.length === 1 ? "model is" : "models are"} paid from ${target.name}'s credits from now on`] : []),
                ...(staying ? [`The ${staying === 1 ? "other person" : `${staying} other people`} on it ${staying === 1 ? "stays" : "stay"} on it, as ${staying === 1 ? "a guest" : "guests"} where they aren't in ${target.name}`] : []),
                ...(screening.destination.kind !== "none" ? [`Papers it has saved stay in ${from.name}, and the ones it includes from now on are saved in ${target.name}`] : []),
                `It leaves ${from.name}'s list for everyone else there`,
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Pick where it goes, and what moving does shows here first.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { onClose(); setTo(null); }}>Cancel</Button>
          <Button disabled={!target} onClick={() => { if (target) onMove(target.id, `Moved it from ${from.name} to ${target.name}`); onClose(); setTo(null); }}>Move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type ExportTab = "papers" | "votes" | "flow" | "methods";
const VOTES_PAGE = 8;

/** The three things a review's report needs from its screening: every vote, the flow of papers, and a paragraph for the methods section. */
export function ExportDialog({ open, onClose, state, tab, onTab }: { open: boolean; onClose: () => void; state: Open; tab: ExportTab; onTab: (tab: ExportTab) => void }) {
  const [page, setPage] = useState(1);
  // What was last taken out, so its button says so: a download gives no other sign.
  const [done, setDone] = useState<string | null>(null);
  const setTab = (next: ExportTab) => { setDone(null); onTab(next); };
  const { screening, first, second } = state;
  const reviewers = activeReviewers(screening);

  // One row per reviewer per paper, at both stages: the complete record.
  const rows = [first, second].flatMap((stage, s) =>
    stage.papers.flatMap((paper) =>
      stage.votes[paper.id]!.flatMap(({ reviewer, vote }) =>
        vote ? [{ stage: s === 0 ? "abstract" : "fullText", paper, reviewer, vote, result: stage.settled[paper.id]!.result }] : [],
      ),
    ),
  );
  const csv = () =>
    [
      ["stage", "paper", "year", "reviewer", "reviewer_kind", "decision", "reason", ...screening.criteria.map((c) => c.short), "note", "paper_result", "voted_at"],
      ...rows.map((row) => [
        STAGE_LABEL[row.stage as "abstract" | "fullText"], row.paper.title, row.paper.year, row.reviewer.name, row.reviewer.kind, DECISION_LABEL[row.vote.decision],
        row.vote.reason ? failedLabel(row.vote.reason, screening.criteria) : "", ...screening.criteria.map((c) => row.vote.answers[c.key] ?? ""), row.vote.note ?? "", RESULT_LABEL[row.result], new Date(row.vote.at).toISOString(),
      ]),
    ].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");

  const found = screening.sources.reduce((sum, source) => sum + taken(source), 0);
  const kept = screening.sources.reduce((sum, source) => sum + keptOf(source), 0);
  const reasons = (state: typeof first) => {
    const tally = new Map<string, number>();
    for (const paper of state.papers) if (state.settled[paper.id]!.final === "exclude") { const key = reasonOf(state.votes[paper.id]!, state.settled[paper.id]) ?? "other"; tally.set(key, (tally.get(key) ?? 0) + 1); }
    return [...tally].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ label: `Excluded, ${failedLabel(key, screening.criteria).replace(/^Not met/, "not met")}`, n }));
  };
  // What a researcher takes away: the papers kept at the last stage the screening has.
  const last = screening.fullText ? second : first;
  const included: Paper[] = last.papers.filter((paper) => last.settled[paper.id]!.final === "include");
  const ris = () => included.map((paper) => ["TY  - JOUR", `TI  - ${paper.title}`, ...paper.authors.filter((a) => a !== "and others").map((a) => `AU  - ${a}`), `PY  - ${paper.year}`, `JO  - ${paper.venue}`, ...(paper.sentences.length ? [`AB  - ${paper.sentences.join(" ")}`] : []), "ER  - "].join("\n")).join("\n\n");
  const bib = () => included.map((paper, i) => `@article{${paper.authors[0]!.split(" ").pop()!.toLowerCase()}${paper.year}${String.fromCharCode(97 + (i % 26))},\n  title = {${paper.title}},\n  author = {${paper.authors.filter((a) => a !== "and others").join(" and ")}},\n  year = {${paper.year}},\n  journal = {${paper.venue}}\n}`).join("\n\n");
  const noText = count(second.papers, (paper) => !state.hasFullText(paper));
  // Assessed and not yet decided: a paper with no full text is counted with the ones not retrieved, not here.
  const openAtFullText = count(second.papers, (paper) => state.hasFullText(paper) && !["include", "exclude"].includes(second.settled[paper.id]!.result));
  const boxes: Array<{ title: string; n: number; side?: Array<{ label: string; n: number }> }> = [
    { title: "Records identified", n: found, side: screening.sources.map((source) => ({ label: source.name, n: taken(source) })) },
    { title: "Records screened on title and abstract", n: kept, side: [{ label: "Duplicates removed before screening", n: found - kept }] },
    { title: screening.fullText ? "Reports sought for full text" : "Studies included", n: screening.fullText ? second.papers.length : first.counts.include, side: [...reasons(first), ...(first.counts.conflict + first.counts.waiting ? [{ label: "Still open: in conflict or waiting for votes", n: first.counts.conflict + first.counts.waiting }] : [])] },
    ...(screening.fullText
      ? [
          { title: "Reports assessed at full text", n: second.papers.length - noText, side: [{ label: "Reports not retrieved", n: noText }] },
          { title: "Studies included", n: second.counts.include, side: [...reasons(second).filter((one) => !/not retrieved/i.test(one.label)), ...(openAtFullText ? [{ label: "Still open: maybe, in conflict or waiting for votes", n: openAtFullText }] : [])] },
        ]
      : []),
  ];
  const svg = () => {
    const [w, bh, gap] = [760, 64, 34];
    const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const body = boxes.map((box, i) => {
      const y = 20 + i * (bh + gap);
      const side = (box.side ?? []).map((one, n) => `<text x="410" y="${y + 18 + n * 15}" font-size="11" fill="#444">${esc(one.label.length > 52 ? `${one.label.slice(0, 50)}…` : one.label)} (n = ${one.n})</text>`).join("");
      const arrow = i < boxes.length - 1 ? `<path d="M190 ${y + bh} v${gap - 6}" stroke="#666" fill="none" marker-end="url(#a)"/>` : "";
      return `<rect x="20" y="${y}" width="340" height="${bh}" rx="8" fill="#fff" stroke="#999"/><text x="36" y="${y + 26}" font-size="13" font-weight="600" fill="#111">${esc(box.title)}</text><text x="36" y="${y + 46}" font-size="12" fill="#333">n = ${box.n}</text>${box.side?.length ? `<path d="M360 ${y + bh / 2} h34" stroke="#666" marker-end="url(#a)"/>` : ""}${side}${arrow}`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${40 + boxes.length * (bh + gap)}" font-family="sans-serif"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#666"/></marker></defs>${body}</svg>`;
  };

  // The same diagram as a picture, drawn from the drawing: what a word processor takes.
  const png = () => {
    const image = new Image();
    image.onload = () => {
      const canvas = Object.assign(document.createElement("canvas"), { width: image.width * 2, height: image.height * 2 });
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `${slug(screening.name)}-flow.png`;
      link.click();
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg())}`;
  };
  const people = peopleOf(screening);
  const models = modelsOf(screening);
  const pair = people.length > 1 ? agreement(people[0]!.id, people[1]!.id, first) : null;
  // Who read each record, said the way a methods section says it.
  const each = screening.rule.each === "all" ? people.length : Math.min(Number(screening.rule.each), people.length);
  const readers = !people.length ? "" : each >= people.length ? (people.length === 1 ? `One human reviewer (${people[0]!.name})` : people.length === 2 ? `Both human reviewers (${people.map((p) => p.name).join(" and ")})` : `All ${people.length} human reviewers (${people.map((p) => p.name).join(", ")})`) : `${each === 1 ? "One" : "Two"} of the ${people.length} human reviewers (${people.map((p) => p.name).join(", ")})`;
  const unread = count(first.papers, (paper) => first.votes[paper.id]!.some((one) => one.failed));
  const openNow = first.counts.conflict + first.counts.waiting + (screening.fullText ? openAtFullText : 0);
  const fullPair = people.length > 1 && screening.fullText ? agreement(people[0]!.id, people[1]!.id, second) : null;
  const excludedAtFullText = count(second.papers, (paper) => second.settled[paper.id]!.final === "exclude" && state.hasFullText(paper));
  const methods = [
    openNow ? `Screening was still in progress when this was written: ${(first.papers.length - first.counts.conflict - first.counts.waiting).toLocaleString("en-GB")} of ${first.papers.length.toLocaleString("en-GB")} records had been settled on title and abstract.` : "",
    `Records from ${screening.sources.length} ${screening.sources.length === 1 ? "source" : "sources"} (n = ${found}) were brought into Openscholar. After ${found - kept} duplicates were merged, ${kept} were screened.`,
    screening.criteria.length ? `Each record was assessed on its title and abstract against ${screening.criteria.length} ${screening.criteria.length === 1 ? "criterion" : "criteria"}, ${screening.criteria.filter((c) => c.must).length} of which a record had to meet to be included.` : "Each record was assessed on its title and abstract.",
    readers ? `${readers} voted on each record${screening.rule.blind === "after" ? " without seeing the other votes" : ""}.` : "No human reviewer voted on the records.",
    models.length ? `${models.length === 1 ? "One AI model" : `${models.length} AI models`} (${models.map((m) => m.name).join(", ")}) voted on the records as ${models.length === 1 ? "an additional reviewer" : "additional reviewers"}, giving an answer and a quoted passage for every criterion${unread ? `; ${unread} ${unread === 1 ? "record" : "records"} could not be read by a model and ${unread === 1 ? "was" : "were"} decided by the other reviewers` : ""}.` : "No AI model took part.",
    screening.rule.settle === "all" ? `A record was settled when all of its reviewers agreed, and disagreements went to ${personOf(screening.rule.resolver)?.name ?? "a named reviewer"}${first.counts.conflict ? `; ${first.counts.conflict} ${first.counts.conflict === 1 ? "was" : "were"} still open` : ""}.` : screening.rule.settle === "most" ? `A record was settled by the majority of its reviewers, and ties went to ${personOf(screening.rule.resolver)?.name ?? "a named reviewer"}.` : "The first vote on a record settled it.",
    pair ? `Agreement between ${people[0]!.name} and ${people[1]!.name} over the ${pair.papers} records both assessed was ${Math.round(pair.same * 100)}% (Cohen's kappa ${pair.kappa.toFixed(2)}).` : "",
    screening.fullText ? `${second.papers.length} records went on to full text${noText ? `, of which ${noText} could not be retrieved` : ""}. Of the ${second.papers.length - noText} assessed, ${excludedAtFullText} were excluded and ${second.counts.include} studies were included${openAtFullText ? `, with ${openAtFullText} still to be decided` : ""}.` : `${first.counts.include} studies were included.`,
    fullPair ? `At full text, agreement between ${people[0]!.name} and ${people[1]!.name} was ${Math.round(fullPair.same * 100)}% (Cohen's kappa ${fullPair.kappa.toFixed(2)}).` : "",
  ].filter(Boolean).join(" ");

  const shown = rows.slice((page - 1) * VOTES_PAGE, page * VOTES_PAGE);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[min(44rem,90dvh)] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="space-y-3 border-b border-border-subtle p-5">
          <DialogTitle>Export</DialogTitle>
          <DialogDescription className="sr-only">Every vote, the flow of papers, and a paragraph for the methods section</DialogDescription>
          <Segmented label="What to export" value={tab} onChange={setTab} options={[{ id: "papers", label: "Included papers" }, { id: "votes", label: "Every vote" }, { id: "flow", label: "Flow diagram" }, { id: "methods", label: "Methods paragraph" }]} />
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {/* What is taken out now is what stands now: it says so while papers are still open. */}
          {last.counts.conflict + last.counts.waiting > 0 && !screening.finishedAt ? (
            <p className="flex items-start gap-2.5 rounded-2xl bg-warning/10 px-3.5 py-2.5 text-sm ink-warning">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>This screening isn&apos;t finished: {(last.counts.conflict + last.counts.waiting).toLocaleString("en-GB")} {last.counts.conflict + last.counts.waiting === 1 ? "paper is" : "papers are"} still waiting for votes or in conflict, so what you export now is part of the result.</span>
            </p>
          ) : null}
          {tab === "papers" ? (
            included.length ? (
              <ul className={LIST}>
                {included.slice(0, 8).map((paper) => (
                  <li key={paper.id} className="px-4 py-2.5">
                    <p className="truncate text-sm font-medium">{paper.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{paper.authors.join(", ")}, {paper.year}, {paper.venue}</p>
                  </li>
                ))}
                {included.length > 8 ? <li className="px-4 py-2.5 text-xs text-muted-foreground">and {included.length - 8} more</li> : null}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">No paper is included yet. The list fills as papers settle.</p>
            )
          ) : tab === "votes" ? (
            <div className="space-y-3">
              <div className={LIST} style={{ minHeight: VOTES_PAGE * 49 }}>
                {shown.map((row, i) => (
                  <div key={i} className="grid h-12 grid-cols-[minmax(0,1fr)_9rem_1.5rem_7rem] items-center gap-3 px-4 text-sm">
                    <span className="min-w-0"><span className="block truncate">{row.paper.title}</span>{row.vote.note ? <span className="block truncate text-xs text-muted-foreground">“{row.vote.note}”</span> : null}</span>
                    <span className="flex min-w-0 items-center gap-2"><ReviewerMark reviewer={row.reviewer} className="size-5" /><span className="truncate text-xs">{row.reviewer.name}</span></span>
                    <VoteMark vote={row.vote} who={row.reviewer.name} />
                    <span className="truncate text-xs text-muted-foreground">{STAGE_LABEL[row.stage as "abstract" | "fullText"]}</span>
                  </div>
                ))}
              </div>
              <CommandCenterPagination className="pt-0" currentPage={page} totalPages={Math.max(1, Math.ceil(rows.length / VOTES_PAGE))} onPageChange={setPage} totalItems={rows.length} itemsPerPage={VOTES_PAGE} itemLabel="votes" />
            </div>
          ) : tab === "flow" ? (
            <ol className="space-y-2">
              {boxes.map((box) => (
                <li key={box.title} className="grid gap-x-6 gap-y-2 rounded-2xl border border-border-subtle p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                  <div>
                    <p className="text-sm font-medium">{box.title}</p>
                    <p className="text-2xl font-semibold tabular-nums tracking-tight">{box.n.toLocaleString("en-GB")}</p>
                  </div>
                  <ul className="space-y-1 self-center">
                    {(box.side ?? []).map((one) => (
                      <li key={one.label} className="flex items-baseline justify-between gap-3 text-xs"><span className="truncate text-muted-foreground">{one.label}</span><span className="shrink-0 font-medium tabular-nums">{one.n.toLocaleString("en-GB")}</span></li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-2xl border border-border-subtle p-4 text-sm leading-6">{methods}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle p-4">
          <p className="text-xs text-muted-foreground">
            {tab === "papers" ? `${included.length.toLocaleString("en-GB")} ${included.length === 1 ? "paper" : "papers"} included at ${screening.fullText ? "full text" : "title and abstract"}, for a reference manager` : tab === "votes" ? `${rows.length.toLocaleString("en-GB")} ${rows.length === 1 ? "vote" : "votes"} by ${new Set(rows.map((row) => row.reviewer.id)).size} of ${reviewers.length} reviewers, one row each` : tab === "flow" ? "The counts a PRISMA 2020 flow diagram is drawn from" : "Written from this screening's own record"}
          </p>
          <div className="flex gap-2">
            {(tab === "papers"
              ? [
                  { key: "bib", label: "BibTeX", run: () => save(`${slug(screening.name)}-included.bib`, "application/x-bibtex", bib()), off: !included.length },
                  { key: "ris", label: "RIS", run: () => save(`${slug(screening.name)}-included.ris`, "application/x-research-info-systems", ris()), off: !included.length },
                ]
              : tab === "votes"
                ? [
                    { key: "json", label: "JSON", run: () => save(`${slug(screening.name)}-votes.json`, "application/json", JSON.stringify(rows.map((row) => ({ stage: row.stage, paper: row.paper.title, reviewer: row.reviewer.name, kind: row.reviewer.kind, ...row.vote, result: row.result })), null, 2)), off: !rows.length },
                    { key: "csv", label: "CSV, for a spreadsheet", run: () => save(`${slug(screening.name)}-votes.csv`, "text/csv", csv()), off: !rows.length },
                  ]
                : tab === "flow"
                  ? [
                      { key: "svg", label: "Drawing to edit (SVG)", run: () => save(`${slug(screening.name)}-flow.svg`, "image/svg+xml", svg()), off: false },
                      { key: "png", label: "Picture for a document (PNG)", run: png, off: false },
                    ]
                  : [{ key: "copy", label: "Copy", run: () => void navigator.clipboard.writeText(methods), off: false }]
            ).map((button, i, all) => (
              <Button key={button.key} size="sm" variant={i === all.length - 1 ? "default" : "outline"} disabled={button.off} onClick={() => { button.run(); setDone(button.key); }}>
                {done === button.key ? <Check /> : button.key === "copy" ? <Copy /> : <Download />}
                {done === button.key ? (button.key === "copy" ? "Copied" : "Saved to your downloads") : button.label}
              </Button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type { Result };
