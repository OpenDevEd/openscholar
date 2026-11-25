"use client";

// What opens over an open screening: its activity, who has it, where it lives, and what can be taken out of it.
// Every row that names a paper, a check, a setting or a person opens it, and closes what it is in on the way.

import { useState } from "react";
import NextLink from "next/link";
import { ArrowRight, Check, ChevronRight, Clock, Copy, Download, Info, Lock, X } from "@/components/icons";
import { IconButton } from "@/components/assistant/parts";
import { Chip } from "@/components/screening/parts";
import { PickMark } from "@/components/screening/source-row";
import { SharePanel, type ShareRole } from "@/components/shared/share-panel";
import { WorkspaceTile } from "@/components/workspaces/parts";
import { LIST, Segmented } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { HelpFact } from "@/components/ui/help";
import { ROLE_ICONS } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DECISION_LABEL, EVERY_LABEL, NOW, PEOPLE, RESULT_LABEL, SCHEDULE, WORKSPACES, day, activeReviewers, agreement, ago, count, invitedReviewer, keptOf, modelsOf, peopleOf, personOf, personReviewer, failedLabel, questionOf, reasonOf, taken, workspaceOf, type Change, type Paper, type Result, type Reviewer, type Screening, lookOf, growing } from "./data";
import { EffectList } from "./effects";
import { overviewHref, papersHref, settingsHref } from "./links";
import { Help, LinkChip, Panel, QuestionName, Reason, ResultChip, ReviewerMark, ReviewerName, Section, VoteMark } from "./parts";
import { credits, type Open } from "./store";

const save = (name: string, type: string, text: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
};
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Where a change in the activity opens: the papers a check brought, the setting it changed, or the reviewers.
 * ponytail: matched on the words each change is logged with. A field on Change, set where the change is logged, is the upgrade.
 */
function opensOf(change: Change, screening: Screening): string | undefined {
  const { id } = screening;
  if (screening.updates?.some((check) => check.at === change.at && check.added > 0)) return papersHref(id, { added: String(change.at) });
  const what = change.what;
  if (what === "Started the screening") return papersHref(id, { added: "start" });
  if (/criteri|must-have|nice to have/.test(what)) return settingsHref(id, "criteria");
  if (/source/.test(what)) return settingsHref(id, "papers");
  if (/decided/.test(what)) return settingsHref(id, "decided");
  if (/living|looks for new papers|looking for new papers/.test(what)) return settingsHref(id, "new-papers");
  if (/included papers go/.test(what)) return settingsHref(id, "goes-to");
  if (/reviewer|viewer|models|back to|off the screening|reminder/.test(what)) return overviewHref(id, "reviewers");
  if (/Renamed|research question/.test(what)) return settingsHref(id);
  return undefined;
}

/** What has happened in the screening, newest first: every change to it, who made it, and what it did. Each opens what it changed. */
export function ActivitySheet({ open, onClose, state }: { open: boolean; onClose: () => void; state: Open }) {
  const { screening } = state;
  const changes = [...screening.changes].reverse();
  const votes = count(state.papers, (paper) => Boolean(state.myVote(paper)));
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className={`flex w-full flex-col gap-0 p-0 sm:max-w-md ${AVATARS_FADE_IN}`}>
        <SheetHeader className="border-b border-border-subtle p-5">
          <SheetTitle>Activity</SheetTitle>
          <SheetDescription className="sr-only">Every change to this screening, newest first</SheetDescription>
        </SheetHeader>
        <ol className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto">
          {changes.map((change, i) => {
            const person = personOf(change.by);
            const reviewer = screening.reviewers.find((one) => one.id === change.by);
            const href = opensOf(change, screening);
            const body = (
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block text-sm">{change.what}</span>
                {change.effect ? <span className="block text-xs text-muted-foreground">{change.effect}</span> : null}
              </span>
            );
            return (
              <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                {change.by === SCHEDULE ? <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Clock className="size-3.5" /></span> : <IdentityAvatar name={person?.name ?? change.by} imageUrl={person?.imageUrl} className="size-7" />}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex min-h-7 items-center gap-3 text-sm font-medium">
                    {change.by === SCHEDULE ? (
                      "Scheduled check"
                    ) : reviewer ? (
                      <NextLink href={papersHref(screening.id, { reviewer: reviewer.id })} onClick={onClose} className="min-w-0 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                        <ReviewerName reviewer={reviewer} you={reviewer.id === state.me} />
                      </NextLink>
                    ) : (
                      <span className="truncate">{person?.name ?? change.by}</span>
                    )}
                    <span className="ms-auto shrink-0 text-xs font-normal text-muted-foreground">{ago(change.at)}</span>
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
        {votes ? (
          <div className="border-t border-border-subtle p-4">
            <Button asChild variant="outline" className="w-full">
              <NextLink href={papersHref(screening.id, { reviewer: state.me })} onClick={onClose}>
                Your {votes.toLocaleString("en-GB")} {votes === 1 ? "vote" : "votes"}
                <ArrowRight />
              </NextLink>
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

const SHARE_ROLES: Array<ShareRole<"reviewer" | "viewer">> = [
  { id: "reviewer", kind: "edit", label: "Reviewer", can: "Votes on the papers dealt to them" },
  { id: "viewer", kind: "view", label: "Viewer", can: "Sees every paper and vote" },
];

/**
 * Who has a screening: its workspace, whose members all see it, then each person on it and whether
 * they vote. Whoever can change it adds people here as reviewers or as viewers.
 */
export function ShareDialog({ open, onClose, state, onPromote, onDemote }: { open: boolean; onClose: () => void; state: Open; onPromote: (viewer: Reviewer) => void; onDemote: (reviewer: Reviewer) => void }) {
  const { screening } = state;
  const [query, setQuery] = useState("");
  // What the people added from the field become. A reviewer goes through the same question as Add person.
  const [addAs, setAddAs] = useState<"reviewer" | "viewer">("viewer");
  const workspace = workspaceOf(screening);
  const people = peopleOf(screening);
  const viewers = screening.viewers ?? [];
  const on = [...people, ...viewers];
  const words = query.trim().toLowerCase();
  // Someone added in this sitting is told so: the row says how they hear of it.
  const detail = (one: Reviewer) => (one.id === screening.createdBy ? "Started it" : one.email ? "Invited by email, joins when they accept" : one.addedAt > NOW ? "Told by email just now, with a link" : personOf(one.id)?.guest ? "From outside this workspace" : `In ${workspace.name}`);
  const share = (viewer: Reviewer) => state.update((s) => ({ ...s, viewers: [...(s.viewers ?? []), viewer] }), { what: `Shared it with ${viewer.name}`, effect: "They see every paper and every vote, and aren't dealt papers" });
  const add = (one: Reviewer) => (addAs === "reviewer" ? onPromote(one) : share(one));
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className={`top-[max(1rem,12dvh)] flex max-h-[min(40rem,calc(88dvh-1rem))] max-w-lg translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 ${AVATARS_FADE_IN}`}>
        <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex items-center gap-1 text-base">
              Share this screening
              <Help title="Reviewer or viewer" facts={screening.rule.blind === "after" ? <HelpFact icon={Lock}>Votes hidden until you vote</HelpFact> : undefined}>
                A viewer sees every paper and every vote. A reviewer is dealt papers and votes on them.
              </Help>
            </DialogTitle>
            <DialogDescription className="truncate text-xs">{screening.name}</DialogDescription>
          </div>
          <IconButton label="Close" icon={<X className="size-4" />} onClick={onClose} />
        </div>
        {state.canChange ? (
          <div className="flex items-center gap-2 px-4 pt-3">
            <span className="text-xs font-medium text-muted-foreground">Add people as</span>
            <Segmented label="Add people as" value={addAs} onChange={setAddAs} options={SHARE_ROLES.map((role) => ({ id: role.id, label: role.label, icon: ROLE_ICONS[role.kind] }))} />
          </div>
        ) : null}
        <SharePanel
          roles={SHARE_ROLES}
          adding={
            state.canChange
              ? {
                  query,
                  onQuery: setQuery,
                  // Its workspace's members see it already: as viewers, the people to add are the ones outside it.
                  candidates: PEOPLE.filter((person) => !on.some((one) => one.id === person.id) && (addAs === "reviewer" || person.guest) && (!words || person.name.toLowerCase().includes(words)))
                    .sort((a, b) => Number(Boolean(a.guest)) - Number(Boolean(b.guest)))
                    .map((person) => ({ key: person.id, avatar: <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-9" />, name: person.name, detail: person.guest ? "Outside this workspace" : `In ${workspace.name}`, pick: () => add(personReviewer(person, Date.now())) })),
                  invite: (email) => add(invitedReviewer(email, Date.now())),
                  has: (email) => on.some((one) => one.email === email),
                }
              : undefined
          }
          entries={[
            { key: "workspace", avatar: <WorkspaceTile workspace={lookOf(workspace, screening.createdBy)} size="row" />, name: workspace.name, detail: workspace.members, role: { kind: "member", label: "See it and can change it" } },
            ...people.map((one) => ({ key: one.id, avatar: <ReviewerMark reviewer={one} className="size-9" />, name: one.name, you: one.id === state.me, detail: detail(one), role: "reviewer" as const, onRole: state.canChange ? (role: "reviewer" | "viewer") => role === "viewer" && onDemote(one) : undefined })),
            ...viewers.map((one) => ({ key: one.id, avatar: <ReviewerMark reviewer={one} className="size-9" />, name: one.name, you: one.id === state.me, detail: detail(one), role: "viewer" as const, onRole: state.canChange ? (role: "reviewer" | "viewer") => role === "reviewer" && onPromote(one) : undefined, onRemove: state.canChange ? () => state.update((s) => ({ ...s, viewers: s.viewers?.filter((viewer) => viewer.id !== one.id) }), { what: `Stopped sharing it with ${one.name}` }) : undefined })),
          ]}
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
            <p className="text-sm text-muted-foreground">Pick a workspace to see what moving does.</p>
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

/** A box of the flow diagram: its count, and the lines that break the count down. */
type FlowBox = { title: string; n: number; lines?: Array<{ label: string; n: number }> };
/** One stage of the flow: its box, and the boxes beside it for the records that left at that stage. */
type FlowRow = { main: FlowBox; side: FlowBox[] };

/** The flow as a drawing, laid out the way PRISMA 2020 lays it out: stages down the left, what left each stage beside it. */
function flowSvg(rows: FlowRow[]) {
  const [line, gap, sideGap, mainX, mainW, sideX, sideW] = [15, 34, 10, 20, 360, 430, 310];
  const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  const heightOf = (box: FlowBox) => (box.lines?.length ? 57 + box.lines.length * line : 54);
  const draw = (box: FlowBox, x: number, y: number, w: number, max: number) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${heightOf(box)}" rx="8" fill="#fff" stroke="#999"/><text x="${x + 16}" y="${y + 24}" font-size="13" font-weight="600" fill="#111">${esc(box.title)}</text><text x="${x + 16}" y="${y + 42}" font-size="12" fill="#333">n = ${box.n}</text>${(box.lines ?? []).map((one, k) => `<text x="${x + 16}" y="${y + 62 + k * line}" font-size="11" fill="#444">${esc(cut(one.label, max))} (n = ${one.n})</text>`).join("")}`;
  let y = 20;
  const parts = rows.map((row, i) => {
    const mainH = heightOf(row.main);
    const sideH = row.side.reduce((sum, box) => sum + heightOf(box), 0) + Math.max(0, row.side.length - 1) * sideGap;
    const rowH = Math.max(mainH, sideH);
    let sideY = y;
    const side = row.side.map((box) => {
      const drawn = `<path d="M${mainX + mainW} ${y + 24} h25 V${sideY + 24} H${sideX - 2}" stroke="#666" fill="none" marker-end="url(#a)"/>${draw(box, sideX, sideY, sideW, 34)}`;
      sideY += heightOf(box) + sideGap;
      return drawn;
    });
    const down = i < rows.length - 1 ? `<path d="M${mainX + mainW / 2} ${y + mainH} V${y + rowH + gap - 2}" stroke="#666" fill="none" marker-end="url(#a)"/>` : "";
    const drawn = `${draw(row.main, mainX, y, mainW, 42)}${side.join("")}${down}`;
    y += rowH + gap;
    return drawn;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${y - gap + 20}" font-family="sans-serif"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#666"/></marker></defs>${parts.join("")}</svg>`;
}

/** The columns of the votes file, as the sample of it shows them. */
const VOTE_COLUMNS = ["Paper", "Reviewer", "Vote", "Reason", "Note", "Result", "Voted"];

/** The four things a review's report needs from its screening: the included papers, every vote, the flow of papers, and a paragraph for the methods section. */
export function ExportDialog({ open, onClose, state, tab, onTab }: { open: boolean; onClose: () => void; state: Open; tab: ExportTab; onTab: (tab: ExportTab) => void }) {
  // What was last taken out, so its button says so: a download gives no other sign.
  const [done, setDone] = useState<string | null>(null);
  const setTab = (next: ExportTab) => { setDone(null); onTab(next); };
  // Which included papers: the screening's, or your own. Unset, it is whichever has some.
  const [picked, setPicked] = useState<"settled" | "mine" | null>(null);
  const { screening, papers, votes, settled, counts } = state;
  const { id } = screening;
  const reviewers = activeReviewers(screening);

  // One row per reviewer per paper: the complete record.
  const rows = papers.flatMap((paper) => votes[paper.id]!.flatMap(({ reviewer, vote }) => (vote ? [{ paper, reviewer, vote, result: settled[paper.id]!.result }] : [])));
  // The first vote on each of three papers: what the file holds, without a title three times over.
  const sample = rows.filter((row, i) => rows.findIndex((one) => one.paper.id === row.paper.id) === i).slice(0, 3);
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
  // The checks of its sources for new papers, and what those checks found.
  const looks = screening.updates ?? [];
  const later = looks.reduce((sum, look) => sum + look.found, 0);
  const tally = new Map<string, number>();
  for (const paper of papers) if (settled[paper.id]!.final === "exclude") { const key = reasonOf(votes[paper.id]!, settled[paper.id]) ?? "other"; tally.set(key, (tally.get(key) ?? 0) + 1); }
  const reasons = [...tally].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ label: failedLabel(key, screening.criteria), n }));
  // What a researcher takes away: the papers settled as included.
  const settledIn: Paper[] = papers.filter((paper) => settled[paper.id]!.final === "include");
  // Your own includes: there before the others have voted too.
  const mine: Paper[] = papers.filter((paper) => state.myVote(paper)?.decision === "include");
  const which = picked ?? (settledIn.length || !mine.length ? "settled" : "mine");
  const included = which === "mine" ? mine : settledIn;
  const allIncluded = which === "mine" ? papersHref(id, { voted: "include" }) : papersHref(id, { result: "include" });
  const ris = () => included.map((paper) => ["TY  - JOUR", `TI  - ${paper.title}`, ...paper.authors.filter((a) => a !== "and others").map((a) => `AU  - ${a}`), `PY  - ${paper.year}`, `JO  - ${paper.venue}`, ...(paper.sentences.length ? [`AB  - ${paper.sentences.join(" ")}`] : []), "ER  - "].join("\n")).join("\n\n");
  const bib = () => included.map((paper, i) => `@article{${paper.authors[0]!.split(" ").pop()!.toLowerCase()}${paper.year}${String.fromCharCode(97 + (i % 26))},\n  title = {${paper.title}},\n  author = {${paper.authors.filter((a) => a !== "and others").join(" and ")}},\n  year = {${paper.year}},\n  journal = {${paper.venue}}\n}`).join("\n\n");
  // Papers still on their way from its sources wait for votes like the rest, so the counts add up while they arrive.
  const waiting = counts.waiting + (kept - papers.length);
  const openNow = counts.conflict + waiting;
  const flow: FlowRow[] = [
    {
      main: { title: "Records identified", n: found, lines: [...screening.sources.map((source) => ({ label: source.name, n: taken(source) })), ...(later ? [{ label: looks.length === 1 ? `Of these, by the later search on ${day(looks[0]!.at)}` : `Of these, by ${looks.length} later searches, the last on ${day(looks.at(-1)!.at)}`, n: later }] : [])] },
      side: [{ title: "Records removed before screening", n: found - kept, lines: [{ label: "Duplicates", n: found - kept }] }],
    },
    {
      main: { title: "Records screened on title and abstract", n: kept },
      side: [
        { title: "Records excluded", n: counts.exclude, lines: reasons },
        ...(counts.maybe || openNow ? [{ title: "Not yet included or excluded", n: counts.maybe + openNow, lines: [...(counts.maybe ? [{ label: "Left as maybe", n: counts.maybe }] : []), ...(openNow ? [{ label: "Still open", n: openNow }] : [])] }] : []),
      ],
    },
    { main: { title: "Studies included", n: counts.include }, side: [] },
  ];
  const svg = () => flowSvg(flow);

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

  const voters = new Set(rows.map((row) => row.reviewer.id)).size;
  // What the open tab holds, as the title over it, with its "?".
  const heading = {
    papers: {
      title: which === "mine" ? `${n(included.length, "paper", "papers")} you voted Include` : `${n(included.length, "included paper", "included papers")}`,
      help: (
        <Help title="Included papers" facts={<><HelpFact>BibTeX goes into Zotero or JabRef</HelpFact><HelpFact>RIS goes into EndNote or Mendeley</HelpFact></>}>
          The papers with their titles, authors, years and journals, for a reference manager.
        </Help>
      ),
    },
    votes: {
      title: `${n(rows.length, "vote", "votes")} by ${voters} of ${n(reviewers.length, "reviewer", "reviewers")}`,
      help: (
        <Help title="Every vote" facts={<><HelpFact>CSV opens in Excel or Google Sheets</HelpFact><HelpFact>JSON is for code</HelpFact><HelpFact>A column for each criterion</HelpFact></>}>
          One row for each vote a reviewer cast, with its reason, its note, the answer to each criterion and where the paper stands now.
        </Help>
      ),
    },
    flow: {
      title: "PRISMA 2020 flow diagram",
      help: (
        <Help title="PRISMA 2020 flow diagram" facts={<><HelpFact>SVG opens in Inkscape or Illustrator</HelpFact><HelpFact>PNG goes into Word or Google Docs</HelpFact></>}>
          The counts fill PRISMA 2020&apos;s identification and screening boxes, taken from this screening as it stands now.
        </Help>
      ),
    },
    methods: {
      title: "Methods paragraph",
      help: (
        <Help title="Methods paragraph">
          Written from this screening&apos;s sources, criteria, reviewers and votes. It changes as votes come in, so copy it when you are done.
        </Help>
      ),
    },
  }[tab];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Anchored at the top and as tall on every tab, so its tabs never move as they are switched. */}
      <DialogContent className="top-[max(1rem,6dvh)] flex h-[min(44rem,88dvh)] translate-y-0 flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="space-y-3 border-b border-border-subtle p-5">
          <DialogTitle>Export</DialogTitle>
          <DialogDescription className="sr-only">The included papers, every vote, the PRISMA diagram and a methods paragraph</DialogDescription>
          {/* On a phone the four make two rows of two, so none is cut off. */}
          <Segmented label="What to export" value={tab} onChange={setTab} className="max-sm:grid max-sm:grid-cols-2 max-sm:rounded-[1.375rem] max-sm:*:justify-center" options={[{ id: "papers", label: "Included papers" }, { id: "votes", label: "Every vote" }, { id: "flow", label: "PRISMA" }, { id: "methods", label: "Methods paragraph" }]} />
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {/* What is taken out now is what stands now: it says so while papers are still open. */}
          {openNow && !screening.finishedAt ? (
            <Panel tone="warning" className="flex items-start gap-2.5 py-2.5 text-sm">
              <Info className="mt-1 size-4 shrink-0 ink-warning" />
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-medium">Not finished, so this is part of the result</span>
                <span className="flex flex-wrap gap-1.5">
                  {counts.conflict ? <LinkChip href={papersHref(id, { result: "conflict" })} onClick={onClose} tone="info">{counts.conflict.toLocaleString("en-GB")} in conflict</LinkChip> : null}
                  {waiting ? <LinkChip href={papersHref(id, { result: "waiting" })} onClick={onClose}>{waiting.toLocaleString("en-GB")} waiting for votes</LinkChip> : null}
                </span>
              </span>
            </Panel>
          ) : null}
          <Section
            title={heading.title}
            help={heading.help}
            aside={tab === "papers" && mine.length ? <Segmented label="Which papers" value={which} onChange={(next) => { setDone(null); setPicked(next); }} options={[{ id: "settled" as const, label: "Included", detail: <span className="tabular-nums text-muted-foreground">{settledIn.length}</span> }, { id: "mine" as const, label: "You voted Include", detail: <span className="tabular-nums text-muted-foreground">{mine.length}</span> }]} /> : undefined}
          >
            {tab === "papers" ? (
              included.length ? (
                <div className="space-y-3">
                  <ul className={LIST}>
                    {included.slice(0, 8).map((paper) => (
                      <li key={paper.id}>
                        <NextLink href={papersHref(id, { paper: paper.id })} onClick={onClose} className="flex items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{paper.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{paper.authors.join(", ")}, {paper.year}, {paper.venue}</span>
                          </span>
                          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                        </NextLink>
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant="outline" size="sm">
                    <NextLink href={allIncluded} onClick={onClose}>See all {included.length.toLocaleString("en-GB")} in Papers<ArrowRight /></NextLink>
                  </Button>
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{which === "mine" ? "You haven't voted Include on a paper yet." : "No paper is included yet."}</p>
              )
            ) : tab === "votes" ? (
              <div className="space-y-3">
                {/* The file's columns over its first rows: a table may scroll sideways only where it can't fit. */}
                <div className="overflow-x-auto rounded-2xl border border-border-subtle">
                  {/* The paper takes what the other columns leave, and only it and the free text are ever cut. */}
                  <table className="w-full min-w-[60rem] text-sm">
                    <thead className="bg-inset text-xs text-muted-foreground">
                      <tr>{VOTE_COLUMNS.map((column) => <th key={column} scope="col" className="whitespace-nowrap px-3 py-2 text-start font-medium">{column}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {sample.map((row) => (
                        <tr key={`${row.paper.id}:${row.reviewer.id}`}>
                          <td className="w-full max-w-0 px-3 py-2.5"><NextLink href={papersHref(id, { paper: row.paper.id })} onClick={onClose} className="block truncate font-medium hover:underline">{row.paper.title}</NextLink></td>
                          <td className="whitespace-nowrap px-3 text-xs"><NextLink href={papersHref(id, { reviewer: row.reviewer.id })} onClick={onClose} className="flex items-center gap-2 hover:underline"><ReviewerMark reviewer={row.reviewer} className="size-5" /><ReviewerName reviewer={row.reviewer} you={row.reviewer.id === state.me} /></NextLink></td>
                          <td className="whitespace-nowrap px-3"><span className="flex items-center gap-1.5 text-xs"><VoteMark vote={row.vote} who={row.reviewer.name} className="size-5" />{DECISION_LABEL[row.vote.decision]}</span></td>
                          <td className="px-3 text-xs text-muted-foreground">
                            {row.vote.reason ? <QuestionName question={questionOf(row.vote.reason, screening.criteria)} label={failedLabel(row.vote.reason, screening.criteria)} className="flex max-w-40 min-w-0"><Reason reason={row.vote.reason} criteria={screening.criteria} /></QuestionName> : "None"}
                          </td>
                          <td className="px-3 text-xs text-muted-foreground"><span className="block max-w-28 truncate">{row.vote.note ?? "None"}</span></td>
                          <td className="px-3"><ResultChip result={row.result} /></td>
                          <td className="whitespace-nowrap px-3 text-xs text-muted-foreground">{ago(row.vote.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button asChild variant="outline" size="sm">
                  <NextLink href={papersHref(id)} onClick={onClose}>See every vote in Papers<ArrowRight /></NextLink>
                </Button>
              </div>
            ) : tab === "flow" ? (
              // The drawing itself, as it will be saved: what you see is what your co-author gets.
              <img alt={`PRISMA diagram: ${flow.map((row) => `${row.main.title}, ${row.main.n}`).join("; ")}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg())}`} className="w-full rounded-2xl border border-border-subtle bg-white" />
            ) : (
              <p className="rounded-2xl border border-border-subtle p-4 text-sm leading-6">{methods}</p>
            )}
          </Section>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle p-4">
          {(tab === "papers"
            ? [
                { key: "bib", label: "Download BibTeX", run: () => save(`${slug(screening.name)}-included.bib`, "application/x-bibtex", bib()), off: !included.length },
                { key: "ris", label: "Download RIS", run: () => save(`${slug(screening.name)}-included.ris`, "application/x-research-info-systems", ris()), off: !included.length },
              ]
            : tab === "votes"
              ? [
                  { key: "json", label: "Download JSON", run: () => save(`${slug(screening.name)}-votes.json`, "application/json", JSON.stringify(rows.map((row) => ({ paper: row.paper.title, reviewer: row.reviewer.name, kind: row.reviewer.kind, ...row.vote, result: row.result })), null, 2)), off: !rows.length },
                  { key: "csv", label: "Download CSV", run: () => save(`${slug(screening.name)}-votes.csv`, "text/csv", csv()), off: !rows.length },
                ]
              : tab === "flow"
                ? [
                    { key: "svg", label: "Download SVG", run: () => save(`${slug(screening.name)}-flow.svg`, "image/svg+xml", svg()), off: false },
                    { key: "png", label: "Download PNG", run: png, off: false },
                  ]
                : [{ key: "copy", label: "Copy", run: () => void navigator.clipboard.writeText(methods), off: false }]
          ).map((button, i, all) => (
            <Button key={button.key} size="sm" variant={i === all.length - 1 ? "default" : "outline"} disabled={button.off} onClick={() => { button.run(); setDone(button.key); }}>
              {done === button.key ? <Check /> : button.key === "copy" ? <Copy /> : <Download />}
              {done === button.key ? (button.key === "copy" ? "Copied" : "Downloaded") : button.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type { Result };
