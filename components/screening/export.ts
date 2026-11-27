// What a screening gives out as files: its papers, its votes, its flow diagram, its methods paragraph and its whole
// record. Every file is built here, from the screening as it stands and from the papers as the server gives them to
// whoever takes the file out. The Export dialog and a selection on Papers call the same builders, so they give the
// same rows, and what is hidden from someone on a page is hidden from them in every file.

import type { ConvexReactClient } from "convex/react";
import { modelsAdvise } from "@/lib/screening/rules";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { sentencesOf } from "@/lib/screening/passages";
import { createFormatter, createTranslator } from "next-intl";
import { changeSays } from "./activity-words";
import type { EffectsSay } from "./effects";
import { wordsOf } from "./words";
import {
  DECISION_LABEL,
  EVERY_LABEL,
  NO_VOTE,
  RESULT_LABEL,
  SETTLE_LABEL,
  activeReviewers,
  bareOf,
  castOf,
  failedLabel,
  growing,
  keptOf,
  leftOf,
  listed,
  modelsOf,
  nameOn,
  num,
  numberWord,
  plural,
  pointsMax,
  eachOf,
  readersOf,
  settledOf,
  slug,
  taken,
  votingReviewers,
  type Paper,
  type Result,
  type Screening,
  collectionName,
  pairOf,
  REMOVED_LABEL,
  removedOf,
} from "./data";
import { pdfsMissed, pdfsOf, type Figures } from "./store";

/** A screening as it stands, with the figures the server keeps of it, and the person taking a file out of it. */
export type Taken = { screening: Screening; counts: Record<Result, number>; me: string; figures: Figures | undefined };

const iso = (at: number) => new Date(at).toISOString();
/** A day as a file says it, with its year: a file is read long after the year it was made in. */
const fullDay = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const MINUTE = 60_000;
/** After the screening began: its first reviewers and criteria are written in the moment it is made. */
const later = (screening: Screening, at: number) => at > screening.createdAt + MINUTE;
const doiOf = (paper: Pick<Paper, "doi">) => paper.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
const authorsOf = (paper: Pick<Paper, "authors">) => paper.authors ?? [];
/** The papers still open: in conflict, or waiting for votes, the ones still on their way from a source among them. */
const openIn = ({ counts }: Taken) => counts.conflict + counts.waiting;
// Its papers as the server counts them, which the Overview's progress counts too: what the sources took can run ahead of it while a removed source's papers are taken out.
const totalIn = ({ counts }: Pick<Taken, "counts">) => counts.include + counts.maybe + counts.exclude + counts.conflict + counts.waiting;
const kindOf = (reviewer: { kind: "person" | "model" }) => (reviewer.kind === "model" ? "AI model" : "Person");
/** The records that are read as their own PDF, having no abstract. */
const filedOf = (sources: Screening["sources"]) => sources.reduce((sum, source) => sum + (source.read?.filed ?? 0), 0);
/** Its excluded papers by the reason, the most common first. */
const excludedBy = (figures: Figures | undefined) => Object.entries(figures?.reasons ?? {}).sort((a, b) => b[1] - a[1]);

/**
 * A file's name: the screening, what the file holds, "unfinished" while it is running with papers still open,
 * "with-open-papers" where it was marked finished with some, and the day and time (UTC) it was taken out. While
 * votes can be hidden from whoever takes a file out, two people's files of one screening differ, so the name says
 * whose it is. A file sent on says by its name what it is a picture of.
 */
export const fileName = ({ screening, counts, me }: Pick<Taken, "screening" | "counts" | "me">, what: string, ending: string, at: number) =>
  `${slug(screening.name)}-${what}${!(counts.conflict + counts.waiting) ? "" : screening.finishedAt ? "-with-open-papers" : "-unfinished"}-${iso(at).slice(0, 10)}-${iso(at).slice(11, 16).replace(":", "")}utc${screening.rule.blind === "after" && !screening.finishedAt ? `-${slug(nameOn(screening, me))}` : ""}.${ending}`;

/**
 * A file of rows, as a spreadsheet opens it: every cell quoted, a quote in a cell doubled. A text that begins the way
 * a formula does (=, +, -, @) takes an apostrophe in front, so a spreadsheet keeps a title or a note as text and
 * never runs it. A number stays a number.
 */
const toCsv = (lines: unknown[][]) => lines.map((line) => line.map((cell) => `"${(typeof cell === "string" && /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : String(cell ?? "")).replace(/"/g, '""')}"`).join(",")).join("\n");

/** Papers one read of a file's rows takes. */
const EXPORT_PAGE = 100;
type ListArgs = Omit<(typeof api.screening.paperViews.list)["_args"], "paginationOpts">;
type PageOf<T> = (paginationOpts: { cursor: string | null; numItems: number }) => Promise<{ page: T[]; isDone: boolean; continueCursor: string }>;
/** What a paginated query holds, a page after the other. */
async function* pagesOf<T>(read: PageOf<T>) {
  let cursor: string | null = null;
  do {
    const got = await read({ cursor, numItems: EXPORT_PAGE });
    yield got.page;
    cursor = got.isDone ? null : got.continueCursor;
  } while (cursor);
}
/**
 * All of it, for a file that is built in the browser from every row. ponytail: the file is one Blob, so the browser
 * holds every row of it whichever way they are read: a screening's papers are bounded by its plan, its discussion and
 * its activity by nothing but its length. One with tens of thousands of messages would have the server write the
 * record a part at a time, as convex/exports.ts does for a library.
 */
async function allOf<T>(read: PageOf<T>) {
  let all: T[] = [];
  for await (const page of pagesOf(read)) all = all.concat(page);
  return all;
}
/**
 * Every paper of a list, as the server gives them to the person asking, for a file that holds them all. ponytail: the
 * whole list is held in the browser while its file is built, which a plan's most papers a screening (a few thousand)
 * keeps small; a screening of far more would have the server write the file a part at a time, as convex/exports.ts
 * does for a library.
 */
export const everyPaper = (convex: ConvexReactClient, args: ListArgs) => allOf<Paper>((paginationOpts) => convex.query(api.screening.paperViews.list, { ...args, paginationOpts }));

/** The columns of the papers file, each with what it holds. The file's rows, the guide in the dialog and the guide in the whole record are made from this one list. */
export const PAPER_GUIDE = {
  paper_id: "The paper's id in this screening. A paper has the same id in every file.",
  doi: "Its DOI, where it has one.",
  title: "Its title.",
  authors: "Its authors, separated by semicolons.",
  year: "The year it was published.",
  journal: "Where it was published.",
  abstract: "Its abstract, as the reviewers read it.",
  read_as: "What its reviewers read: Abstract, or PDF for a paper with no abstract that was screened as its own PDF.",
  source: "The source that brought it into the screening.",
  added: "When it was added: at the start, or the time of the check that found it.",
  result: "Where it stands: Included, Maybe, Excluded, In conflict or Waiting for votes.",
  excluded_for: "For an excluded paper, the criterion it failed or the other reason given.",
  settled_by: "Who settled it, where a person did and the votes alone did not.",
  settled_note: "The note that person left.",
  votes_include: "How many of its reviewers voted Include. Empty where their votes are hidden from the person who took the file out.",
  votes_maybe: "How many voted Maybe.",
  votes_exclude: "How many voted Exclude.",
  points: "Points from its reviewers' answers to the criteria, as the screening's scoring gives them. They rank included papers and decide nothing.",
  points_max: "The most points a paper can have.",
  cited_by: "How many papers cite it.",
} as const;
type PaperColumn = keyof typeof PAPER_GUIDE;
const PAPER_COLUMNS = Object.keys(PAPER_GUIDE) as PaperColumn[];

/** One row for each paper: what it is, where it came from and where it stands. */
export function paperRows({ screening }: Pick<Taken, "screening">, papers: Paper[]): Array<Record<PaperColumn, string | number>> {
  const most = pointsMax(screening);
  return papers.map((paper) => {
    const settled = settledOf(paper);
    const votes = paper.cast.flatMap((one) => one.vote ?? []);
    const how = (decision: "include" | "maybe" | "exclude") => (paper.sees ? votes.filter((vote) => vote.decision === decision).length : "");
    return {
      paper_id: paper.id,
      doi: doiOf(paper) ?? "",
      title: paper.title,
      authors: authorsOf(paper).join("; "),
      year: paper.year ?? "",
      journal: paper.venue ?? "",
      abstract: paper.abstract,
      read_as: paper.pdf ? "PDF" : "Abstract",
      source: screening.sources.find((source) => source.id === paper.source)?.name ?? "",
      added: paper.addedAt === undefined ? "At the start" : iso(paper.addedAt),
      result: RESULT_LABEL[settled.result],
      excluded_for: settled.result === "exclude" && paper.reason ? failedLabel(paper.reason, screening.criteria) : "",
      settled_by: settled.resolvedBy ? nameOn(screening, settled.resolvedBy) : "",
      settled_note: settled.note ?? "",
      votes_include: how("include"),
      votes_maybe: how("maybe"),
      votes_exclude: how("exclude"),
      points: paper.points ?? "",
      points_max: paper.points === undefined ? "" : most,
      cited_by: paper.cited ?? "",
    };
  });
}
export const papersCsv = (out: Pick<Taken, "screening">, papers: Paper[]) => toCsv([PAPER_COLUMNS, ...paperRows(out, papers).map((row) => PAPER_COLUMNS.map((column) => row[column]))]);

/** The papers for a reference manager, each with its id in the screening, the identifier and the abstract it is filed by. */
export const risOf = (papers: Paper[]) =>
  papers
    .map((paper) => {
      const doi = doiOf(paper);
      return [
        "TY  - JOUR",
        `ID  - ${paper.id}`,
        `TI  - ${paper.title}`,
        ...authorsOf(paper).map((author) => `AU  - ${author}`),
        ...(paper.year === undefined ? [] : [`PY  - ${paper.year}`]),
        ...(paper.venue ? [`JO  - ${paper.venue}`] : []),
        ...(doi ? [`DO  - ${doi}`, `UR  - https://doi.org/${doi}`] : []),
        `AB  - ${paper.abstract}`,
        "ER  - ",
      ].join("\n");
    })
    .join("\n\n");
/** Text as a BibTeX field holds it: the signs BibTeX reads as its own are escaped, so an "&" in a journal's name or a brace in a title can't break the file. */
const bibText = (text: string) => text.replace(/\\/g, "\\textbackslash{}").replace(/([&%$#_{}])/g, "\\$1");
/** The same as BibTeX. A paper's key is its first author and year, with a letter where the file holds two alike. */
export const bibOf = (papers: Paper[]) => {
  // Papers by the same first author in the same year take a, b, c, and after z the letters double.
  const used = new Map<string, number>();
  const letters = (n: number): string => (n < 26 ? String.fromCharCode(97 + n) : letters(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26)));
  return papers
    .map((paper) => {
      const base = `${(authorsOf(paper)[0] ?? "paper").split(" ").pop()!.toLowerCase().replace(/[^a-z]/g, "")}${paper.year ?? ""}`;
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      const doi = doiOf(paper);
      const words = [["title", paper.title], ["author", authorsOf(paper).join(" and ")], ...(paper.venue ? [["journal", paper.venue]] : []), ["abstract", paper.abstract]].map(([name, value]) => [name, bibText(value!)]);
      // An identifier is written as it is: a DOI's own signs are not text.
      const fields = [...words.slice(0, 2), ...(paper.year === undefined ? [] : [["year", String(paper.year)]]), ...words.slice(2), ...(doi ? [["doi", doi]] : []), ["paperid", paper.id]];
      return `@article{${base}${letters(n)},\n${fields.map(([name, value]) => `  ${name} = {${value}}`).join(",\n")}\n}`;
    })
    .join("\n\n");
};

/** What a reviewer's row says where their vote is cast and kept from the person taking the file out. */
const VOTE_KEPT = "Voted, hidden";
/**
 * One row for each paper a reviewer was given: who was on it, whether they voted, and how. A model is given no paper
 * that is only a PDF it can't read, and a reviewer added later none settled before they came. On a paper the person has yet
 * to vote on, the others' rows say only what the page says: that a vote was cast, never which. Their own row is whole.
 * `whose` keeps one reviewer's rows.
 */
export function voteRows(screening: Screening, papers: Paper[], whose?: string) {
  return papers.flatMap((paper) =>
    castOf(screening, paper).flatMap((entry) => {
      if (whose && entry.reviewer.id !== whose) return [];
      const kept = Boolean(entry.hidden);
      return [{ paper, reviewer: entry.reviewer, vote: entry.vote, kept, status: entry.failed ? NO_VOTE.failed : kept ? VOTE_KEPT : entry.vote ? "Voted" : settledOf(paper).final || screening.finishedAt ? NO_VOTE.none : NO_VOTE.yet }];
    }),
  );
}
/** Which reviewer and paper pairs the votes file has a row for, and why a pair can have none. */
const VOTE_ROWS = "One row for each paper a reviewer was given. A pair with no row is a paper that reviewer was never given: a model is given no paper that is only a PDF it can't read, someone added after screening began is given none settled before they came, and where fewer people are on each paper than there are, each person is given a share.";
/** The columns of the votes file, each with what it holds. `criteria` stands for one column for each criterion. */
export const VOTE_GUIDE = {
  paper_id: PAPER_GUIDE.paper_id,
  doi: PAPER_GUIDE.doi,
  paper: "The paper's title.",
  year: PAPER_GUIDE.year,
  reviewer: "The person or the AI model.",
  reviewer_kind: "Person or AI model.",
  status: `One of: "Voted"; "${NO_VOTE.yet}"; "${NO_VOTE.none}" (the paper was settled without this vote, or the screening was marked finished before it was cast); "${NO_VOTE.failed}" (an AI model); "${VOTE_KEPT}" (the vote was cast, and is hidden from the person who took the file out, who had not voted on the paper yet).`,
  decision: "Include, Maybe or Exclude.",
  reason: "For an Exclude, the criterion the paper failed or the other reason given.",
  criteria: "One column for each criterion, named by its number and short name: the reviewer's answer, yes, no or unclear. Empty where they gave none.",
  note: "What the reviewer wrote with the vote.",
  paper_result: PAPER_GUIDE.result,
  settled_by: PAPER_GUIDE.settled_by,
  settled_note: PAPER_GUIDE.settled_note,
  voted_at: "When the vote was cast.",
} as const;
export const votesCsv = (screening: Screening, papers: Paper[], whose?: string) => {
  const { criteria } = screening;
  return toCsv([
    // A criterion's column carries its number, so two with the same short name are still two columns.
    ["paper_id", "doi", "paper", "year", "reviewer", "reviewer_kind", "status", "decision", "reason", ...criteria.map((criterion, i) => `${i + 1}. ${criterion.short}`), "note", "paper_result", "settled_by", "settled_note", "voted_at"],
    ...voteRows(screening, papers, whose).map(({ paper, reviewer, vote, status }) => {
      const settled = settledOf(paper);
      return [
        paper.id, doiOf(paper) ?? "", paper.title, paper.year ?? "", reviewer.name, kindOf(reviewer), status, vote ? DECISION_LABEL[vote.decision] : "",
        vote?.reason ? failedLabel(vote.reason, criteria) : "", ...criteria.map((criterion) => vote?.answers[criterion.key] ?? ""), vote?.note ?? "", RESULT_LABEL[settled.result],
        settled.resolvedBy ? nameOn(screening, settled.resolvedBy) : "", settled.note ?? "", vote ? iso(vote.at) : "",
      ];
    }),
  ]);
};

/** A box of the flow diagram: its count, and the lines that break the count down. */
type FlowBox = { title: string; n: number; lines?: Array<{ label: string; n: number }> };
/** One stage of the flow: its box, and the boxes beside it for the records that left at that stage. */
export type FlowRow = { main: FlowBox; side: FlowBox[] };

/** The flow of records, counted the way a PRISMA 2020 diagram counts them. */
export function flowOf(out: Taken): FlowRow[] {
  const { screening, counts, figures } = out;
  const [kept, open] = [totalIn(out), openIn(out)];
  // What the sources held and the screening never took: the duplicates merged, papers with no abstract, and what couldn't be read or found.
  const { left, bare, merged } = removedOf(screening.sources);
  const found = kept + merged;
  const looks = figures?.checks ?? { later: 0, found: 0, added: 0 };
  // The records with no abstract that came with their own PDF are read as that: the stage then says how many were read each way.
  const filed = filedOf(screening.sources);
  const on = filed ? "" : " on title and abstract";
  return [
    {
      main: { title: "Records identified", n: found + left, lines: [...screening.sources.map((source) => ({ label: source.name, n: taken(source) + leftOf(source) })), ...(looks.added && looks.lastAt ? [{ label: looks.later === 1 ? `Of these, by the later search on ${fullDay(looks.lastAt)}` : `Of these, by ${looks.later} later searches, the last on ${fullDay(looks.lastAt)}`, n: looks.added }] : [])] },
      side: [{ title: "Records removed before screening", n: found - kept + left, lines: [{ label: REMOVED_LABEL.merged, n: merged }, ...(bare ? [{ label: REMOVED_LABEL.bare, n: bare }] : []), ...(left - bare ? [{ label: REMOVED_LABEL.unread, n: left - bare }] : [])] }],
    },
    {
      main: { title: open ? `Records in screening${on}` : `Records screened${on}`, n: kept, ...(filed ? { lines: [{ label: "On title and abstract", n: kept - filed }, { label: "On the full text, having no abstract", n: filed }] } : {}) },
      side: [
        { title: "Records excluded", n: counts.exclude, lines: excludedBy(figures).map(([key, n]) => ({ label: failedLabel(key, screening.criteria), n })) },
        ...(counts.maybe || open ? [{ title: "Neither included nor excluded", n: counts.maybe + open, lines: [...(counts.maybe ? [{ label: "Left at Maybe", n: counts.maybe }] : []), ...(open ? [{ label: "Still open", n: open }] : [])] }] : []),
      ],
    },
    { main: { title: `Records included${on}`, n: counts.include }, side: [] },
  ];
}

/** The flow as a drawing, laid out the way PRISMA 2020 lays it out: stages down the left, what left each stage beside it. Under it, what it is a picture of. */
export function flowSvg(out: Taken, at: number) {
  const rows = flowOf(out);
  const [line, gap, sideGap, mainX, mainW, sideX, sideW] = [15, 34, 10, 20, 360, 430, 310];
  const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  // A long name, such as a search's own words, runs onto further lines: a file can't be opened to read what a page would cut.
  const wrap = (text: string, max: number) => text.split(" ").reduce<string[]>((lines, word) => ((lines.at(-1) ?? "").length + word.length + 1 > max && lines.at(-1) ? [...lines, word] : [...lines.slice(0, -1), `${lines.at(-1) ? `${lines.at(-1)} ` : ""}${word}`]), [""]);
  // The count stays whole: it ends the name's last line where it fits there, and takes the next line where it doesn't.
  const linesOf = (box: FlowBox, max: number) => (box.lines ?? []).flatMap((one) => { const [lines, n] = [wrap(one.label, max), `(n = ${num(one.n)})`]; return lines.at(-1)!.length + n.length + 1 > max ? [...lines, n] : [...lines.slice(0, -1), `${lines.at(-1)} ${n}`]; });
  const heightOf = (box: FlowBox, max: number) => { const lines = linesOf(box, max).length; return lines ? 57 + lines * line : 54; };
  const draw = (box: FlowBox, x: number, y: number, w: number, max: number) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${heightOf(box, max)}" rx="8" fill="#fff" stroke="#999"/><text x="${x + 16}" y="${y + 24}" font-size="13" font-weight="600" fill="#111">${esc(box.title)}</text><text x="${x + 16}" y="${y + 42}" font-size="12" fill="#333">n = ${num(box.n)}</text>${linesOf(box, max).map((text, k) => `<text x="${x + 16}" y="${y + 62 + k * line}" font-size="11" fill="#444">${esc(text)}</text>`).join("")}`;
  const [mainMax, sideMax] = [56, 48];
  let y = 20;
  const parts = rows.map((row, i) => {
    const mainH = heightOf(row.main, mainMax);
    const sideH = row.side.reduce((sum, box) => sum + heightOf(box, sideMax), 0) + Math.max(0, row.side.length - 1) * sideGap;
    const rowH = Math.max(mainH, sideH);
    let sideY = y;
    const side = row.side.map((box) => {
      const drawn = `<path d="M${mainX + mainW} ${y + 24} h25 V${sideY + 24} H${sideX - 2}" stroke="#666" fill="none" marker-end="url(#a)"/>${draw(box, sideX, sideY, sideW, sideMax)}`;
      sideY += heightOf(box, sideMax) + sideGap;
      return drawn;
    });
    const down = i < rows.length - 1 ? `<path d="M${mainX + mainW / 2} ${y + mainH} V${y + rowH + gap - 2}" stroke="#666" fill="none" marker-end="url(#a)"/>` : "";
    const drawn = `${draw(row.main, mainX, y, mainW, mainMax)}${side.join("")}${down}`;
    y += rowH + gap;
    return drawn;
  });
  const open = openIn(out);
  const caption = `${out.screening.name}. Screening on title and abstract${filedOf(out.screening.sources) ? ", and on the full text of the records with no abstract" : ""}, as it stood on ${fullDay(at)}${!open ? "" : out.screening.finishedAt ? `: marked finished with ${plural(open, "record", "records")} still open` : `: not finished, ${plural(open, "record", "records")} still open`}.`;
  // The caption runs onto further lines where it is long: a line cut at the drawing's edge would lose its end.
  const captionLines = wrap(caption, 118);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${y - gap + 30 + captionLines.length * 14}" font-family="sans-serif"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#666"/></marker></defs>${parts.join("")}${captionLines.map((text, k) => `<text x="${mainX}" y="${y - gap + 26 + k * 14}" font-size="11" fill="#666">${esc(text)}</text>`).join("")}</svg>`;
}

/** A paragraph for a review's methods section: what was done, in the past tense for what is done and the present for a screening still running. */
export function methodsOf(out: Taken) {
  const { screening, counts, figures } = out;
  const [kept, open] = [totalIn(out), openIn(out)];
  const { left, bare, merged } = removedOf(screening.sources);
  const found = kept + merged;
  const looks = figures?.checks ?? { later: 0, found: 0, added: 0 };
  const { people, each } = readersOf(screening);
  const [models, reviewers] = [modelsOf(screening), activeReviewers(screening)];
  const pair = people.length > 1 ? pairOf(figures, people[0]!.id, people[1]!.id) : null;
  const kappas = reviewers.flatMap((a, i) => reviewers.slice(i + 1).flatMap((b) => pairOf(figures, a.id, b.id)?.kappa ?? [])).sort((a, b) => a - b);
  const names = people.map((person) => person.name);
  // Who reads each record, said the way a methods section says it.
  const readers = !people.length ? "" : each >= people.length ? (people.length === 1 ? `One human reviewer (${names[0]})` : people.length === 2 ? `Both human reviewers (${names.join(" and ")})` : `All ${people.length} human reviewers (${names.join(", ")})`) : `${numberWord(each)} of the ${people.length} human reviewers (${names.join(", ")})`;
  // The readings a model couldn't make: its paper was decided by the other reviewers.
  const unread = models.reduce((sum, model) => sum + (model.tally?.failed ?? 0), 0);
  const lateCriteria = screening.criteria.filter((criterion) => later(screening, criterion.addedAt));
  const changed = figures?.changes ?? 0;
  const settler = nameOn(screening, screening.rule.resolver);
  // The present for a screening still running. One marked finished is told in the past, whether or not papers were left open.
  const running = open > 0 && !screening.finishedAt;
  const [is, are] = running ? ["is", "are"] : ["was", "were"];
  const one = (n: number) => (n === 1 ? is : are);
  // Marked finished with papers left open: nothing is claimed of every record, since not every one was done.
  const partial = open > 0 && !running;
  // The records with no abstract that came with their own PDF, which is what their reviewers read.
  const filed = filedOf(screening.sources);
  // The records still open, by how they stand: the ones its reviewers split on, and the ones still short of votes.
  const waiting = Math.max(0, open - counts.conflict);
  const stillOpen = `${counts.conflict ? `, ${num(counts.conflict)} in conflict` : ""}${waiting ? `${counts.conflict ? " and" : ","} ${num(waiting)} waiting for votes` : ""}`;
  // A model taken off since, whose votes still count, took part: it is named with the ones still on it.
  const offModels = screening.reviewers.filter((one) => one.kind === "model" && one.left !== undefined && one.discarded === undefined && (one.tally?.cast ?? 0) > 0);
  const everyModel = [...models, ...offModels];
  // The people who joined after it began were given only what was still open then.
  const late = people.filter((person) => later(screening, person.addedAt));
  // Anyone else given fewer records than there are, whatever kept one from them: said with how many, so the claim is never wider than what they were given.
  const short = each >= people.length ? people.filter((person) => !late.includes(person) && (person.tally?.dealt ?? kept) < kept) : [];
  // A model given fewer records than there are: none settled before it was added, and none that is only a PDF it can't read.
  const pdfs = pdfsOf(screening.sources);
  const modelsShort = everyModel.flatMap((model) => {
    const missed = model.model ? pdfsMissed(model.model, pdfs).papers : 0;
    return [
      ...(later(screening, model.addedAt) ? [`${model.name} was added after screening began and was given only the records still open then.`] : []),
      ...(missed ? [`${model.name} ${is} not given the ${plural(missed, "record", "records")} that came only as a PDF, which it can't read; ${missed === 1 ? "that record" : "those records"} ${one(missed)} decided by the other reviewers.`] : []),
    ];
  });
  return [
    !open ? "" : running ? `Screening was still in progress when this was written, with ${num(kept - open)} of ${num(kept)} records settled${stillOpen}.` : `The screening was marked finished with ${plural(open, "record", "records")} still open, with ${num(kept - open)} of ${num(kept)} records settled${stillOpen}.`,
    `Records from ${plural(screening.sources.length, "source", "sources")} (n = ${num(found + left)}) were brought into Openscholar.${bare ? ` ${plural(bare, "record", "records")} with no abstract ${bare === 1 ? "was" : "were"} left out.` : ""}${left - bare ? ` ${plural(left - bare, "more", "more")} could not be read or found.` : ""} ${found === kept ? "No duplicates were found, and" : `After ${plural(found - kept, "duplicate was", "duplicates were")} merged,`} ${num(kept)} ${open ? "went into screening" : "were screened"}.`,
    looks.later && looks.lastAt ? `${[0, screening.sources.length].includes(growing(screening).length) ? "The sources were" : `The ${growing(screening).length} of the ${screening.sources.length} sources that gain records over time (${growing(screening).map((source) => source.name).join("; ")}) were`} searched again ${looks.later === 1 ? "once" : `${looks.later} times`} after screening began, most recently on ${fullDay(looks.lastAt)}; ${looks.added ? `${looks.added} of the records identified came from ${looks.later === 1 ? "that search" : "those searches"}` : "no further records were found"}.${screening.living && running ? ` A further search is scheduled ${EVERY_LABEL[screening.living.every].toLowerCase()}.` : ""}` : "",
    // Said of the records, not of work done: true before the first vote and after the last.
    `${partial ? "Records were" : `Each record ${is}`} assessed on ${partial ? "title and abstract" : "its title and abstract"}${screening.criteria.length ? ` against ${plural(screening.criteria.length, "criterion", "criteria")}, ${screening.criteria.filter((c) => c.must).length} of which a record ${running ? "has" : "had"} to meet to be included` : ""}.${filed ? ` ${plural(filed, "record", "records")} with no abstract ${filed === 1 ? is : are} assessed on ${filed === 1 ? "its" : "their"} full text instead.` : ""}`,
    // Who a record is given to, which is the method. How many of them voted is in the votes themselves: a record can be settled before each has.
    readers ? `${readers} ${one(each >= people.length ? people.length : each)} assigned to ${short.length ? "the records" : `each record${late.length ? " still open when they joined" : ""}`}${screening.rule.blind === "after" ? `. A reviewer ${running ? "does" : "did"} not see the other votes on a record before casting their own` : ""}.${short.length ? ` ${short.map((person) => `${person.name} was given ${num(person.tally?.dealt ?? 0)} of the ${num(kept)}`).join(", and ")}.` : ""}${late.length ? ` ${listed(late.map((person) => person.name))} joined after screening began and ${late.length === 1 ? "was" : "were"} given only records still open then.` : ""}` : "No human reviewer was assigned to the records.",
    everyModel.length ? `${everyModel.length === 1 ? "One AI model" : `${everyModel.length} AI models`} (${everyModel.map((m) => m.name).join(", ")}) ${running && !offModels.length ? (models.length === 1 ? "votes" : "vote") : running ? "have voted" : "voted"} on the records${people.length ? (modelsAdvise(screening.rule, each, everyModel.length) ? ` as advice only (the human reviewers ${running ? "decide" : "decided"} each record they ${running ? "are" : "were"} given)` : ` as ${everyModel.length === 1 ? "an additional reviewer" : "additional reviewers"}`) : ""}, giving an answer for every criterion${unread ? `; ${plural(unread, "reading", "readings")} by a model failed, and ${unread === 1 ? "that record" : "those records"} ${one(unread)} decided by the other reviewers` : ""}.${offModels.length ? ` ${listed(offModels.map((m) => m.name))} ${offModels.length === 1 ? "was" : "were"} taken off after screening began, and ${offModels.length === 1 ? "its" : "their"} votes cast until then were kept.` : ""}${modelsShort.length ? ` ${modelsShort.join(" ")}` : ""}` : "No AI model took part.",
    screening.rule.settle === "all" ? `A record ${is} settled once all of its reviewers ${running ? "have" : "had"} voted and agree${running ? "" : "d"}, and disagreements ${running ? "go" : "went"} to ${settler}${counts.conflict ? `; ${plural(counts.conflict, "disagreement", "disagreements")} ${one(counts.conflict)} still to be settled` : ""}.` : screening.rule.settle === "most" ? `A record ${is} settled by the majority of its reviewers once all of them ${running ? "have" : "had"} voted, and records with no majority ${running ? "go" : "went"} to ${settler}${counts.conflict ? `; ${plural(counts.conflict, "such record", "such records")} ${one(counts.conflict)} still to be settled` : ""}.` : `The first vote on a record ${running ? "settles" : "settled"} it${models.length && people.length ? `; where a human reviewer ${running ? "is" : "was"} assigned a record, the first human vote ${running ? "settles" : "settled"} it` : ""}.`,
    lateCriteria.length ? `${lateCriteria.length === 1 ? "One criterion was" : `${lateCriteria.length} criteria were`} added after screening began. Votes already cast were kept, and settled records kept their result${models.length ? `. The AI models answered ${lateCriteria.length === 1 ? "it" : "them"} on the records still open` : ""}.` : "",
    changed ? `The settings or the reviewers were changed ${changed === 1 ? "once" : `${changed} times`} after screening began. The screening's exported record lists each change and what it did.` : "",
    pair ? `Agreement between ${names[0]} and ${names[1]} over the ${pair.papers} records both assessed was ${Math.round(pair.same * 100)}% (Cohen's kappa ${pair.kappa.toFixed(2)}).` : "",
    kappas.length > 1 ? `Across all ${reviewers.length} reviewers, pairwise agreement (Cohen's kappa) ranged from ${kappas[0]!.toFixed(2)} to ${kappas.at(-1)!.toFixed(2)}.` : "",
    `${plural(counts.include, "record was", "records were")} included${counts.maybe ? `, and ${plural(counts.maybe, "was", "were")} left at Maybe` : ""}.`,
  ].filter(Boolean).join(" ");
}

/**
 * The record in one file, for code or for keeping: the screening with its rule, its scoring and where its included
 * papers go, its criteria as they are asked, its reviewers, its sources with what each brought, every paper with
 * where it stands, every vote with what a model read, what reviewers wrote to each other, what was changed, and a
 * guide to the columns. Ids tie the parts together. It leaves out what the screening cost. What is hidden from the
 * person is left out too, and the file says how much.
 */
export async function recordOf(convex: ConvexReactClient, workspaceId: Id<"workspaces">, out: Taken, at: number) {
  const { screening, me, counts } = out;
  const { criteria, rule, scoring, destination } = screening;
  const of = { workspaceId, jobId: screening.id };
  // Its papers, what its reviewers wrote to each other, what was changed, and what each source held that it didn't take or merged.
  const [papers, said, logged, leftOut, merged] = await Promise.all([
    everyPaper(convex, of),
    allOf((paginationOpts) => convex.query(api.screening.discussion.all, { ...of, paginationOpts })),
    allOf((paginationOpts) => convex.query(api.screening.view.activity, { ...of, paginationOpts })),
    Promise.all(screening.sources.map((source) => (leftOf(source) ? allOf((paginationOpts) => convex.query(api.screening.view.leftOut, { ...of, sourceId: source.id as Id<"screeningSources">, paginationOpts })) : []))),
    Promise.all(screening.sources.map((source) => (source.read?.duplicates ? allOf((paginationOpts) => convex.query(api.screening.view.merged, { ...of, sourceId: source.id as Id<"screeningSources">, paginationOpts })) : []))),
  ]);
  // A file's words are English whoever downloads it: the activity's sentences are made from the English messages, which are read when a record is asked for and at no other time.
  const messages = (await import("@/messages/en-GB.json")).default;
  const english: EffectsSay = { words: wordsOf({ t: createTranslator({ locale: "en-GB", messages, namespace: "screening.words" }), format: createFormatter({ locale: "en-GB" }) }), t: createTranslator({ locale: "en-GB", messages, namespace: "screening.effects" }) };
  const rows = voteRows(screening, papers);
  const hidden = { votes: rows.filter((row) => row.kept).length, papers: new Set(rows.flatMap((row) => (row.kept ? [row.paper.id] : []))).size };
  // What a part of the screening carries from before it began is dated from its start.
  const since = (when: number) => iso(Math.max(when, screening.createdAt));
  return {
    exported: { at: iso(at), by: nameOn(screening, me), ...(hidden.votes ? { left_out: `${plural(hidden.votes, "vote", "votes")} on ${plural(hidden.papers, "paper", "papers")}, hidden from ${nameOn(screening, me)}, who had not voted on ${hidden.papers === 1 ? "it" : "them"} yet` } : {}) },
    guide: { papers: PAPER_GUIDE, votes: VOTE_GUIDE, vote_rows: VOTE_ROWS },
    screening: {
      id: screening.id,
      name: screening.name,
      question: screening.question,
      workspace: screening.workspace.name,
      started_by: nameOn(screening, screening.createdBy),
      started_at: iso(screening.createdAt),
      finished_at: screening.finishedAt ? iso(screening.finishedAt) : null,
      checks_for_new_papers: screening.living ? { how_often: EVERY_LABEL[screening.living.every], next: iso(screening.living.next) } : null,
      rule: { people_on_each_paper: rule.each === "all" ? "Everyone" : eachOf(rule), settled_when: SETTLE_LABEL[rule.settle], models_votes: rule.settle === "one" || !modelsOf(screening).length ? null : rule.models === "advice" ? "Advice only" : "Count like a person's", conflicts_settled_by: rule.settle === "one" ? null : nameOn(screening, rule.resolver), other_votes_seen: rule.blind === "after" ? "Hidden from a reviewer only while the paper waits for that reviewer's own vote, and from nobody once the screening is marked finished" : "At any time" },
      scoring: { points_needed_for_each_star: scoring.stars },
      included_papers_go_to: destination.kind === "none" ? null : { kind: destination.kind, name: collectionName(screening), collection_id: destination.kind === "new" ? null : (destination.collection ?? null), excluded_papers_removed_from_it: destination.prune },
      counts,
    },
    criteria: criteria.map((criterion, i) => {
      const [yes, no, unclear] = scoring.points[criterion.key] ?? [0, 0, 0];
      return { number: i + 1, key: criterion.key, short_name: criterion.short, question: criterion.text, must_have: criterion.must, guidance: criterion.note ?? null, marked_words: criterion.terms, points: { yes, no, unclear }, added_at: since(criterion.addedAt) };
    }),
    reviewers: votingReviewers(screening).map((reviewer) => ({ id: reviewer.id, name: reviewer.name, kind: kindOf(reviewer), added_at: since(reviewer.addedAt), taken_off_at: reviewer.left ? iso(reviewer.left) : null })),
    // Each source with the records it held and the screening didn't take, by name and with why, and the records it merged, each with the paper that stands for it (in `papers`, under the source that brought it first).
    sources: screening.sources.map((source, at) => ({ id: source.id, kind: source.kind, name: source.name, detail: source.detail, left_out_count: leftOf(source), left_out_without_abstract: bareOf(source), left_out: leftOut[at]!.map((row) => ({ name: row.name, why: english.words.t(`leftWhy.${row.why}`) })), duplicates_merged: merged[at]!.map((row) => ({ name: row.name, same_as_paper_id: row.paper?.id ?? null })), added_at: since(source.addedAt), found: taken(source) + leftOf(source), after_duplicates: keptOf(source) })),
    papers: paperRows(out, papers).map((row, i) => ({ ...row, source_id: papers[i]!.source ?? null })),
    // The votes that were cast and show, each with the sentence a model named for its answers and how sure it was.
    votes: rows.flatMap(({ paper, reviewer, vote }) => (vote ? [{
      paper_id: paper.id,
      reviewer_id: reviewer.id,
      decision: vote.decision,
      reason: vote.reason ?? null,
      answers: vote.answers,
      note: vote.note ?? null,
      voted_at: iso(vote.at),
      ...(reviewer.kind === "model" ? { read: Object.fromEntries(criteria.flatMap((criterion) => { const [sentence, confidence] = [vote.passages?.[criterion.key], vote.confidences?.[criterion.key]]; return vote.answers[criterion.key] ? [[criterion.key, { passage: sentence === undefined || sentence === null ? null : (sentencesOf(paper.abstract)[sentence] ?? null), confidence: confidence === undefined ? null : Number(confidence.toFixed(2)) }]] : []; })) } : {}),
    }] : [])),
    // Who was on a paper and cast no vote on it: someone who has yet to, someone the paper was settled without, a model that couldn't read it.
    without_a_vote: rows.flatMap(({ paper, reviewer, vote, kept, status }) => (vote || kept ? [] : [{ paper_id: paper.id, reviewer_id: reviewer.id, status }])),
    // The votes that were cast and are kept from the person: who cast them shows on the page, and here.
    hidden_votes: rows.flatMap(({ paper, reviewer, kept }) => (kept ? [{ paper_id: paper.id, reviewer_id: reviewer.id }] : [])),
    discussion: said.map((line) => ({ paper_id: line.paperId, by: line.by.name, to: line.to?.name ?? null, at: iso(line.at), text: line.text })),
    activity: logged.map((row) => { const says = changeSays(english, row); return { at: iso(row.at), by: row.by.name, what: says.what, effect: says.effect ?? null }; }),
  };
}

/** Hands a file to the person: the browser's own download, which is the outside system here. */
export const save = (name: string, type: string, text: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
};
