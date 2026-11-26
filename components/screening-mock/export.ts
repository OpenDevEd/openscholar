// What a screening gives out as files: its papers, its votes, its flow diagram, its methods paragraph and its whole
// record. Every file is built here, from the screening as it stands and from who is taking it out. The Export dialog
// and a selection on Papers call the same builders, so they give the same rows, and what is hidden from someone on a
// page is hidden from them in every file.

import {
  DECISION_LABEL,
  EVERY_LABEL,
  NO_VOTE,
  RESULT_LABEL,
  SCHEDULE,
  SETTLE_LABEL,
  activeReviewers,
  agreement,
  confidenceOf,
  count,
  doiOf,
  evidence,
  excludedBy,
  failedLabel,
  foundTotal,
  growing,
  keptOf,
  listed,
  modelsOf,
  nameOn,
  num,
  numberWord,
  paperTotal,
  plural,
  readersOf,
  reasonOf,
  scoreOf,
  seesVotes,
  slug,
  taken,
  votingReviewers,
  workspaceOf,
  type Paper,
  type Screening,
  type Standing,
  PDF_LEFT,
  bareOf,
  leftOf,
  leftTotal,
  pdfAdded,
  pdfStands,
} from "./data";
import { collectionName } from "./form-data";

/** A screening as it stands, and the person taking a file out of it. */
export type Taken = { screening: Screening; state: Pick<Standing, "papers" | "votes" | "settled" | "counts">; me: string };

const sees = ({ screening, state, me }: Taken, paper: Paper) => seesVotes(screening, state, me, paper);
const iso = (at: number) => new Date(at).toISOString();
/** A day as a file says it, with its year: a file is read long after the year it was made in. */
const fullDay = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const MORE_AUTHORS = "and others";
const authorsOf = (paper: Paper) => paper.authors.filter((author) => author !== MORE_AUTHORS);
/** A list of authors the source gave incomplete ends "and others": a file keeps that, since the missing names can't be made up. */
const cutShort = (paper: Paper) => paper.authors.includes(MORE_AUTHORS);
/** The papers still open: in conflict, waiting for votes, or still on their way from a source. */
const openIn = ({ screening, state }: Taken) => state.counts.conflict + state.counts.waiting + (paperTotal(screening.sources) - state.papers.length);
const kindOf = (reviewer: { kind: "person" | "model" }) => (reviewer.kind === "model" ? "AI model" : "Person");

/** A file's name: the screening, what the file holds, "unfinished" while it is running with papers still open, "with-open-papers" where it was marked finished with some, and the day it was taken out. A file sent on says by its name what it is a picture of. */
export const fileName = (out: Taken, what: string, ending: string, at: number) => `${slug(out.screening.name)}-${what}${!openIn(out) ? "" : out.screening.finishedAt ? "-with-open-papers" : "-unfinished"}-${iso(at).slice(0, 10)}.${ending}`;

/** A file of rows, as a spreadsheet opens it: every cell quoted, a quote in a cell doubled. */
const toCsv = (lines: unknown[][]) => lines.map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

/** What is hidden from the person among some papers: the others' votes on the ones they have yet to vote on. A file says how many it leaves out. */
export const hiddenIn = (out: Taken, papers: Paper[]) => {
  const unseen = papers.filter((paper) => !sees(out, paper));
  return { papers: unseen.length, votes: unseen.reduce((sum, paper) => sum + out.state.votes[paper.id]!.filter((one) => one.vote && one.reviewer.id !== out.me).length, 0) };
};

/** The columns of the papers file, each with what it holds. The file's rows, the guide in the dialog and the guide in the whole record are made from this one list. */
export const PAPER_GUIDE = {
  paper_id: "The paper's id in this screening. A paper has the same id in every file.",
  doi: "Its DOI, where it has one.",
  title: "Its title.",
  authors: `Its authors, separated by semicolons. "${MORE_AUTHORS}" ends a list the source gave incomplete.`,
  year: "The year it was published.",
  journal: "Where it was published.",
  abstract: "Its abstract in English, as the reviewers read it.",
  abstract_original: "The abstract in its own language, where the paper isn't written in English.",
  language: "That language.",
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
export function paperRows(out: Taken, papers: Paper[]): Array<Record<PaperColumn, string | number>> {
  const { screening, state } = out;
  return papers.map((paper) => {
    const shown = sees(out, paper);
    const settled = state.settled[paper.id]!;
    const cast = state.votes[paper.id]!;
    const votes = cast.flatMap((one) => one.vote ?? []);
    const reason = settled.result === "exclude" ? reasonOf(cast, settled) : undefined;
    const how = (decision: "include" | "maybe" | "exclude") => (shown ? votes.filter((vote) => vote.decision === decision).length : "");
    const score = shown && screening.criteria.length && votes.length ? scoreOf(screening, cast) : null;
    return {
      paper_id: paper.id,
      doi: doiOf(paper) ?? "",
      title: paper.title,
      authors: paper.authors.join("; "),
      year: paper.year,
      journal: paper.venue,
      abstract: paper.sentences.join(" "),
      abstract_original: paper.original?.text ?? "",
      language: paper.original?.language ?? "",
      source: screening.sources.find((source) => source.id === paper.source)?.name ?? "",
      added: paper.batch === undefined ? "At the start" : iso(paper.batch),
      result: RESULT_LABEL[settled.result],
      excluded_for: reason ? failedLabel(reason, screening.criteria) : "",
      settled_by: settled.resolvedBy ? nameOn(screening, settled.resolvedBy) : "",
      settled_note: settled.note ?? "",
      votes_include: how("include"),
      votes_maybe: how("maybe"),
      votes_exclude: how("exclude"),
      points: score ? score.points : "",
      points_max: score ? score.of : "",
      cited_by: paper.cited,
    };
  });
}
export const papersCsv = (out: Taken, papers: Paper[]) => toCsv([PAPER_COLUMNS, ...paperRows(out, papers).map((row) => PAPER_COLUMNS.map((column) => row[column]))]);

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
        `PY  - ${paper.year}`,
        `JO  - ${paper.venue}`,
        ...(doi ? [`DO  - ${doi}`, `UR  - https://doi.org/${doi}`] : []),
        `AB  - ${paper.sentences.join(" ")}`,
        ...(paper.original ? [`LA  - ${paper.original.language}`] : []),
        ...(cutShort(paper) ? ["N1  - The source gave an incomplete list of authors."] : []),
        "ER  - ",
      ].join("\n");
    })
    .join("\n\n");
/** Text as a BibTeX field holds it: the signs BibTeX reads as its own are escaped, so an "&" in a journal's name or a brace in a title can't break the file. */
const bibText = (text: string) => text.replace(/\\/g, "\\textbackslash{}").replace(/([&%$#_{}])/g, "\\$1");
/** The same as BibTeX. A paper's key is worked out over every paper of the screening, so it is the same key in a file of some of them. */
export const bibOf = (papers: Paper[], every: Paper[] = papers) => {
  // Papers by the same first author in the same year take a, b, c, and after z the letters double.
  const used = new Map<string, number>();
  const letters = (n: number): string => (n < 26 ? String.fromCharCode(97 + n) : letters(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26)));
  const keys = new Map(every.map((paper) => {
    const base = `${(authorsOf(paper)[0] ?? "paper").split(" ").pop()!.toLowerCase().replace(/[^a-z]/g, "")}${paper.year}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return [paper.id, `${base}${letters(n)}`];
  }));
  return papers
    .map((paper) => {
      const doi = doiOf(paper);
      // "and others" is BibTeX's own way to end a list it doesn't have all of.
      const authors = [...authorsOf(paper), ...(cutShort(paper) ? ["others"] : [])].join(" and ");
      const words = [["title", paper.title], ["author", authors], ["journal", paper.venue], ["abstract", paper.sentences.join(" ")], ...(paper.original ? [["language", paper.original.language]] : [])].map(([name, value]) => [name, bibText(value!)]);
      // An identifier is written as it is: a DOI's own signs are not text.
      const fields = [...words.slice(0, 2), ["year", String(paper.year)], ...words.slice(2, 3), ...(doi ? [["doi", doi]] : []), ...words.slice(3), ["paperid", paper.id]];
      return `@article{${keys.get(paper.id)},\n${fields.map(([name, value]) => `  ${name} = {${value}}`).join(",\n")}\n}`;
    })
    .join("\n\n");
};

/** What a reviewer's row says where their vote is cast and kept from the person taking the file out. */
const VOTE_KEPT = "Voted, hidden";
/**
 * One row for each reviewer on each paper: who was on it, whether they voted, and how. On a paper the person has yet
 * to vote on, the others' rows say only what the page says: that a vote was cast, never which. Their own row is whole.
 * `whose` keeps one reviewer's rows.
 */
export function voteRows(out: Taken, papers: Paper[], whose?: string) {
  const { state, me } = out;
  return papers.flatMap((paper) => {
    const shown = sees(out, paper);
    return state.votes[paper.id]!.flatMap((entry) => {
      if (whose && entry.reviewer.id !== whose) return [];
      const kept = !shown && entry.reviewer.id !== me && Boolean(entry.vote);
      return [{ paper, reviewer: entry.reviewer, vote: kept ? undefined : entry.vote, kept, status: entry.failed ? NO_VOTE.failed : kept ? VOTE_KEPT : entry.vote ? "Voted" : state.settled[paper.id]!.final ? NO_VOTE.none : NO_VOTE.yet }];
    });
  });
}
/** The columns of the votes file, each with what it holds. `criteria` stands for one column for each criterion. */
export const VOTE_GUIDE = {
  paper_id: PAPER_GUIDE.paper_id,
  doi: PAPER_GUIDE.doi,
  paper: "The paper's title.",
  year: PAPER_GUIDE.year,
  reviewer: "The person or the AI model.",
  reviewer_kind: "Person or AI model.",
  status: `One of: "Voted"; "${NO_VOTE.yet}"; "${NO_VOTE.none}" (the paper was settled without this vote); "${NO_VOTE.failed}" (an AI model); "${VOTE_KEPT}" (the vote was cast, and is hidden from the person who took the file out, who had not voted on the paper yet).`,
  decision: "Include, Maybe or Exclude.",
  reason: "For an Exclude, the criterion the paper failed or the other reason given.",
  criteria: "One column for each criterion, named by its number and short name: the reviewer's answer, yes, no or unclear. Empty where they gave none.",
  note: "What the reviewer wrote with the vote.",
  paper_result: PAPER_GUIDE.result,
  settled_by: PAPER_GUIDE.settled_by,
  settled_note: PAPER_GUIDE.settled_note,
  voted_at: "When the vote was cast.",
} as const;
export const votesCsv = (out: Taken, papers: Paper[], whose?: string) => {
  const { screening, state } = out;
  const { criteria } = screening;
  return toCsv([
    // A criterion's column carries its number, so two with the same short name are still two columns.
    ["paper_id", "doi", "paper", "year", "reviewer", "reviewer_kind", "status", "decision", "reason", ...criteria.map((criterion, i) => `${i + 1}. ${criterion.short}`), "note", "paper_result", "settled_by", "settled_note", "voted_at"],
    ...voteRows(out, papers, whose).map(({ paper, reviewer, vote, status }) => {
      const settled = state.settled[paper.id]!;
      return [
        paper.id, doiOf(paper) ?? "", paper.title, paper.year, reviewer.name, kindOf(reviewer), status, vote ? DECISION_LABEL[vote.decision] : "",
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
  const { screening, state } = out;
  const { counts } = state;
  const [found, kept, open] = [foundTotal(screening.sources), paperTotal(screening.sources), openIn(out)];
  // What the sources held and the screening never took: papers with no abstract, and what couldn't be read or found.
  const [left, bare] = [leftTotal(screening.sources), screening.sources.reduce((sum, source) => sum + bareOf(source), 0)];
  const looks = screening.updates ?? [];
  const later = looks.reduce((sum, look) => sum + look.found, 0);
  return [
    {
      main: { title: "Records identified", n: found + left, lines: [...screening.sources.map((source) => ({ label: source.name, n: taken(source) + leftOf(source) })), ...(later ? [{ label: looks.length === 1 ? `Of these, by the later search on ${fullDay(looks[0]!.at)}` : `Of these, by ${looks.length} later searches, the last on ${fullDay(looks.at(-1)!.at)}`, n: later }] : [])] },
      side: [{ title: "Records removed before screening", n: found - kept + left, lines: [{ label: "Duplicates", n: found - kept }, ...(bare ? [{ label: "No abstract", n: bare }] : []), ...(left - bare ? [{ label: "Could not be read or found", n: left - bare }] : [])] }],
    },
    {
      main: { title: open ? "Records in screening on title and abstract" : "Records screened on title and abstract", n: kept },
      side: [
        { title: "Records excluded", n: counts.exclude, lines: excludedBy(state).map(([key, n]) => ({ label: failedLabel(key, screening.criteria), n })) },
        ...(counts.maybe || open ? [{ title: open ? "Not yet included or excluded" : "Neither included nor excluded", n: counts.maybe + open, lines: [...(counts.maybe ? [{ label: "Left at Maybe", n: counts.maybe }] : []), ...(open ? [{ label: "Still open", n: open }] : [])] }] : []),
      ],
    },
    { main: { title: "Records included on title and abstract", n: counts.include }, side: [] },
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
  const caption = `${out.screening.name}. Screening on title and abstract, as it stood on ${fullDay(at)}${!open ? "" : out.screening.finishedAt ? `: marked finished with ${plural(open, "record", "records")} still open` : `: not finished, ${plural(open, "record", "records")} still open`}.`;
  // The caption runs onto further lines where it is long: a line cut at the drawing's edge would lose its end.
  const captionLines = wrap(caption, 118);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${y - gap + 30 + captionLines.length * 14}" font-family="sans-serif"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#666"/></marker></defs>${parts.join("")}${captionLines.map((text, k) => `<text x="${mainX}" y="${y - gap + 26 + k * 14}" font-size="11" fill="#666">${esc(text)}</text>`).join("")}</svg>`;
}

/** A paragraph for a review's methods section: what was done, in the past tense for what is done and the present for a screening still running. */
export function methodsOf(out: Taken) {
  const { screening, state, me } = out;
  const { papers, votes, counts } = state;
  const [found, kept, open] = [foundTotal(screening.sources), paperTotal(screening.sources), openIn(out)];
  const [left, bare] = [leftTotal(screening.sources), screening.sources.reduce((sum, source) => sum + bareOf(source), 0)];
  const looks = screening.updates ?? [];
  const later = looks.reduce((sum, look) => sum + look.found, 0);
  const { people, each } = readersOf(screening);
  const [models, reviewers] = [modelsOf(screening), activeReviewers(screening)];
  // Agreement is worked out on the votes the person taking it out may see.
  const seen = { ...state, canSee: (paper: Paper) => seesVotes(screening, state, me, paper) };
  const pair = people.length > 1 ? agreement(people[0]!.id, people[1]!.id, seen) : null;
  const kappas = reviewers.flatMap((a, i) => reviewers.slice(i + 1).flatMap((b) => agreement(a.id, b.id, seen)?.kappa ?? [])).sort((a, b) => a - b);
  const names = people.map((person) => person.name);
  // Who reads each record, said the way a methods section says it.
  const readers = !people.length ? "" : each >= people.length ? (people.length === 1 ? `One human reviewer (${names[0]})` : people.length === 2 ? `Both human reviewers (${names.join(" and ")})` : `All ${people.length} human reviewers (${names.join(", ")})`) : `${numberWord(each)} of the ${people.length} human reviewers (${names.join(", ")})`;
  const unread = count(papers, (paper) => votes[paper.id]!.some((one) => one.failed));
  const lateCriteria = screening.criteria.filter((criterion) => criterion.addedAt > screening.createdAt);
  // What changed its settings or its reviewers after it began. Asking a reviewer, reminding one, pausing the models, sharing, moving and finishing are in its activity too, and change neither.
  const changed = screening.changes.filter((change) => change.at > screening.createdAt && change.by !== SCHEDULE && !/^(Asked|Sent|Paused|Resumed|Moved|Marked|Reopened|Shared|Checked|Started)\b/.test(change.what)).length;
  const settler = nameOn(screening, screening.rule.resolver);
  // The present for a screening still running. One marked finished is told in the past, whether or not papers were left open.
  const running = open > 0 && !screening.finishedAt;
  const [is, are] = running ? ["is", "are"] : ["was", "were"];
  const one = (n: number) => (n === 1 ? is : are);
  // Marked finished with papers left open: nothing is claimed of every record, since not every one was done.
  const partial = open > 0 && !running;
  // The people who joined after it began were given only what was still open then.
  const late = people.filter((person) => person.addedAt > screening.createdAt);
  return [
    !open ? "" : running ? `Screening was still in progress when this was written: ${num(kept - open)} of ${num(kept)} records had been settled.` : `The screening was marked finished with ${plural(open, "record", "records")} still open: ${num(kept - open)} of ${num(kept)} records had been settled.`,
    `Records from ${plural(screening.sources.length, "source", "sources")} (n = ${num(found + left)}) were brought into Openscholar.${bare ? ` ${plural(bare, "record", "records")} with no abstract ${bare === 1 ? "was" : "were"} left out.` : ""}${left - bare ? ` ${plural(left - bare, "more", "more")} could not be read or found.` : ""} ${found === kept ? "No duplicates were found, and" : `After ${plural(found - kept, "duplicate was", "duplicates were")} merged,`} ${num(kept)} ${open ? "went into screening" : "were screened"}.`,
    looks.length ? `${growing(screening).length === screening.sources.length ? "The sources were" : `The ${growing(screening).length} of the ${screening.sources.length} sources that gain records over time (${growing(screening).map((source) => source.name).join("; ")}) were`} searched again ${screening.living ? `${EVERY_LABEL[screening.living.every].toLowerCase()}, ` : ""}${looks.length === 1 ? "once" : `${looks.length} times`} after screening began, most recently on ${fullDay(looks.at(-1)!.at)}; ${later ? `${later} of the records identified came from ${looks.length === 1 ? "that search" : "those searches"}` : "no further records were found"}.` : "",
    // Said of the records, not of work done: true before the first vote and after the last.
    `${partial ? "Records were" : `Each record ${is}`} assessed on ${partial ? "title and abstract" : "its title and abstract"}${screening.criteria.length ? ` against ${plural(screening.criteria.length, "criterion", "criteria")}, ${screening.criteria.filter((c) => c.must).length} of which a record ${running ? "has" : "had"} to meet to be included` : ""}.`,
    // Who a record is given to, which is the method. How many of them voted is in the votes themselves: a record can be settled before each has.
    readers ? `${readers} ${one(each >= people.length ? people.length : each)} assigned to each record${screening.rule.blind === "after" ? `, and ${running ? ((each >= people.length ? people.length : each) === 1 ? "votes" : "vote") : "voted"} without seeing the other votes` : ""}.${late.length ? ` ${listed(late.map((person) => person.name))} joined after screening began and ${late.length === 1 ? "was" : "were"} given only records still open then.` : ""}` : "No human reviewer was assigned to the records.",
    models.length ? `${models.length === 1 ? "One AI model" : `${models.length} AI models`} (${models.map((m) => m.name).join(", ")}) ${running ? (models.length === 1 ? "votes" : "vote") : "voted"} on the records${people.length ? ` as ${models.length === 1 ? "an additional reviewer" : "additional reviewers"}` : ""}, giving an answer and a quoted passage for every criterion${unread ? `; ${plural(unread, "record", "records")} could not be read by a model and ${one(unread)} decided by the other reviewers` : ""}.` : "No AI model took part.",
    screening.rule.settle === "all" ? `A record ${is} settled when all of its reviewers agree${running ? "" : "d"}, and disagreements ${running ? "go" : "went"} to ${settler}${counts.conflict ? `; ${num(counts.conflict)} ${one(counts.conflict)} still open` : ""}.` : screening.rule.settle === "most" ? `A record ${is} settled by the majority of its reviewers, and records with no majority ${running ? "go" : "went"} to ${settler}${counts.conflict ? `; ${num(counts.conflict)} ${one(counts.conflict)} still open` : ""}.` : `The first vote on a record ${running ? "settles" : "settled"} it.`,
    lateCriteria.length ? `${lateCriteria.length === 1 ? "One criterion was" : `${lateCriteria.length} criteria were`} added after screening began: votes already cast were kept, and settled records kept their result${models.length ? `. The AI models answered ${lateCriteria.length === 1 ? "it" : "them"} on the records still open` : ""}.` : "",
    changed ? `The settings or the reviewers were changed ${changed === 1 ? "once" : `${changed} times`} after screening began. The screening's exported record lists each change and what it did.` : "",
    pair ? `Agreement between ${names[0]} and ${names[1]} over the ${pair.papers} records both assessed was ${Math.round(pair.same * 100)}% (Cohen's kappa ${pair.kappa.toFixed(2)}).` : "",
    kappas.length > 1 ? `Across all ${reviewers.length} reviewers, pairwise agreement (Cohen's kappa) ranged from ${kappas[0]!.toFixed(2)} to ${kappas.at(-1)!.toFixed(2)}.` : "",
    `${plural(counts.include, "record was", "records were")} included${counts.maybe ? `, and ${plural(counts.maybe, "was", "were")} left at Maybe, where a criterion a record had to meet could not be answered from its title and abstract` : ""}.`,
  ].filter(Boolean).join(" ");
}

/**
 * The record in one file, for code or for keeping: the screening with its rule, its scoring and where its included
 * papers go, its criteria as they are asked, its reviewers and who else it is shared with, its sources with what each
 * check found, every paper with where it stands, every vote with what a model read, what reviewers wrote to each
 * other, what was changed, and a guide to the columns. Ids tie the parts together. It leaves out what the screening
 * cost and who is online. What is hidden from the person is left out too, and the file says how much.
 */
export function recordOf(out: Taken, at: number) {
  const { screening, state, me } = out;
  const { criteria, rule, scoring, destination } = screening;
  const hidden = hiddenIn(out, state.papers);
  const visible = new Set(state.papers.filter((paper) => sees(out, paper)).map((paper) => paper.id));
  const rows = voteRows(out, state.papers);
  // What a part of the screening carries from before it began is dated from its start.
  const since = (when: number) => iso(Math.max(when, screening.createdAt));
  return {
    exported: { at: iso(at), by: nameOn(screening, me), ...(hidden.votes ? { left_out: `${plural(hidden.votes, "vote", "votes")} on ${plural(hidden.papers, "paper", "papers")}, hidden from ${nameOn(screening, me)}, who had not voted on ${hidden.papers === 1 ? "it" : "them"} yet` } : {}) },
    guide: { papers: PAPER_GUIDE, votes: VOTE_GUIDE },
    screening: {
      id: screening.id,
      name: screening.name,
      question: screening.question,
      workspace: workspaceOf(screening).name,
      started_by: nameOn(screening, screening.createdBy),
      started_at: iso(screening.createdAt),
      finished_at: screening.finishedAt ? iso(screening.finishedAt) : null,
      checks_for_new_papers: screening.living ? { how_often: EVERY_LABEL[screening.living.every], next: iso(screening.living.next) } : null,
      rule: { people_on_each_paper: rule.each === "all" ? "Everyone" : Number(rule.each), settled_when: SETTLE_LABEL[rule.settle], conflicts_settled_by: rule.settle === "one" ? null : nameOn(screening, rule.resolver), other_votes_seen: rule.blind === "after" ? "Hidden from a reviewer only while the paper waits for that reviewer's own vote" : "At any time" },
      scoring: { points_needed_for_each_star: scoring.stars },
      included_papers_go_to: destination.kind === "none" ? null : { kind: destination.kind, name: collectionName(screening), collection_id: destination.kind === "new" ? null : (destination.collection ?? null), excluded_papers_removed_from_it: destination.prune },
      shared_with: (screening.viewers ?? []).map((viewer) => ({ name: viewer.name, role: "Viewer", since: iso(viewer.addedAt) })),
      counts: state.counts,
    },
    criteria: criteria.map((criterion, i) => {
      const [yes, no, unclear] = scoring.points[criterion.key] ?? [0, 0, 0];
      return { number: i + 1, key: criterion.key, short_name: criterion.short, question: criterion.text, must_have: criterion.must, guidance: criterion.note ?? null, points: { yes, no, unclear }, added_at: since(criterion.addedAt) };
    }),
    reviewers: votingReviewers(screening).map((reviewer) => ({ id: reviewer.id, name: reviewer.name, kind: kindOf(reviewer), added_at: since(reviewer.addedAt), taken_off_at: reviewer.left ? iso(reviewer.left) : null })),
    sources: screening.sources.map((source) => ({ id: source.id, kind: source.kind, name: source.name, detail: source.detail, facts: source.facts ?? [], filters: source.filters ?? [], left_out: source.files ? source.files.filter((file) => !pdfAdded(file)).map((file) => ({ name: file.name, why: PDF_LEFT[pdfStands(file) as keyof typeof PDF_LEFT] })) : (source.left ?? []), left_out_count: leftOf(source), left_out_without_abstract: bareOf(source), added_at: since(source.addedAt), found: taken(source) + leftOf(source), after_duplicates: keptOf(source), checks: (source.updates ?? []).map((update) => ({ at: iso(update.at), found: update.added, duplicates: update.duplicates })) })),
    papers: paperRows(out, state.papers).map((row, i) => ({ ...row, source_id: state.papers[i]!.source })),
    // The votes that were cast and show, each with what a model read for its answers and how sure it was.
    votes: rows.flatMap(({ paper, reviewer, vote }) => (vote ? [{
      paper_id: paper.id,
      reviewer_id: reviewer.id,
      decision: vote.decision,
      reason: vote.reason ?? null,
      answers: vote.answers,
      note: vote.note ?? null,
      voted_at: iso(vote.at),
      ...(reviewer.kind === "model" ? { read: Object.fromEntries(criteria.flatMap((criterion) => { const answer = vote.answers[criterion.key]; return answer ? [[criterion.key, { passage: evidence(paper, criterion, criteria, answer).quote, confidence: Number(confidenceOf(paper, reviewer, criterion, answer).toFixed(2)) }]] : []; })) } : {}),
    }] : [])),
    // Who was on a paper and cast no vote on it: someone who has yet to, someone the paper was settled without, a model that couldn't read it.
    without_a_vote: rows.flatMap(({ paper, reviewer, vote, kept, status }) => (vote || kept ? [] : [{ paper_id: paper.id, reviewer_id: reviewer.id, status }])),
    // The votes that were cast and are kept from the person: who cast them shows on the page, and here.
    hidden_votes: rows.flatMap(({ paper, reviewer, kept }) => (kept ? [{ paper_id: paper.id, reviewer_id: reviewer.id }] : [])),
    discussion: Object.entries(screening.threads ?? {}).flatMap(([paper, lines]) => (visible.has(paper) ? lines.map((line) => ({ paper_id: paper, by: nameOn(screening, line.by), to: line.to ? nameOn(screening, line.to) : null, at: iso(line.at), text: line.text })) : [])),
    activity: screening.changes.map((change) => ({ at: iso(change.at), by: change.by === SCHEDULE ? "On schedule" : nameOn(screening, change.by), what: change.what, effect: change.effect ?? null })),
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
