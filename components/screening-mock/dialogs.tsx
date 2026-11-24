"use client";

// What opens over an open screening: its activity, and what can be taken out of it.

import { useState } from "react";
import { Check, Clock, Copy, Download, Info, X } from "@/components/icons";
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
import { DECISION_LABEL, EVERY_LABEL, NOW, PEOPLE, RESULT_LABEL, SCHEDULE, WORKSPACES, day, activeReviewers, agreement, ago, count, invitedReviewer, keptOf, modelsOf, peopleOf, personOf, personReviewer, failedLabel, reasonOf, taken, workspaceOf, type Paper, type Result, type Reviewer, type Screening, lookOf, growing } from "./data";
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

const DECISIONS_PAGE = 8;

/**
 * What has happened in the screening, newest first: every change to it, with who made it and what
 * it did, and your own decisions, each of which opens its paper.
 */
export function ActivitySheet({ open, onClose, state, onPaper }: { open: boolean; onClose: () => void; state: Open; onPaper: (paper: string) => void }) {
  const { screening } = state;
  const [tab, setTab] = useState<"changes" | "mine">("changes");
  const [page, setPage] = useState(1);
  const changes = [...screening.changes].reverse();
  const mine = state.papers
    .flatMap((paper) => { const vote = state.votes[paper.id]!.find((one) => one.reviewer.id === state.me)?.vote; return vote ? [{ paper, vote }] : []; })
    .sort((a, b) => b.vote.at - a.vote.at);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className={`flex w-full flex-col gap-0 p-0 sm:max-w-md ${AVATARS_FADE_IN}`}>
        <SheetHeader className="space-y-3 border-b border-border-subtle p-5">
          <SheetTitle>Activity</SheetTitle>
          <SheetDescription className="sr-only">Every change to this screening, and your own decisions</SheetDescription>
          {state.isReviewer ? <Segmented label="What to show" value={tab} onChange={(next) => { setTab(next); setPage(1); }} options={[{ id: "changes" as const, label: "Changes to it" }, { id: "mine" as const, label: "Your decisions", detail: <span className="tabular-nums text-muted-foreground">{mine.length}</span> }]} /> : null}
        </SheetHeader>
        {tab === "mine" ? (
          <>
            <ol className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto">
              {mine.slice((page - 1) * DECISIONS_PAGE, page * DECISIONS_PAGE).map(({ paper, vote }) => (
                <li key={paper.id}>
                  <button type="button" onClick={() => { onPaper(paper.id); onClose(); }} className="flex w-full items-start gap-3 px-5 py-3 text-start transition-colors hover:bg-muted">
                    <VoteMark vote={vote} who="You" />
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="line-clamp-2 text-sm font-medium">{paper.title}</span>
                      <span className="block text-xs text-muted-foreground">{DECISION_LABEL[vote.decision]}{vote.reason ? `, ${failedLabel(vote.reason, screening.criteria)}` : ""}</span>
                      <span className="flex flex-wrap gap-1.5 pt-0.5"><Chip className="h-5 px-1.5">{ago(vote.at)}</Chip></span>
                    </span>
                  </button>
                </li>
              ))}
              {!mine.length ? <li className="px-5 py-10 text-center text-sm text-muted-foreground">You haven&apos;t decided on a paper here yet.</li> : null}
            </ol>
            {mine.length > DECISIONS_PAGE ? <CommandCenterPagination className="border-t border-border-subtle p-4" currentPage={page} totalPages={Math.ceil(mine.length / DECISIONS_PAGE)} onPageChange={setPage} totalItems={mine.length} itemsPerPage={DECISIONS_PAGE} itemLabel="decisions" /> : null}
          </>
        ) : (
          <ol className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto">
            {changes.map((change, i) => {
              const person = personOf(change.by);
              return (
                <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                  {change.by === SCHEDULE ? <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Clock className="size-3.5" /></span> : <IdentityAvatar name={person?.name ?? change.by} imageUrl={person?.imageUrl} className="size-7" />}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm"><span className="font-medium">{change.by === SCHEDULE ? "Scheduled check" : (person?.name ?? change.by)}</span> <span className="text-muted-foreground">{ago(change.at)}</span></p>
                    <p className="text-sm">{change.what}</p>
                    {change.effect ? <p className="text-xs text-muted-foreground">{change.effect}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
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
  const detail = (one: Reviewer) => (one.id === screening.createdBy ? "Started it" : one.email ? "Invited by email, joins when they accept" : one.addedAt > NOW ? "Told by email just now, with a link" : personOf(one.id)?.guest ? "From outside this workspace" : `In ${workspace.name}`);
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
            { key: "workspace", avatar: <WorkspaceTile workspace={lookOf(workspace, screening.createdBy)} size="row" />, name: workspace.name, detail: workspace.members, role: { kind: "member", label: "See it and can change it" } },
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
                <WorkspaceTile workspace={lookOf(one)} size="row" className="self-start" />
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
  // Which included papers: the screening's, or your own. Unset, it is whichever has some.
  const [picked, setPicked] = useState<"settled" | "mine" | null>(null);
  const { screening, papers, votes, settled, counts } = state;
  const reviewers = activeReviewers(screening);

  // One row per reviewer per paper: the complete record.
  const rows = papers.flatMap((paper) => votes[paper.id]!.flatMap(({ reviewer, vote }) => (vote ? [{ paper, reviewer, vote, result: settled[paper.id]!.result }] : [])));
  const csv = () =>
    [
      ["paper", "year", "reviewer", "reviewer_kind", "decision", "reason", ...screening.criteria.map((c) => c.short), "note", "paper_result", "voted_at"],
      ...rows.map((row) => [
        row.paper.title, row.paper.year, row.reviewer.name, row.reviewer.kind, DECISION_LABEL[row.vote.decision],
        row.vote.reason ? failedLabel(row.vote.reason, screening.criteria) : "", ...screening.criteria.map((c) => row.vote.answers[c.key] ?? ""), row.vote.note ?? "", RESULT_LABEL[row.result], new Date(row.vote.at).toISOString(),
      ]),
    ].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");

  const found = screening.sources.reduce((sum, source) => sum + taken(source), 0);
  const kept = screening.sources.reduce((sum, source) => sum + keptOf(source), 0);
  // The times its sources were looked in again, and what those looks found.
  const looks = screening.updates ?? [];
  const later = looks.reduce((sum, look) => sum + look.found, 0);
  const tally = new Map<string, number>();
  for (const paper of papers) if (settled[paper.id]!.final === "exclude") { const key = reasonOf(votes[paper.id]!, settled[paper.id]) ?? "other"; tally.set(key, (tally.get(key) ?? 0) + 1); }
  const reasons = [...tally].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ label: `Excluded, ${failedLabel(key, screening.criteria).replace(/^Not met/, "not met")}`, n }));
  // What a researcher takes away: the papers settled as included.
  const settledIn: Paper[] = papers.filter((paper) => settled[paper.id]!.final === "include");
  // Your own includes: there before the others have voted too.
  const mine: Paper[] = papers.filter((paper) => state.myVote(paper)?.decision === "include");
  const which = picked ?? (settledIn.length || !mine.length ? "settled" : "mine");
  const included = which === "mine" ? mine : settledIn;
  const ris = () => included.map((paper) => ["TY  - JOUR", `TI  - ${paper.title}`, ...paper.authors.filter((a) => a !== "and others").map((a) => `AU  - ${a}`), `PY  - ${paper.year}`, `JO  - ${paper.venue}`, ...(paper.sentences.length ? [`AB  - ${paper.sentences.join(" ")}`] : []), "ER  - "].join("\n")).join("\n\n");
  const bib = () => included.map((paper, i) => `@article{${paper.authors[0]!.split(" ").pop()!.toLowerCase()}${paper.year}${String.fromCharCode(97 + (i % 26))},\n  title = {${paper.title}},\n  author = {${paper.authors.filter((a) => a !== "and others").join(" and ")}},\n  year = {${paper.year}},\n  journal = {${paper.venue}}\n}`).join("\n\n");
  // Papers still on their way from its sources wait for votes like the rest, so the counts add up while they arrive.
  const openNow = counts.conflict + counts.waiting + (kept - papers.length);
  const boxes: Array<{ title: string; n: number; side?: Array<{ label: string; n: number }> }> = [
    { title: "Records identified", n: found, side: later ? [{ label: "When screening began", n: found - later }, { label: `By ${looks.length} later ${looks.length === 1 ? "search" : "searches"}, the last on ${day(looks.at(-1)!.at)}`, n: later }, ...screening.sources.map((source) => ({ label: source.name, n: taken(source) }))] : screening.sources.map((source) => ({ label: source.name, n: taken(source) })) },
    { title: "Records screened on title and abstract", n: kept, side: [{ label: "Duplicates removed before screening", n: found - kept }] },
    { title: "Studies included", n: counts.include, side: [...reasons, ...(counts.maybe ? [{ label: "Left as maybe", n: counts.maybe }] : []), ...(openNow ? [{ label: "Still open: in conflict or waiting for votes", n: openNow }] : [])] },
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
    // A box with many reasons beside it runs below its own row: the drawing is as tall as the lowest line.
    const lowest = Math.max(...boxes.map((box, i) => 20 + i * (bh + gap) + 18 + (box.side?.length ?? 0) * 15));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.max(40 + boxes.length * (bh + gap), lowest + 10)}" font-family="sans-serif"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#666"/></marker></defs>${body}</svg>`;
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
  const pair = people.length > 1 ? agreement(people[0]!.id, people[1]!.id, state) : null;
  // Who read each record, said the way a methods section says it.
  const each = screening.rule.each === "all" ? people.length : Math.min(Number(screening.rule.each), people.length);
  const readers = !people.length ? "" : each >= people.length ? (people.length === 1 ? `One human reviewer (${people[0]!.name})` : people.length === 2 ? `Both human reviewers (${people.map((p) => p.name).join(" and ")})` : `All ${people.length} human reviewers (${people.map((p) => p.name).join(", ")})`) : `${each === 1 ? "One" : "Two"} of the ${people.length} human reviewers (${people.map((p) => p.name).join(", ")})`;
  const unread = count(papers, (paper) => votes[paper.id]!.some((one) => one.failed));
  const n = (count: number, one: string, many: string) => `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
  // How far every pair of reviewers agreed, people and models: the lowest and the highest kappa.
  const kappas = reviewers.flatMap((a, i) => reviewers.slice(i + 1).flatMap((b) => agreement(a.id, b.id, state)?.kappa ?? [])).sort((a, b) => a - b);
  const lateCriteria = screening.criteria.filter((criterion) => criterion.addedAt > screening.createdAt);
  const methods = [
    openNow ? `Screening was still in progress when this was written: ${(kept - openNow).toLocaleString("en-GB")} of ${kept.toLocaleString("en-GB")} records had been settled.` : "",
    `Records from ${screening.sources.length} ${screening.sources.length === 1 ? "source" : "sources"} (n = ${found}) were brought into Openscholar. After ${found - kept} duplicates were merged, ${kept} were screened.`,
    looks.length ? `${growing(screening).length === screening.sources.length ? "The sources were" : `The ${growing(screening).length} of the ${screening.sources.length} sources that gain records over time (${growing(screening).map((source) => source.name).join("; ")}) were`} searched again ${screening.living ? `${EVERY_LABEL[screening.living.every].toLowerCase()}, ` : ""}${looks.length === 1 ? "once" : `${looks.length} times`} after screening began, most recently on ${day(looks.at(-1)!.at)}; ${later ? `${later} of the records identified came from ${looks.length === 1 ? "that search" : "those searches"}` : "no further records were found"}.` : "",
    screening.criteria.length ? `Each record was assessed on its title and abstract against ${screening.criteria.length} ${screening.criteria.length === 1 ? "criterion" : "criteria"}, ${screening.criteria.filter((c) => c.must).length} of which a record had to meet to be included.` : "Each record was assessed on its title and abstract.",
    readers ? `${readers} voted on each record${screening.rule.blind === "after" ? " without seeing the other votes" : ""}.` : "No human reviewer voted on the records.",
    models.length ? `${models.length === 1 ? "One AI model" : `${models.length} AI models`} (${models.map((m) => m.name).join(", ")}) voted on the records as ${models.length === 1 ? "an additional reviewer" : "additional reviewers"}, giving an answer and a quoted passage for every criterion${unread ? `; ${unread} ${unread === 1 ? "record" : "records"} could not be read by a model and ${unread === 1 ? "was" : "were"} decided by the other reviewers` : ""}.` : "No AI model took part.",
    screening.rule.settle === "all" ? `A record was settled when all of its reviewers agreed, and disagreements went to ${personOf(screening.rule.resolver)?.name ?? "a named reviewer"}${counts.conflict ? `; ${counts.conflict} ${counts.conflict === 1 ? "was" : "were"} still open` : ""}.` : screening.rule.settle === "most" ? `A record was settled by the majority of its reviewers, and ties went to ${personOf(screening.rule.resolver)?.name ?? "a named reviewer"}.` : "The first vote on a record settled it.",
    lateCriteria.length ? `${lateCriteria.length === 1 ? "One criterion was" : `${lateCriteria.length} criteria were`} added after screening began: the votes people had cast were kept, the models answered ${lateCriteria.length === 1 ? "it" : "them"} on every record, and records where that changed the outcome went to ${personOf(screening.rule.resolver)?.name ?? "the named reviewer"}.` : "",
    pair ? `Agreement between ${people[0]!.name} and ${people[1]!.name} over the ${pair.papers} records both assessed was ${Math.round(pair.same * 100)}% (Cohen's kappa ${pair.kappa.toFixed(2)}).` : "",
    kappas.length > 1 ? `Across all ${reviewers.length} reviewers, pairwise agreement (Cohen's kappa) ranged from ${kappas[0]!.toFixed(2)} to ${kappas.at(-1)!.toFixed(2)}.` : "",
    `${n(counts.include, "study was", "studies were")} included.`,
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
          {openNow && !screening.finishedAt ? (
            <p className="flex items-start gap-2.5 rounded-2xl bg-warning/10 px-3.5 py-2.5 text-sm ink-warning">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>This screening isn&apos;t finished: {openNow.toLocaleString("en-GB")} {openNow === 1 ? "paper is" : "papers are"} still waiting for votes or in conflict, so what you export now is part of the result.</span>
            </p>
          ) : null}
          {tab === "papers" && mine.length ? (
            <Segmented label="Which papers" value={which} onChange={(next) => { setDone(null); setPicked(next); }} options={[{ id: "settled" as const, label: "Settled as included", detail: <span className="tabular-nums text-muted-foreground">{settledIn.length}</span> }, { id: "mine" as const, label: "You voted to include", detail: <span className="tabular-nums text-muted-foreground">{mine.length}</span> }]} />
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
              <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{which === "mine" ? "You haven't voted to include a paper yet." : "No paper is settled as included yet. A paper settles once its reviewers have voted."}</p>
            )
          ) : tab === "votes" ? (
            <div className="space-y-3">
              <div className={LIST} style={{ minHeight: VOTES_PAGE * 49 }}>
                {shown.map((row, i) => (
                  <div key={i} className="grid h-12 grid-cols-[minmax(0,1fr)_9rem_1.5rem] items-center gap-3 px-4 text-sm">
                    <span className="min-w-0"><span className="block truncate">{row.paper.title}</span>{row.vote.note ? <span className="block truncate text-xs text-muted-foreground">“{row.vote.note}”</span> : null}</span>
                    <span className="flex min-w-0 items-center gap-2"><ReviewerMark reviewer={row.reviewer} className="size-5" /><span className="truncate text-xs">{row.reviewer.name}</span></span>
                    <VoteMark vote={row.vote} who={row.reviewer.name} />
                  </div>
                ))}
              </div>
              <CommandCenterPagination className="pt-0" currentPage={page} totalPages={Math.max(1, Math.ceil(rows.length / VOTES_PAGE))} onPageChange={setPage} totalItems={rows.length} itemsPerPage={VOTES_PAGE} itemLabel="votes" />
            </div>
          ) : tab === "flow" ? (
            // The drawing itself, as it will be saved: what you see is what your co-author gets.
            <img alt={`Flow diagram: ${boxes.map((box) => `${box.title}, ${box.n}`).join("; ")}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg())}`} className="w-full rounded-2xl border border-border-subtle bg-white" />
          ) : (
            <p className="rounded-2xl border border-border-subtle p-4 text-sm leading-6">{methods}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle p-4">
          <p className="text-xs text-muted-foreground">
            {tab === "papers" ? `${included.length.toLocaleString("en-GB")} ${included.length === 1 ? "paper" : "papers"} included, for a reference manager` : tab === "votes" ? `${rows.length.toLocaleString("en-GB")} ${rows.length === 1 ? "vote" : "votes"} by ${new Set(rows.map((row) => row.reviewer.id)).size} of ${reviewers.length} reviewers, one row each` : tab === "flow" ? "The counts a PRISMA 2020 flow diagram is drawn from" : "Written from this screening's own record"}
          </p>
          <div className="flex gap-2">
            {(tab === "papers"
              ? [
                  { key: "bib", label: "BibTeX", run: () => save(`${slug(screening.name)}-included.bib`, "application/x-bibtex", bib()), off: !included.length },
                  { key: "ris", label: "RIS", run: () => save(`${slug(screening.name)}-included.ris`, "application/x-research-info-systems", ris()), off: !included.length },
                ]
              : tab === "votes"
                ? [
                    { key: "json", label: "JSON", run: () => save(`${slug(screening.name)}-votes.json`, "application/json", JSON.stringify(rows.map((row) => ({ paper: row.paper.title, reviewer: row.reviewer.name, kind: row.reviewer.kind, ...row.vote, result: row.result })), null, 2)), off: !rows.length },
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
