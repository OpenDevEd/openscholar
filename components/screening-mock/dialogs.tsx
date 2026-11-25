"use client";

// What opens over an open screening: its activity, who has it, where it lives, and what can be taken out of it.
// Every row that names a paper, a check, a setting or a person opens it, and closes what it is in on the way.

import { useState } from "react";
import NextLink from "next/link";
import { Layers, ArrowRight, Check, ChevronRight, Clock, Copy, Download, Info, X } from "@/components/icons";
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
import { RESULTS, type Result, PERSON_SAYS, num, paperTotal, plural, slug, DECISION_LABEL, NOW, PEOPLE, RESULT_LABEL, SCHEDULE, WORKSPACES, ago, count, invitedReviewer, modelsOf, peopleOf, personOf, personReviewer, failedLabel, questionOf, workspaceOf, type Change, type Paper, type Reviewer, type Screening, lookOf, listed, inOrder, nameOn, votingReviewers } from "./data";
import { EffectList } from "./effects";
import { overviewHref, papersHref, settingsHref } from "./links";
import { FilterMenu, RESULT_STYLE, EmptyNote, Help, Panel, SHUT, ShutNote, QuestionName, Reason, ResultChip, ReviewerMark, ReviewerName, Section, VoteMark, OpenPapersChips, LeftOutNote } from "./parts";
import { bibOf, papersCsv, recordOf, risOf, save, voteRows, votesCsv, type Taken, fileName, flowOf, flowSvg, methodsOf } from "./export";
import { credits, type Open, useMock, walletOf } from "./store";
import { ScrollArea } from "@/components/ui/scroll-area";


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
        <ScrollArea shades className="min-h-0 flex-1">
        <ol className="divide-y divide-border-subtle">
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
        </ScrollArea>
        {votes ? (
          <div className="border-t border-border-subtle p-4">
            <Button asChild variant="outline" className="w-full">
              <NextLink href={papersHref(screening.id, { reviewer: state.me })} onClick={onClose}>
                Your {plural(votes, "vote", "votes")}
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
  { id: "reviewer", kind: "edit", label: "Reviewer", can: "Votes on the papers they get" },
  { id: "viewer", kind: "view", label: "Viewer", can: "Sees every paper and every vote" },
];

/**
 * Who has a screening: its workspace, whose members all see it, then each person on it and whether
 * they vote. Whoever can change it adds people here as reviewers or as viewers.
 */
export function ShareDialog({ open, onClose, state, onPromote, onDemote }: { open: boolean; onClose: () => void; state: Open; onPromote: (viewer: Reviewer) => void; onDemote: (reviewer: Reviewer) => void }) {
  const { screening } = state;
  const [query, setQuery] = useState("");
  // What the people added from the field become. A reviewer goes through the same question as Add a person.
  const [addAs, setAddAs] = useState<"reviewer" | "viewer">("viewer");
  const workspace = workspaceOf(screening);
  const people = peopleOf(screening);
  const viewers = screening.viewers ?? [];
  const on = [...inOrder(people, state.me), ...viewers];
  const words = query.trim().toLowerCase();
  // Someone added in this sitting is told so: the row says how they hear of it.
  const detail = (one: Reviewer, votes = true) => (one.id === screening.createdBy ? "Started it" : one.email ? (votes ? PERSON_SAYS.invited : PERSON_SAYS.invitedToLook) : one.addedAt > NOW ? "Told by email just now, with a link" : personOf(one.id)?.guest ? PERSON_SAYS.guest : PERSON_SAYS.member);
  const share = (viewer: Reviewer) => state.update((s) => ({ ...s, viewers: [...(s.viewers ?? []), viewer] }), { what: `Shared it with ${viewer.name}`, effect: "They see every paper and every vote, and get no papers to vote on" });
  const add = (one: Reviewer) => (addAs === "reviewer" ? onPromote(one) : share(one));
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className={`top-[max(1rem,12dvh)] flex max-h-[min(40rem,calc(88dvh-1rem))] max-w-lg translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 ${AVATARS_FADE_IN}`}>
        <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex items-center gap-1 text-base">
              Share this screening
              <Help title="Reviewer or viewer" facts={screening.rule.blind === "after" ? <HelpFact icon={SHUT.vote.icon}>Votes {SHUT.vote.says.toLowerCase()}</HelpFact> : undefined}>
                A viewer sees every paper and every vote. A reviewer gets papers and votes on them.
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
        ) : (
          // Someone it is shared with from outside sees who is on it. Adding people is said to be the members' to do, where the field would be.
          <div className="px-4 pt-3"><ShutNote by="member">Members of {workspace.name} add people and change what each may do.</ShutNote></div>
        )}
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
                    .map((person) => ({ key: person.id, avatar: <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-9" />, name: person.name, detail: person.guest ? PERSON_SAYS.guest : PERSON_SAYS.member, pick: () => add(personReviewer(person, Date.now())) })),
                  invite: (email) => add(invitedReviewer(email, Date.now())),
                  has: (email) => on.some((one) => one.email === email),
                }
              : undefined
          }
          entries={[
            { key: "workspace", avatar: <WorkspaceTile workspace={lookOf(workspace, screening.createdBy)} size="row" />, name: workspace.name, detail: workspace.members, role: { kind: "member", label: "See it and can change it" } },
            ...people.map((one) => ({ key: one.id, avatar: <ReviewerMark reviewer={one} className="size-9" />, name: one.name, you: one.id === state.me, detail: detail(one), role: "reviewer" as const, onRole: state.canChange ? (role: "reviewer" | "viewer") => role === "viewer" && onDemote(one) : undefined })),
            ...viewers.map((one) => ({ key: one.id, avatar: <ReviewerMark reviewer={one} className="size-9" />, name: one.name, you: one.id === state.me, detail: detail(one, false), role: "viewer" as const, onRole: state.canChange ? (role: "reviewer" | "viewer") => role === "reviewer" && onPromote(one) : undefined, onRemove: state.canChange ? () => state.update((s) => ({ ...s, viewers: s.viewers?.filter((viewer) => viewer.id !== one.id) }), { what: `Stopped sharing it with ${one.name}` }) : undefined })),
          ]}
          onCopy={() => navigator.clipboard.writeText(window.location.href)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Moves a screening to another of your workspaces, saying first what goes with it and who pays for its models from then on. */
export function MoveDialog({ open, onClose, screening, me, onMove }: { open: boolean; onClose: () => void; screening: Screening; me: string; onMove: (workspace: string, what: string) => void }) {
  const store = useMock();
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
                <WorkspaceTile workspace={lookOf(one, me)} size="row" className="self-start" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{one.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{one.members}</span>
                </span>
                <Chip>{credits(walletOf({ workspace: one.id }, store))} credits</Chip>
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

export type ExportTab = "papers" | "votes" | "flow" | "methods" | "record";
/** Which papers the first tab takes out: the ones with one result, every paper, or the person's own includes. */
type Group = Result | "all" | "mine";
const GROUP_FILE: Record<Group, string> = { include: "included", maybe: "maybe", exclude: "excluded", conflict: "in-conflict", waiting: "waiting", all: "all-papers", mine: "my-includes" };

/** The columns of the votes file, as the sample of it shows them. */
const VOTE_COLUMNS = ["Paper", "Reviewer", "Vote", "Reason", "Note", "Result", "Voted"];

/** The four things a review's report needs from its screening: the included papers, every vote, the flow of papers, and a paragraph for the methods section. */
export function ExportDialog({ open, onClose, state, tab, onTab }: { open: boolean; onClose: () => void; state: Open; tab: ExportTab; onTab: (tab: ExportTab) => void }) {
  // What was last taken out, so its button says so: a download gives no other sign.
  const [done, setDone] = useState<string[]>([]);
  const setTab = onTab;
  // Whose votes the votes file holds: everyone's, or one reviewer's.
  const [whose, setWhose] = useState("all");
  // Which papers: unset, the included ones, or the person's own includes where nothing is included yet.
  const [picked, setPicked] = useState<Group | null>(null);
  const { screening, papers, settled, counts } = state;
  const { id } = screening;

  // Every file is built by export.ts, from the screening as it stands and from who takes it out: what is hidden from them on a page is hidden from them in the file.
  const out: Taken = { screening, state, me: state.me };
  const hidden = state.leftOut;
  // The votes that were cast and show: what the tab counts and previews. The file also has a row for a reviewer who has yet to vote and for a model that couldn't read the paper.
  const lines = voteRows(out, papers, whose === "all" ? undefined : whose);
  const rows = lines.flatMap((row) => (row.vote ? [{ ...row, vote: row.vote, result: settled[row.paper.id]!.result }] : []));
  // The first vote on each of three papers: what the file holds, without a title three times over.
  const sample = rows.filter((row, i) => rows.findIndex((one) => one.paper.id === row.paper.id) === i).slice(0, 3);

  const kept = paperTotal(screening.sources);
  // The papers by where they stand.
  const groups = { ...(Object.fromEntries(RESULTS.map((result) => [result, papers.filter((paper) => settled[paper.id]!.result === result)])) as Record<Result, Paper[]>), all: papers, mine: papers.filter((paper) => state.myVote(paper)?.decision === "include") } satisfies Record<Group, Paper[]>;
  const group: Group = picked ?? (groups.include.length || !groups.mine.length ? "include" : "mine");
  const included = groups[group];
  const allIncluded = papersHref(id, group === "mine" ? { voted: "include" } : group === "all" ? {} : { result: group });
  // Papers still on their way from its sources wait for votes like the rest, so the counts add up while they arrive.
  const waiting = counts.waiting + (kept - papers.length);
  const openNow = counts.conflict + waiting;
  const flow = flowOf(out);
  const svg = () => flowSvg(out, NOW);

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
      link.download = fileName(out, "flow", "png", NOW);
      link.click();
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg())}`;
  };
  const methods = methodsOf(out);

  const voters = new Set(rows.map((row) => row.reviewer.id)).size;
  // The places where someone was on a paper and cast no vote: rows of the votes file, and a part of the whole record.
  const locked = count(lines, (row) => row.kept);
  const unvoted = lines.length - rows.length - locked;
  // What the whole record holds is counted from the record itself, so the list can never promise a line the file leaves out.
  const record = tab === "record" ? recordOf(out, NOW) : null;
  // What a file leaves out for this person, said over it: the others' votes on the papers they have yet to vote on.
  const leftOut = <LeftOutNote {...hidden} />;
  // What the open tab holds, as the title over it, with its "?".
  const heading = {
    papers: {
      title: { include: plural(included.length, "included paper", "included papers"), maybe: `${plural(included.length, "paper", "papers")} at Maybe`, exclude: plural(included.length, "excluded paper", "excluded papers"), conflict: `${plural(included.length, "paper", "papers")} in conflict`, waiting: `${plural(included.length, "paper", "papers")} waiting for votes`, all: plural(included.length, "paper", "papers"), mine: `${plural(included.length, "paper", "papers")} you voted Include` }[group],
      help: (
        <Help title="Papers" facts={<><HelpFact>BibTeX goes into Zotero or JabRef</HelpFact><HelpFact>RIS goes into EndNote or Mendeley</HelpFact><HelpFact>CSV opens in Excel or Google Sheets</HelpFact></>}>
          The papers of one result, or every paper. BibTeX and RIS carry each paper&apos;s id here, title, authors, year, journal, DOI and abstract, for a reference manager. The CSV adds where each came from, where it stands, why it was excluded, who settled it, how its reviewers voted and its points: what its reviewers&apos; answers add up to under this screening&apos;s scoring, which ranks included papers and decides nothing.
        </Help>
      ),
    },
    votes: {
      title: `${plural(rows.length, "vote", "votes")} by ${plural(voters, "reviewer", "reviewers")}`,
      help: (
        <Help title="Every vote" facts={<><HelpFact>CSV opens in Excel or Google Sheets</HelpFact><HelpFact>A column for each criterion</HelpFact><HelpFact>Each paper by its id and DOI</HelpFact></>}>
          One row for each reviewer on each paper: their vote with its reason, its note and the answer to each criterion, and where the paper stands now. A reviewer who has yet to vote has a row too, and so has a model that couldn&apos;t read the paper.
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
    record: {
      title: "The whole record",
      help: (
        <Help title="The whole record" facts={<><HelpFact>JSON is for code and for keeping</HelpFact><HelpFact>Ids tie its parts together</HelpFact></>}>
          What a review keeps of its screening, in one file: its rule, its scoring and its criteria as they are asked, its reviewers and who else it is shared with, its sources with what each check found, every paper with where it stands, every vote with the passage a model read, what reviewers wrote to each other, what was changed, and a guide to every column. It leaves out what the screening cost and who is online.
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
          <DialogDescription className="sr-only">The papers, every vote, the PRISMA diagram, a methods paragraph and the whole record</DialogDescription>
          {/* On a phone the five make rows of two, the last across both, so none is cut off. */}
          <Segmented label="What to export" value={tab} onChange={setTab} className="max-sm:grid max-sm:grid-cols-2 max-sm:rounded-[1.375rem] max-sm:*:justify-center max-sm:[&>*:last-child]:col-span-2" options={[{ id: "papers", label: "Papers" }, { id: "votes", label: "Every vote" }, { id: "flow", label: "PRISMA" }, { id: "methods", label: "Methods paragraph" }, { id: "record", label: "Whole record" }]} />
        </DialogHeader>
        <ScrollArea shades className="min-h-0 flex-1">
        <div className="space-y-4 p-5">
          {/* What is taken out now is what stands now: it says so while papers are still open. */}
          {openNow ? (
            <Panel tone="warning" className="flex items-start gap-2.5 py-2.5 text-sm">
              <Info className="mt-1 size-4 shrink-0 ink-warning" />
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-medium">{screening.finishedAt ? "Marked finished with papers still open, so this is part of the result" : "Not finished, so this is part of the result"}</span>
                <OpenPapersChips id={id} conflict={counts.conflict} waiting={waiting} onClick={onClose} />
              </span>
            </Panel>
          ) : null}
          <Section
            title={heading.title}
            help={heading.help}
            aside={tab === "papers" ? (
              <FilterMenu
                name="Which papers"
                value={group}
                onChange={setPicked}
                narrows={false}
                align="end"
                className="h-8 rounded-full px-3.5 text-xs"
                choices={[
                  ...RESULTS.map((result) => ({ value: result as Group, label: RESULT_LABEL[result], icon: (() => { const Icon = RESULT_STYLE[result].icon; return <Icon />; })(), tone: RESULT_STYLE[result].tone, count: groups[result].length })),
                  { value: "all" as Group, label: "Every paper", icon: <Layers />, count: papers.length, group: "All of them" },
                  ...(groups.mine.length ? [{ value: "mine" as Group, label: "You voted Include", icon: <Check />, tone: "success" as const, count: groups.mine.length, group: "Your own" }] : []),
                ]}
              />
            ) : tab === "votes" ? (
              <FilterMenu
                name="Whose votes"
                value={whose}
                onChange={setWhose}
                narrows={false}
                align="end"
                className="h-8 rounded-full px-3.5 text-xs"
                choices={[{ value: "all", label: "Everyone" }, ...inOrder(votingReviewers(screening), state.me).map((reviewer) => ({ value: reviewer.id, label: reviewer.id === state.me ? "You" : reviewer.name, icon: <ReviewerMark reviewer={reviewer} className="size-4" />, group: "One reviewer" }))]}
              />
            ) : undefined}
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
                    <NextLink href={allIncluded} onClick={onClose}>See all {num(included.length)} in Papers<ArrowRight /></NextLink>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3"><EmptyNote>{group === "mine" ? "You haven't voted Include on a paper yet." : group === "all" ? "This screening has no papers yet." : `No paper is ${RESULT_LABEL[group].toLowerCase()} yet.`}</EmptyNote></div>
              )
            ) : tab === "votes" ? (
              <div className="space-y-3">
                {/* One reviewer's own file leaves nothing out: the note counts what these rows keep back. */}
                <LeftOutNote votes={locked} papers={new Set(lines.flatMap((row) => (row.kept ? [row.paper.id] : []))).size} />
                {/* The file's columns over its first rows: a table may scroll sideways only where it can't fit. */}
                <ScrollArea axis="x" shades className="rounded-2xl border border-border-subtle">
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
                </ScrollArea>
                {/* The file holds more rows than there are votes: said here, so its length is no surprise. */}
                <p className="text-xs text-muted-foreground">
                  {sample.length < rows.length ? `These are ${sample.length} of the ${num(rows.length)} votes in the file. ` : ""}
                  {unvoted + locked ? `It has ${plural(unvoted + locked, "more row", "more rows")}, one for each place with no vote to show: ${listed([...(unvoted ? ["a reviewer who has yet to vote or a model that couldn't read the paper"] : []), ...(locked ? ["a vote that is hidden from you"] : [])])}.` : ""}
                </p>
                <Button asChild variant="outline" size="sm">
                  <NextLink href={papersHref(id)} onClick={onClose}>See every vote in Papers<ArrowRight /></NextLink>
                </Button>
              </div>
            ) : tab === "flow" ? (
              // The drawing itself, as it will be saved: what you see is what your co-author gets.
              <img alt={`PRISMA diagram: ${flow.map((row) => `${row.main.title}, ${row.main.n}`).join("; ")}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg())}`} className="w-full rounded-2xl border border-border-subtle bg-white" />
            ) : record ? (
              // What the one file holds, counted: someone who takes it knows what they have before they open it.
              <div className="space-y-3">
                {leftOut}
                <ul className={LIST}>
                  {([
                    ["Papers", record.papers.length, "Each with its DOI, its abstract, where it came from and where it stands"],
                    ["Votes", record.votes.length, "Each with its reason, its note, its answers, and the passage a model read"],
                    ["Without a vote", record.without_a_vote.length, "Who has yet to vote on a paper, and what a model couldn't read"],
                    ["Criteria", record.criteria.length, "As they are asked, with their guidance, and which are must-haves"],
                    ["Reviewers", record.reviewers.length, "People and models, with when each joined or was taken off"],
                    ["Sources", record.sources.length, "What each brought, before and after duplicates"],
                    ["Messages", record.discussion.length, "What reviewers wrote to each other about a paper"],
                    ["Changes", record.activity.length, "The activity log: what was changed, by whom and when"],
                    ["Columns", Object.keys(record.guide.papers).length + Object.keys(record.guide.votes).length, "A guide to what each column of the two CSV files holds"],
                  ] as const).map(([name, count, what]) => (
                    <li key={name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="w-28 shrink-0 font-medium">{name}</span>
                      <span className="w-14 shrink-0 text-end font-semibold tabular-nums">{num(count)}</span>
                      <span className="min-w-0 flex-1 text-muted-foreground">{what}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded-2xl border border-border-subtle p-4 text-sm leading-6">{methods}</p>
            )}
          </Section>
        </div>
        </ScrollArea>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle p-4">
          <p className="me-auto min-w-0 text-xs text-muted-foreground max-sm:basis-full">{{ papers: "BibTeX and RIS go into a reference manager. CSV adds each paper's result, reason and votes.", votes: "One row for each reviewer on each paper. Opens in Excel, Google Sheets or R.", flow: "PNG goes into a document. SVG can be edited.", record: "For keeping, and for code. Opens in any text editor.", methods: "It changes as votes come in: copy it when the screening is done." }[tab]}</p>
          {(tab === "papers"
            ? [
                { key: `papers-csv:${group}`, label: "Download CSV", run: () => save(fileName(out, GROUP_FILE[group], "csv", NOW), "text/csv", papersCsv(out, included)), off: !included.length },
                { key: `bib:${group}`, label: "Download BibTeX", run: () => save(fileName(out, GROUP_FILE[group], "bib", NOW), "application/x-bibtex", bibOf(included, papers)), off: !included.length },
                { key: `ris:${group}`, label: "Download RIS", run: () => save(fileName(out, GROUP_FILE[group], "ris", NOW), "application/x-research-info-systems", risOf(included)), off: !included.length },
              ]
            : tab === "votes"
              ? [{ key: `csv:${whose}`, label: "Download CSV", run: () => save(fileName(out, whose === "all" ? "votes" : `votes-${slug(nameOn(screening, whose))}`, "csv", NOW), "text/csv", votesCsv(out, papers, whose === "all" ? undefined : whose)), off: !lines.length }]
              : tab === "flow"
                ? [
                    { key: "svg", label: "Download SVG", run: () => save(fileName(out, "flow", "svg", NOW), "image/svg+xml", svg()), off: false },
                    { key: "png", label: "Download PNG", run: png, off: false },
                  ]
                : tab === "record"
                  ? [{ key: "json", label: "Download JSON", run: () => save(fileName(out, "record", "json", NOW), "application/json", JSON.stringify(recordOf(out, NOW), null, 2)), off: false }]
                  : [{ key: "copy", label: "Copy", run: () => void navigator.clipboard.writeText(methods), off: false }]
          ).map((button, i, all) => (
            <Button key={button.key} size="sm" variant={i === all.length - 1 ? "default" : "outline"} disabled={button.off} onClick={() => { button.run(); setDone((all) => [...new Set([...all, button.key])]); }}>
              {done.includes(button.key) ? <Check /> : button.key === "copy" ? <Copy /> : <Download />}
              {done.includes(button.key) ? (button.key === "copy" ? "Copied" : <>{button.label.slice(9)}<span className="sr-only"> downloaded</span></>) : button.label.startsWith("Download ") ? <><span className="max-sm:sr-only">Download </span>{button.label.slice(9)}</> : button.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

