// What a screening gives out as files: its papers, its votes and its whole record. Every file is built here, from the
// screening as it stands and from who is taking it out. The Export dialog and a selection on Papers call the same
// builders, so they give the same rows, and what is hidden from someone on a page is hidden from them in every file.

import {
  DECISION_LABEL,
  EVERY_LABEL,
  HIDDEN_UNTIL_VOTE,
  RESULT_LABEL,
  SCHEDULE,
  SETTLE_LABEL,
  confidenceOf,
  doiOf,
  evidence,
  failedLabel,
  keptOf,
  nameOn,
  reasonOf,
  scoreOf,
  seesVotes,
  taken,
  votingReviewers,
  workspaceOf,
  type Paper,
  type Screening,
  type Standing,
} from "./data";

/** A screening as it stands, and the person taking a file out of it. */
export type Taken = { screening: Screening; state: Pick<Standing, "papers" | "votes" | "settled" | "counts">; me: string };

const sees = ({ screening, state, me }: Taken, paper: Paper) => seesVotes(screening, state, me, paper);
const iso = (at: number) => new Date(at).toISOString();
const authorsOf = (paper: Paper) => paper.authors.filter((author) => author !== "and others");
/** A paper's result as the person may read it: one the votes would give away is hidden with them. "Waiting for votes" gives nothing away. */
const resultFor = (out: Taken, paper: Paper) => {
  const { result } = out.state.settled[paper.id]!;
  return sees(out, paper) || result === "waiting" ? RESULT_LABEL[result] : HIDDEN_UNTIL_VOTE;
};

/** A file of rows, as a spreadsheet opens it: every cell quoted, a quote in a cell doubled. */
export const toCsv = (lines: unknown[][]) => lines.map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

/** What is hidden from the person among some papers: the others' votes on the ones they have yet to vote on. A file says how many it leaves out. */
export const hiddenIn = (out: Taken, papers: Paper[]) => {
  const unseen = papers.filter((paper) => !sees(out, paper));
  return { papers: unseen.length, votes: unseen.reduce((sum, paper) => sum + out.state.votes[paper.id]!.filter((one) => one.vote && one.reviewer.id !== out.me).length, 0) };
};

const PAPER_COLUMNS = ["paper_id", "doi", "title", "authors", "year", "journal", "abstract", "source", "added", "result", "excluded_for", "settled_by", "settled_note", "votes_include", "votes_maybe", "votes_exclude", "points", "cited_by"] as const;

/** One row for each paper: what it is, where it came from and where it stands. */
export function paperRows(out: Taken, papers: Paper[]): Array<Record<(typeof PAPER_COLUMNS)[number], string | number>> {
  const { screening, state } = out;
  return papers.map((paper) => {
    const shown = sees(out, paper);
    const settled = state.settled[paper.id]!;
    const cast = state.votes[paper.id]!;
    const votes = cast.flatMap((one) => one.vote ?? []);
    const reason = shown && settled.result === "exclude" ? reasonOf(cast, settled) : undefined;
    const how = (decision: "include" | "maybe" | "exclude") => (shown ? votes.filter((vote) => vote.decision === decision).length : "");
    return {
      paper_id: paper.id,
      doi: doiOf(paper) ?? "",
      title: paper.title,
      authors: authorsOf(paper).join("; "),
      year: paper.year,
      journal: paper.venue,
      abstract: paper.sentences.join(" "),
      source: screening.sources.find((source) => source.id === paper.source)?.name ?? "",
      added: paper.batch === undefined ? "At the start" : iso(paper.batch),
      result: resultFor(out, paper),
      excluded_for: reason ? failedLabel(reason, screening.criteria) : "",
      settled_by: shown && settled.resolvedBy ? nameOn(screening, settled.resolvedBy) : "",
      settled_note: shown ? (settled.note ?? "") : "",
      votes_include: how("include"),
      votes_maybe: how("maybe"),
      votes_exclude: how("exclude"),
      points: shown && screening.criteria.length && votes.length ? scoreOf(screening, cast).points : "",
      cited_by: paper.cited,
    };
  });
}
export const papersCsv = (out: Taken, papers: Paper[]) => toCsv([[...PAPER_COLUMNS], ...paperRows(out, papers).map((row) => PAPER_COLUMNS.map((column) => row[column]))]);

/** The papers for a reference manager, with the identifier and the abstract it files them by. */
export const risOf = (papers: Paper[]) =>
  papers.map((paper) => { const doi = doiOf(paper); return ["TY  - JOUR", `TI  - ${paper.title}`, ...authorsOf(paper).map((author) => `AU  - ${author}`), `PY  - ${paper.year}`, `JO  - ${paper.venue}`, ...(doi ? [`DO  - ${doi}`, `UR  - https://doi.org/${doi}`] : []), ...(paper.sentences.length ? [`AB  - ${paper.sentences.join(" ")}`] : []), "ER  - "].join("\n"); }).join("\n\n");
export const bibOf = (papers: Paper[]) => {
  // A key names one entry: papers by the same first author in the same year take a, b, c, and after z the letters double.
  const used = new Map<string, number>();
  const letters = (n: number): string => (n < 26 ? String.fromCharCode(97 + n) : letters(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26)));
  return papers
    .map((paper) => {
      const base = `${(authorsOf(paper)[0] ?? "paper").split(" ").pop()!.toLowerCase().replace(/[^a-z]/g, "")}${paper.year}`;
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      const doi = doiOf(paper);
      const fields = [["title", paper.title], ["author", authorsOf(paper).join(" and ")], ["year", String(paper.year)], ["journal", paper.venue], ...(doi ? [["doi", doi]] : []), ...(paper.sentences.length ? [["abstract", paper.sentences.join(" ")]] : [])];
      return `@article{${base}${letters(n)},\n${fields.map(([name, value]) => `  ${name} = {${value}}`).join(",\n")}\n}`;
    })
    .join("\n\n");
};

/**
 * One row for each reviewer on each paper: who was on it, whether they voted, and how. The others' rows on a paper the
 * person has yet to vote on are left out, as their votes are on the page. Their own row is always there.
 */
export function voteRows(out: Taken, papers: Paper[]) {
  const { state, me } = out;
  return papers.flatMap((paper) => {
    const shown = sees(out, paper);
    return state.votes[paper.id]!.flatMap((entry) => (shown || entry.reviewer.id === me ? [{ paper, reviewer: entry.reviewer, vote: entry.vote, status: entry.failed ? "Couldn't read it" : entry.vote ? "Voted" : state.settled[paper.id]!.final ? "No vote" : "No vote yet", result: resultFor(out, paper) }] : []));
  });
}
export const votesCsv = (out: Taken, papers: Paper[]) => {
  const { criteria } = out.screening;
  return toCsv([
    // A criterion's column carries its number, so two with the same short name are still two columns.
    ["paper_id", "doi", "paper", "year", "reviewer", "reviewer_kind", "status", "decision", "reason", ...criteria.map((criterion, i) => `${i + 1}. ${criterion.short}`), "note", "paper_result", "voted_at"],
    ...voteRows(out, papers).map(({ paper, reviewer, vote, status, result }) => [
      paper.id, doiOf(paper) ?? "", paper.title, paper.year, reviewer.name, reviewer.kind === "model" ? "AI model" : "Person", status, vote ? DECISION_LABEL[vote.decision] : "",
      vote?.reason ? failedLabel(vote.reason, criteria) : "", ...criteria.map((criterion) => vote?.answers[criterion.key] ?? ""), vote?.note ?? "", result, vote ? iso(vote.at) : "",
    ]),
  ]);
};

/**
 * The whole record in one file, for code or for keeping: the screening and its rule, its criteria as they are asked,
 * its reviewers and sources, every paper with where it stands, every vote with what a model read, what reviewers wrote
 * to each other, and what was changed. Ids tie the parts together. What is hidden from the person is left out, and the
 * file says how much.
 */
export function recordOf(out: Taken, at: number) {
  const { screening, state, me } = out;
  const { criteria, rule } = screening;
  const hidden = hiddenIn(out, state.papers);
  const visible = new Set(state.papers.filter((paper) => sees(out, paper)).map((paper) => paper.id));
  return {
    exported: { at: iso(at), by: nameOn(screening, me), ...(hidden.votes ? { left_out: `${hidden.votes} votes on ${hidden.papers} papers, hidden from ${nameOn(screening, me)} until they vote on them` } : {}) },
    screening: {
      id: screening.id,
      name: screening.name,
      question: screening.question,
      workspace: workspaceOf(screening).name,
      started_by: nameOn(screening, screening.createdBy),
      started_at: iso(screening.createdAt),
      finished_at: screening.finishedAt ? iso(screening.finishedAt) : null,
      checks_for_new_papers: screening.living ? EVERY_LABEL[screening.living.every] : null,
      rule: { people_on_each_paper: rule.each === "all" ? "Everyone" : Number(rule.each), settled_when: SETTLE_LABEL[rule.settle], conflicts_settled_by: rule.settle === "one" ? null : nameOn(screening, rule.resolver), other_votes_seen: rule.blind === "after" ? "After you vote" : "At any time" },
      counts: state.counts,
    },
    criteria: criteria.map((criterion, i) => ({ number: i + 1, key: criterion.key, short_name: criterion.short, question: criterion.text, must_have: criterion.must, guidance: criterion.note ?? null, added_at: iso(criterion.addedAt) })),
    reviewers: votingReviewers(screening).map((reviewer) => ({ id: reviewer.id, name: reviewer.name, kind: reviewer.kind === "model" ? "AI model" : "Person", added_at: iso(reviewer.addedAt), taken_off_at: reviewer.left ? iso(reviewer.left) : null })),
    sources: screening.sources.map((source) => ({ id: source.id, kind: source.kind, name: source.name, found: taken(source), after_duplicates: keptOf(source) })),
    papers: paperRows(out, state.papers).map((row, i) => ({ ...row, source_id: state.papers[i]!.source })),
    // The votes that were cast, each with what a model read for its answers and how sure it was.
    votes: voteRows(out, state.papers).flatMap(({ paper, reviewer, vote }) => (vote ? [{
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
    without_a_vote: voteRows(out, state.papers).flatMap(({ paper, reviewer, vote, status }) => (vote ? [] : [{ paper_id: paper.id, reviewer_id: reviewer.id, status }])),
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
