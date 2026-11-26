"use client";

// What can be taken out of a screening: its papers, every vote, the flow of papers, a paragraph for the
// methods section, and the whole record.

import { copyText } from "@/components/copy-text";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useConvex } from "convex/react";
import { WorkspaceLink as NextLink } from "@/components/workspaces/link";
import { Layers, ArrowRight, Check, ChevronRight, Copy, Download, Info } from "@/components/icons";
import { LIST, Segmented } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HelpFact } from "@/components/ui/help";
import { ScrollArea } from "@/components/ui/scroll-area";
import { showStyledToast } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { inWorkspace, useWorkspace as usePageWorkspace } from "@/lib/workspaces/url";
import { RESULTS, type Result, slug, bylineOf, questionOf, inOrder, nameOn, votingReviewers } from "./data";
import { papersHref } from "./links";
import { FilterMenu, RESULT_STYLE, EmptyNote, Help, Panel, ShutNote, QuestionName, Reason, ResultChip, ReviewerMark, ReviewerName, Section, VoteMark, OpenPapersChips } from "./pieces";
import { bibOf, everyPaper, papersCsv, recordOf, risOf, save, voteRows, votesCsv, type Taken, fileName, flowOf, flowSvg, methodsOf, PAPER_GUIDE, VOTE_GUIDE } from "./export";
import { useFigures, type Open } from "./store";
import { useWords } from "./words";

import type { ExportTab } from "./dialogs";
/** Which papers the first tab takes out: the ones with one result, every paper, or the person's own includes. */
type Group = Result | "all" | "mine";
const GROUP_FILE: Record<Group, string> = { include: "included", maybe: "maybe", exclude: "excluded", conflict: "in-conflict", waiting: "waiting", all: "all-papers", mine: "my-includes" };

/** The columns of the votes file, as the sample of it shows them. */
const VOTE_COLUMNS = ["paper", "reviewer", "vote", "reason", "note", "result", "voted"] as const;

/** The four things a review's report needs from its screening: the included papers, every vote, the flow of papers, and a paragraph for the methods section. */
export function ExportDialog({ open, onClose, state, tab, onTab }: { open: boolean; onClose: () => void; state: Open; tab: ExportTab; onTab: (tab: ExportTab) => void }) {
  const t = useTranslations("screening.files");
  const words = useWords();
  const convex = useConvex();
  const workspaceId = usePageWorkspace();
  // What was last taken out, so its button says so: a download gives no other sign. A file of every paper takes a moment to read: its button says so while it does.
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const setTab = onTab;
  // Whose votes the votes file holds: everyone's, or one reviewer's.
  const [whose, setWhose] = useState("all");
  // Which papers: unset, the included ones, or the person's own includes where nothing is included yet.
  const [picked, setPicked] = useState<Group | null>(null);
  const { screening, counts, total } = state;
  const { id } = screening;
  const { figures } = useFigures(id);

  // Every file is built by export.ts, from the screening as it stands and from the papers as the server gives them to whoever takes the file out: what is hidden from them on a page is hidden from them in the file.
  const out: Taken = { screening: state.filed, counts, me: state.me, figures };
  const blind = screening.rule.blind === "after";
  const reviewers = inOrder(votingReviewers(screening), state.me);
  // The papers by where they stand, as the server has counted them.
  const sizes: Record<Group, number> = { ...counts, all: total, mine: reviewers.find((one) => one.id === state.me)?.tally?.include ?? 0 };
  const group: Group = picked ?? (sizes.include || !sizes.mine ? "include" : "mine");
  const papersOf = (which: Group) => (which === "mine" ? { reviewer: state.me, voted: "include" as const } : which === "all" ? {} : { result: which });
  const votesOf = whose === "all" ? {} : { reviewer: whose };
  // The first few of what a file will hold, read only while its tab is open.
  const first = useCursorPage(api.screening.paperViews.list, inWorkspace(workspaceId, open && tab === "papers" ? { jobId: id, ...papersOf(group) } : "skip"), 8);
  const voted = useCursorPage(api.screening.paperViews.list, inWorkspace(workspaceId, open && tab === "votes" ? { jobId: id, ...votesOf } : "skip"), 12);
  const included = sizes[group];
  const allIncluded = papersHref(id, group === "mine" ? { voted: "include" } : group === "all" ? {} : { result: group });
  // The first vote on each of three papers: what the file holds, without a title three times over.
  const lines = voteRows(screening, voted.items, whose === "all" ? undefined : whose).flatMap((row) => (row.vote ? [{ ...row, vote: row.vote, result: row.paper.result }] : []));
  const sample = lines.filter((row, i) => lines.findIndex((one) => one.paper.id === row.paper.id) === i).slice(0, 3);
  // What the server has counted of the votes: the ones cast, and the places with no vote in them, by why.
  const talliesOf = (ones: typeof reviewers) => {
    const counted = ones.map((one) => one.tally ?? { dealt: 0, cast: 0, failed: 0, waiting: 0, closed: 0 });
    const sum = (of: "cast" | "waiting" | "failed" | "closed") => counted.reduce((all, tally) => all + tally[of], 0);
    return { votes: sum("cast"), voters: counted.filter((tally) => tally.cast).length, yet: sum("waiting"), failed: sum("failed"), none: sum("closed") };
  };
  // The votes file holds everyone's or one reviewer's. The whole record holds everyone's, whichever the votes tab is set to.
  const { votes, voters, yet, failed, none } = talliesOf(reviewers.filter((one) => whose === "all" || one.id === whose));
  const everyones = talliesOf(reviewers);
  const openNow = counts.conflict + counts.waiting;
  const flow = flowOf(out);
  const svg = () => flowSvg(out, Date.now());

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
      link.download = fileName(out, "flow", "png", Date.now());
      link.click();
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg())}`;
  };
  const methods = methodsOf(out);
  // What a file leaves out for this person, said over it: how the others voted on the papers they have yet to vote on.
  const leftOut = blind && state.toDo ? <ShutNote by="vote">{t("votes.leftOut", { count: state.toDo })}</ShutNote> : null;
  // Every paper of a file is read from the server when the file is asked for.
  const every = (narrowed: object) => (workspaceId ? everyPaper(convex, { workspaceId, jobId: id, ...narrowed }) : Promise.reject(new Error(t("notLoaded"))));
  // `run` answers false where it said itself that it didn't work, as a copy the browser refused does.
  const take = async (key: string, run: () => void | boolean | Promise<void | boolean>) => {
    if (busy) return;
    setBusy(key);
    try {
      if ((await run()) !== false) setDone((all) => [...new Set([...all, key])]);
    } catch (error) {
      showStyledToast("error", getErrorMessage(error, t("notMade")));
    } finally {
      setBusy(null);
    }
  };
  // What the open tab holds, as the title over it, with its "?".
  const heading = {
    papers: {
      title: group === "all" ? words.count("papers", included) : t(`papers.title.${group}`, { count: included }),
      help: (
        <Help title={t("tab.papers")} facts={<><HelpFact>{t("facts.bibtex")}</HelpFact><HelpFact>{t("facts.ris")}</HelpFact><HelpFact>{t("facts.csv")}</HelpFact></>}>
          {t("papers.help")}
        </Help>
      ),
    },
    votes: {
      // Every vote cast is counted, the ones hidden from whoever still has papers to vote on among them: the note over the file says which those are.
      title: t("votes.title", { votes, voters }),
      help: (
        <Help title={t("tab.votes")} facts={<><HelpFact>{t("facts.csv")}</HelpFact><HelpFact>{t("facts.columns")}</HelpFact><HelpFact>{t("facts.ids")}</HelpFact></>}>
          {t("votes.help")}
        </Help>
      ),
    },
    flow: {
      title: t("flow.title"),
      help: (
        <Help title={t("flow.title")} facts={<><HelpFact>{t("facts.svg")}</HelpFact><HelpFact>{t("facts.png")}</HelpFact></>}>
          {t("flow.help")}
        </Help>
      ),
    },
    record: {
      title: t("record.title"),
      help: (
        <Help title={t("record.title")} facts={<HelpFact>{t("facts.keeping")}</HelpFact>}>
          {t("record.help")}
        </Help>
      ),
    },
    methods: {
      title: t("methods.title"),
      help: (
        <Help title={t("methods.title")}>
          {t("methods.help")}
        </Help>
      ),
    },
  }[tab];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Anchored at the top and as tall on every tab, so its tabs never move as they are switched. */}
      <DialogContent className="top-[max(1rem,6dvh)] flex h-[min(44rem,88dvh)] translate-y-0 flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="space-y-3 border-b border-border-subtle p-5">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("description")}</DialogDescription>
          {/* On a phone the five make rows of two, the last across both, so none is cut off. */}
          <Segmented label={t("tabsLabel")} value={tab} onChange={setTab} className="max-sm:grid max-sm:grid-cols-2 max-sm:rounded-[1.375rem] max-sm:*:justify-center max-sm:[&>*:last-child]:col-span-2" options={(["papers", "votes", "flow", "methods", "record"] as const).map((one) => ({ id: one, label: t(`tab.${one}`) }))} />
        </DialogHeader>
        <ScrollArea shades className="min-h-0 flex-1">
        <div className="space-y-4 p-5">
          {/* What is taken out now is what stands now: it says so while papers are still open. */}
          {openNow ? (
            <Panel tone="warning" className="flex items-start gap-2.5 py-2.5 text-sm">
              <Info className="mt-1 size-4 shrink-0 ink-warning" />
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-medium">{screening.finishedAt ? t("openFinished") : t("openRunning")}</span>
                <OpenPapersChips id={id} conflict={counts.conflict} waiting={counts.waiting} onClick={onClose} />
              </span>
            </Panel>
          ) : null}
          <Section
            title={heading.title}
            help={heading.help}
            aside={tab === "papers" ? (
              <FilterMenu
                name={t("papers.which")}
                value={group}
                onChange={setPicked}
                narrows={false}
                align="end"
                className="h-8 rounded-full px-3.5 text-xs"
                choices={[
                  ...RESULTS.map((result) => ({ value: result as Group, label: words.result(result), icon: (() => { const Icon = RESULT_STYLE[result].icon; return <Icon />; })(), tone: RESULT_STYLE[result].tone, count: sizes[result] })),
                  { value: "all" as Group, label: t("papers.every"), icon: <Layers />, count: sizes.all, group: t("papers.allOfThem") },
                  ...(sizes.mine ? [{ value: "mine" as Group, label: t("papers.votedInclude"), icon: <Check />, tone: "success" as const, count: sizes.mine, group: t("papers.yourOwn") }] : []),
                ]}
              />
            ) : tab === "votes" ? (
              <FilterMenu
                name={t("votes.whose")}
                value={whose}
                onChange={setWhose}
                narrows={false}
                align="end"
                className="h-8 rounded-full px-3.5 text-xs"
                choices={[{ value: "all", label: t("votes.everyone") }, ...reviewers.map((reviewer) => ({ value: reviewer.id, label: words.youOr(reviewer, state.me), icon: <ReviewerMark reviewer={reviewer} className="size-4" />, group: t("votes.oneReviewer") }))]}
              />
            ) : undefined}
          >
            {tab === "papers" ? (
              included ? (
                <div className="space-y-3">
                  {/* The list keeps its rows' room while they are read: how many there are is known before they are. */}
                  <ul className={LIST} style={{ minHeight: Math.min(included, 8) * 57 }}>
                    {first.items.map((paper) => (
                      <li key={paper.id}>
                        <NextLink href={papersHref(id, { paper: paper.id })} onClick={onClose} className="flex items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{paper.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{bylineOf(paper)}</span>
                          </span>
                          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                        </NextLink>
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant="outline" size="sm">
                    <NextLink href={allIncluded} onClick={onClose}>{t("papers.seeAll", { count: words.num(included) })}<ArrowRight /></NextLink>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3"><EmptyNote>{group === "mine" ? t("papers.noneMine") : words.empty(group, Boolean(screening.finishedAt))}</EmptyNote></div>
              )
            ) : tab === "votes" ? (
              <div className="space-y-3">
                {/* One reviewer's own file of their own votes leaves nothing out. */}
                {whose === state.me ? null : leftOut}
                {/* The file's columns over its first rows: a table may scroll sideways only where it can't fit. */}
                <ScrollArea axis="x" shades className="rounded-2xl border border-border-subtle">
                  {/* The paper takes what the other columns leave, and only it and the free text are ever cut. */}
                  <table className="w-full min-w-[60rem] text-sm">
                    <thead className="bg-inset text-xs text-muted-foreground">
                      <tr>{VOTE_COLUMNS.map((column) => <th key={column} scope="col" className="whitespace-nowrap px-3 py-2 text-start font-medium">{t(`votes.column.${column}`)}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {sample.map((row) => (
                        <tr key={`${row.paper.id}:${row.reviewer.id}`}>
                          <td className="w-full max-w-0 px-3 py-2.5"><NextLink href={papersHref(id, { paper: row.paper.id })} onClick={onClose} className="block truncate font-medium hover:underline">{row.paper.title}</NextLink></td>
                          <td className="whitespace-nowrap px-3 text-xs"><NextLink href={papersHref(id, { reviewer: row.reviewer.id })} onClick={onClose} className="flex items-center gap-2 hover:underline"><ReviewerMark reviewer={row.reviewer} className="size-5" /><ReviewerName reviewer={row.reviewer} you={row.reviewer.id === state.me} /></NextLink></td>
                          <td className="whitespace-nowrap px-3"><span className="flex items-center gap-1.5 text-xs"><VoteMark vote={row.vote} who={row.reviewer.name} className="size-5" />{words.decision(row.vote.decision)}</span></td>
                          <td className="px-3 text-xs text-muted-foreground">
                            {row.vote.reason ? <QuestionName question={questionOf(row.vote.reason, screening.criteria, "label")} label={words.failed(row.vote.reason, screening.criteria)} className="flex max-w-40 min-w-0"><Reason reason={row.vote.reason} criteria={screening.criteria} /></QuestionName> : t("votes.none")}
                          </td>
                          <td className="px-3 text-xs text-muted-foreground"><span className="block max-w-28 truncate">{row.vote.note ?? t("votes.none")}</span></td>
                          <td className="px-3"><ResultChip result={row.result} /></td>
                          <td className="whitespace-nowrap px-3 text-xs text-muted-foreground">{words.ago(row.vote.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
                {/* The file holds more rows than there are votes: said here, so its length is no surprise. */}
                <p className="text-xs text-muted-foreground">
                  {sample.length < votes ? `${t("votes.shown", { shown: words.num(sample.length), votes })} ` : ""}
                  {blind && state.toDo ? `${t("votes.hiddenRows")} ` : ""}
                  {yet + none + failed ? t("votes.emptyRows", { count: yet + none + failed, why: words.listed([...(yet ? [screening.finishedAt ? t("votes.emptyWhy.finished") : t("votes.emptyWhy.yet")] : []), ...(none ? [t("votes.emptyWhy.none")] : []), ...(failed ? [t("votes.emptyWhy.failed")] : [])]) }) : ""}
                </p>
                <Button asChild variant="outline" size="sm">
                  <NextLink href={papersHref(id)} onClick={onClose}>{t("votes.seeEvery")}<ArrowRight /></NextLink>
                </Button>
              </div>
            ) : tab === "flow" ? (
              // The drawing itself, as it will be saved: what you see is what your co-author gets.
              <img alt={t("flow.alt", { boxes: flow.map((row) => `${row.main.title}, ${row.main.n}`).join("; ") })} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg())}`} className="w-full rounded-2xl border border-border-subtle bg-white" />
            ) : tab === "record" ? (
              // What the one file holds: someone who takes it knows what they have before they open it. What the server has counted carries its number.
              <div className="space-y-3">
                {leftOut}
                <ul className={LIST}>
                  {([
                    ["papers", total],
                    ["votes", everyones.votes],
                    ["withoutVote", everyones.yet + everyones.none + everyones.failed],
                    ["criteria", screening.criteria.length],
                    ["reviewers", reviewers.length],
                    ["sources", screening.sources.length],
                    ["messages", null],
                    ["changes", null],
                    // The guide has one entry for all the criteria's columns: the count is of the columns themselves.
                    ["columns", Object.keys(PAPER_GUIDE).length + Object.keys(VOTE_GUIDE).length - 1 + screening.criteria.length],
                  ] as const).map(([part, count]) => (
                    <li key={part} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="w-28 shrink-0 font-medium">{t(`record.part.${part}.name`)}</span>
                      <span className="w-14 shrink-0 text-end font-semibold tabular-nums">{count === null ? null : words.num(count)}</span>
                      <span className="min-w-0 flex-1 text-muted-foreground">{part === "votes" ? t("record.part.votes.what", { hidden: String(Boolean(blind && state.toDo)) }) : t(`record.part.${part}.what`)}</span>
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
          <p className="me-auto min-w-0 text-xs text-muted-foreground max-sm:basis-full">{t(`hint.${tab}`)}</p>
          {(tab === "papers"
            ? [
                { key: `papers-csv:${group}`, format: "CSV", run: async () => save(fileName(out, GROUP_FILE[group], "csv", Date.now()), "text/csv", papersCsv(out, await every(papersOf(group)))), off: !included },
                { key: `bib:${group}`, format: "BibTeX", run: async () => save(fileName(out, GROUP_FILE[group], "bib", Date.now()), "application/x-bibtex", bibOf(await every(papersOf(group)))), off: !included },
                { key: `ris:${group}`, format: "RIS", run: async () => save(fileName(out, GROUP_FILE[group], "ris", Date.now()), "application/x-research-info-systems", risOf(await every(papersOf(group)))), off: !included },
              ]
            : tab === "votes"
              ? [{ key: `csv:${whose}`, format: "CSV", run: async () => save(fileName(out, whose === "all" ? "votes" : `votes-${slug(nameOn(state.filed, whose))}`, "csv", Date.now()), "text/csv", votesCsv(state.filed, state.me, await every({}), whose === "all" ? undefined : whose)), off: !total }]
              : tab === "flow"
                ? [
                    { key: "svg", format: "SVG", run: () => save(fileName(out, "flow", "svg", Date.now()), "image/svg+xml", svg()), off: false },
                    { key: "png", format: "PNG", run: png, off: false },
                  ]
                : tab === "record"
                  ? [{ key: "json", format: "JSON", run: async () => { if (!workspaceId) throw new Error(t("notLoaded")); save(fileName(out, "record", "json", Date.now()), "application/json", JSON.stringify(await recordOf(convex, workspaceId, out, Date.now()), null, 2)); }, off: false }]
                  : [{ key: "copy", format: undefined, run: () => copyText(methods, { copied: t("copyToast.copied"), failed: t("copyToast.failed"), select: t("copyToast.select") }), off: false }]
          ).map((button, i, all) => (
            <Button key={button.key} size="sm" variant={i === all.length - 1 ? "default" : "outline"} disabled={button.off || busy !== null} onClick={() => void take(button.key, button.run)}>
              {busy === button.key ? <Spinner className="size-4" /> : done.includes(button.key) ? <Check /> : button.key === "copy" ? <Copy /> : <Download />}
              {!button.format ? (done.includes(button.key) ? t("copied") : t("copy")) : done.includes(button.key) ? t.rich("downloaded", { format: button.format, sr: (chunks) => <span className="sr-only">{chunks}</span> }) : t.rich("download", { format: button.format, wide: (chunks) => <span className="max-sm:sr-only">{chunks}</span> })}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

