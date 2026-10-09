#!/usr/bin/env node

// Keeps the OpenScholar project board (OpenDevEd project 4) in step with the
// work in openalex-count and new-el, as the shared AGENTS.md asks: closed
// issues are Done, an issue an open pull request closes is In review, an issue
// in progress carries the current sprint, every open issue is on the board with
// a status, and a milestone whose issues are all closed is closed. Issues in
// progress with no activity for a week, and running out of sprints, are
// reported.
//
//   GH_TOKEN=<token with project and issue access> node scripts/board-upkeep.mjs [--dry-run]
//
// CI runs it as the "OpenDevEd board upkeep" GitHub App (.github/workflows/board-upkeep.yml).

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const OWNER = "OpenDevEd";
const PROJECT = 4;
const REPOS = ["openalex-count", "new-el"];
const STALE_DAYS = 7;
// An issue moves to In review from these; never out of Done or Blocker.
const BEFORE_REVIEW = new Set(["Backlog", "Ready", "In progress", null]);

const DAY = 86_400_000;
const key = (repo, number) => `${repo}#${number}`;

/** What to change on the board, from what the board and the repositories hold now. */
export function planChanges({ items, openIssues, inReview, milestones, iterations, today }) {
  const review = new Set(inReview);
  const now = Date.parse(`${today}T00:00:00Z`);
  const current = iterations.find((sprint) => {
    const start = Date.parse(`${sprint.startDate}T00:00:00Z`);
    return start <= now && now < start + sprint.duration * DAY;
  });
  const plan = { status: [], sprint: [], add: [], closeMilestones: [], stale: [], needsSprints: false };

  for (const item of items) {
    const issue = key(item.repo, item.number);
    if (item.state === "CLOSED") {
      if (item.status !== "Done") plan.status.push({ itemId: item.itemId, issue, to: "Done" });
      continue;
    }
    if (item.status === "In progress" && !item.sprintId && current) plan.sprint.push({ itemId: item.itemId, issue, iterationId: current.id });
    if (review.has(issue) && BEFORE_REVIEW.has(item.status)) plan.status.push({ itemId: item.itemId, issue, to: "In review" });
    // An issue added without a status, including one whose status write failed after it was added.
    else if (item.status === null) plan.status.push({ itemId: item.itemId, issue, to: "Backlog" });
    else if (item.status === "In progress" && now - Date.parse(item.lastActivity) > STALE_DAYS * DAY) plan.stale.push(issue);
  }

  const onBoard = new Set(items.map((item) => key(item.repo, item.number)));
  for (const open of openIssues) {
    if (!onBoard.has(key(open.repo, open.number))) plan.add.push({ contentId: open.contentId, issue: key(open.repo, open.number) });
  }

  for (const milestone of milestones) {
    if (milestone.open === 0 && milestone.closed > 0) plan.closeMilestones.push({ repo: milestone.repo, number: milestone.number, title: milestone.title });
  }

  plan.needsSprints = !iterations.some((sprint) => Date.parse(`${sprint.startDate}T00:00:00Z`) > now);
  return plan;
}

async function github(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "opendeved-board-upkeep",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 500)}`);
  const json = text ? JSON.parse(text) : null;
  if (json?.errors) throw new Error(`${path} answered errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
  return json;
}

const graphql = (query, variables = {}) => github("/graphql", { method: "POST", body: { query, variables } }).then((json) => json.data);

/** Every node of a GraphQL connection; `query` takes `$after` and `connection` finds the connection in its data. */
async function allNodes(query, variables, connection) {
  const nodes = [];
  for (let after = null; ; ) {
    const page = connection(await graphql(query, { ...variables, after }));
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return nodes;
    after = page.pageInfo.endCursor;
  }
}

async function readBoard() {
  const head = await graphql(
    `query($owner: String!, $number: Int!) { organization(login: $owner) { projectV2(number: $number) { id fields(first: 30) { nodes {
      ... on ProjectV2SingleSelectField { id name options { id name } }
      ... on ProjectV2IterationField { id name configuration { iterations { id startDate duration } } } } } } } }`,
    { owner: OWNER, number: PROJECT },
  );
  const project = head.organization.projectV2;
  const status = project.fields.nodes.find((field) => field.name === "Status");
  const sprint = project.fields.nodes.find((field) => field.name === "Sprint");
  const nodes = await allNodes(
    `query($id: ID!, $after: String) { node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes {
      id
      status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
      sprint: fieldValueByName(name: "Sprint") { ... on ProjectV2ItemFieldIterationValue { iterationId } }
      content { ... on Issue { number state updatedAt repository { name }
        closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { updatedAt } } } } } } } } }`,
    { id: project.id },
    (data) => data.node.items,
  );
  const items = [];
  for (const node of nodes) {
    const issue = node.content;
    if (!issue?.repository || !REPOS.includes(issue.repository.name)) continue;
    const times = [issue.updatedAt, ...issue.closedByPullRequestsReferences.nodes.map((pr) => pr.updatedAt)];
    items.push({
      itemId: node.id,
      repo: issue.repository.name,
      number: issue.number,
      state: issue.state,
      status: node.status?.name ?? null,
      sprintId: node.sprint?.iterationId ?? null,
      lastActivity: times.sort().at(-1),
    });
  }
  return { project, status, sprint, items };
}

async function readRepositories() {
  const openIssues = [];
  const inReview = [];
  const milestones = [];
  for (const repo of REPOS) {
    const issues = await allNodes(
      `query($owner: String!, $repo: String!, $after: String) { repository(owner: $owner, name: $repo) {
        issues(states: OPEN, first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id number } } } }`,
      { owner: OWNER, repo },
      (data) => data.repository.issues,
    );
    for (const issue of issues) openIssues.push({ repo, number: issue.number, contentId: issue.id });
    // ponytail: reads the first 100 issues each pull request closes; page them too if one ever closes more.
    const pulls = await allNodes(
      `query($owner: String!, $repo: String!, $after: String) { repository(owner: $owner, name: $repo) {
        pullRequests(states: OPEN, first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes {
          isDraft closingIssuesReferences(first: 100) { nodes { number repository { name } } } } } } }`,
      { owner: OWNER, repo },
      (data) => data.repository.pullRequests,
    );
    for (const pull of pulls) {
      if (pull.isDraft) continue;
      for (const issue of pull.closingIssuesReferences.nodes) inReview.push(key(issue.repository.name, issue.number));
    }
    for (let page = 1; ; page++) {
      const batch = await github(`/repos/${OWNER}/${repo}/milestones?state=open&per_page=100&page=${page}`);
      for (const milestone of batch) {
        milestones.push({ repo, number: milestone.number, title: milestone.title, open: milestone.open_issues, closed: milestone.closed_issues });
      }
      if (batch.length < 100) break;
    }
  }
  return { openIssues, inReview, milestones };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!process.env.GH_TOKEN) throw new Error("Set GH_TOKEN to a token that can edit the OpenDevEd project and both repositories' issues.");
  const { project, status, sprint, items } = await readBoard();
  const repositories = await readRepositories();
  const plan = planChanges({ items, ...repositories, iterations: sprint.configuration.iterations, today: new Date().toISOString().slice(0, 10) });
  const option = (name) => status.options.find((entry) => entry.name === name).id;
  const setField = (itemId, fieldId, value) =>
    graphql(
      `mutation($project: ID!, $item: ID!, $field: ID!, $value: ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: $value }) { projectV2Item { id } } }`,
      { project: project.id, item: itemId, field: fieldId, value },
    );

  const lines = [];
  for (const change of plan.status) {
    lines.push(`${change.issue}: Status -> ${change.to}`);
    if (!dryRun) await setField(change.itemId, status.id, { singleSelectOptionId: option(change.to) });
  }
  for (const change of plan.sprint) {
    lines.push(`${change.issue}: Sprint -> current`);
    if (!dryRun) await setField(change.itemId, sprint.id, { iterationId: change.iterationId });
  }
  for (const change of plan.add) {
    lines.push(`${change.issue}: added to the board as Backlog`);
    if (dryRun) continue;
    const added = await graphql(
      `mutation($project: ID!, $content: ID!) { addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } } }`,
      { project: project.id, content: change.contentId },
    );
    await setField(added.addProjectV2ItemById.item.id, status.id, { singleSelectOptionId: option("Backlog") });
  }
  for (const milestone of plan.closeMilestones) {
    lines.push(`${milestone.repo} milestone "${milestone.title}": closed, all its issues are closed`);
    if (!dryRun) await github(`/repos/${OWNER}/${milestone.repo}/milestones/${milestone.number}`, { method: "PATCH", body: { state: "closed" } });
  }
  const notes = [
    ...plan.stale.map((issue) => `${issue}: In progress with no activity for ${STALE_DAYS} days`),
    ...(plan.needsSprints ? ["No sprint starts after this one: add weekly sprints to the Sprint field."] : []),
  ];

  const report = [
    `Board upkeep${dryRun ? " (dry run)" : ""}: ${lines.length} change${lines.length === 1 ? "" : "s"}, ${items.length} issues on the board.`,
    ...lines.map((line) => `- ${line}`),
    ...(notes.length ? ["", "Needs a person:", ...notes.map((note) => `- ${note}`)] : []),
  ].join("\n");
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
