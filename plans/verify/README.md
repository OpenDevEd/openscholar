# Verify: check what a paper is built on

Milestone OS-22. Workflow rules live in the root `AGENTS.md` and
`docs/agents/project.md`. This file holds the decisions, the design, what it
reuses, the order and the risks.

## Problem

A paper's conclusions are only as good as what they rest on. A meta-analysis
pools studies; an umbrella review pools meta-analyses; any paper leans on what
it cites. Nothing in OpenScholar tells a reader whether those foundations hold.
The user's example: an AI-made graph of 4 umbrella-level reviews, 26
meta-analyses and 57 primary studies in AI in education, each judged validated,
repairable, questionable, broken or unverifiable, where most reviews rest on at
least one broken study.

Screening and extraction answer "what does the literature say". Verify answers
"should I believe it".

## Decisions (2026-10-12, the user)

- An OpenScholar feature called **Verify**, a step in the rail between Extract
  and Publish. Pro and Team only.
- **A check starts from any paper and is run by AI agents, not a fixed
  pipeline.** The user: "AI is smart, we don't need a set course." Each agent
  decides what its paper claims, what to follow and what to check, and gives
  the verdict.
- PDFs are read the way the assistant reads them (the PDF itself, pages as text
  and image, page ranges), not through extraction's passage search.
- A paper's verdict is stored once and is public: shown wherever the paper
  appears in OpenScholar (search, library, focus mode, the assistant), and
  readable from anywhere, signed in or not, the way any public Convex query
  already is. Starting a check and following its progress are user actions,
  signed in like every other one. No separate API.
- Everyone pays the same. A paper that already has a stored reading is charged
  at that reading's stored price. Storing saves time, not money.
- A later reading replaces the public verdict when the average intelligence
  index of the models that made it is higher.
- No manual overrides of a verdict.
- Supplements (the separate files journals publish beside an article) are not
  fetched from publisher sites. A check carries on without them; an upload
  later fills the gap.
- The first verdict rubric, the depth and the default cap are left to the
  implementer, and set below.

## What others found

- PaperQA2 (FutureHouse) splits the model that picks tools from a cheaper model
  that summarises evidence in bulk, and added citation traversal to raise
  recall. Its open-source repo doesn't include traversal.
- otto-SR reproduced 12 Cochrane reviews with an agent workflow, with human
  checks of its output.
- SPOT (2025): on 83 papers with known errata or retractions, no model passed
  21.1% recall or 6.1% precision at finding the error, and runs rarely found
  the same errors twice. A later preprint reports far better results with
  repeated runs and a looser grader.

So open-ended "find what's wrong" is where agents fail: false alarms, and
verdicts that change between runs. Checks with a definite answer (is this
number in this table, is this paper retracted, does this mean fit this sample)
are where they are reliable. The design leans on the second kind and puts every
damning finding through a second, independent look.

## Design

### One agent per paper

A check is a tree of papers. Each paper in it gets one agent: a reasoning model
in a loop with tools, on the assistant's runtime (`@convex-dev/agent`, one
agent thread per paper). The agent is told its paper, who cites it in this
tree and what they say it supports, and the verdict labels.

Tools:

| Tool | What it does | Built from |
|---|---|---|
| `read_pages` | Pages of the paper's PDF, 20 at a time, as PDF | `research/papers:readPdf`, `convex/assistant/files.ts` page cuts, `convex/lib/paperPdfs.ts` |
| `outline` | The paper's text from pdf.js with page numbers, free, to find which pages to read | `convex/extraction/pdfjs_extract.ts` |
| `find_work` | A citation to an OpenAlex work: DOI, then title search, then Crossref's bibliographic search | new; OpenAlex client in `convex/paperSets/openalex.ts` |
| `paper_facts` | OpenAlex record: type, retraction, references count | OpenAlex client |
| `decide` | Typed questions over many texts at once on Jev, such as which of 150 references are studies cited as evidence | `lib/ai/decisions.ts` |
| `check_numbers` | GRIM (is a mean possible for this sample), p from a test statistic (statcheck), an effect size from means and SDs, re-pooling a meta-analysis with or without some studies | new, plain code |
| `follow` | Adds a cited paper to the tree with what this paper says it supports; the agent's paper waits for its verdict | new |
| `record_finding` | A finding with its quote and page | new; quote anchoring from `convex/extraction/evidence_units.ts` |
| `conclude` | The verdict, its reasons and the findings it rests on | new |

Code enforces only what an agent can't be trusted with:

- A finding's quote must be found in the paper's text. One that isn't is
  refused and the agent is told.
- A finding that would make a paper broken or questionable counts only after a
  second agent call with a fresh context, given just the finding and its pages,
  confirms it (the SPOT result above).
- One agent per paper per tree. Two agents following the same paper share it.
- Following a paper that's already above you in the tree returns at once, so a
  citation loop never deadlocks.
- The credit cap.

### Verdict labels

From the user's graph. The agent's prompt defines them:

| Label | Meaning |
|---|---|
| validated | What the paper claims holds, and its numbers check out |
| validated with caveats | Holds, with minor problems that don't change its conclusions |
| repairable | Rests on some broken inputs, but its conclusion survives without them |
| questionable | Serious doubts that couldn't be settled either way |
| broken | Retracted, impossible numbers, numbers that aren't in its sources, or a conclusion that falls without its broken inputs |
| unverifiable | Couldn't be read: no PDF, no match for the citation |
| pending | Being read |
| unassessed | Found but not read, because the cap or the depth was reached |

### Models

- **The agent** runs on the workspace's preset, through a new cloud task
  `verify` in `lib/ai/tasks.ts`, limited to models that read PDFs, call tools
  and give structured output.
- **Jev** answers `decide`.
- **Arithmetic** is code, through `check_numbers`.
- **Reuse rule.** A paper with a stored verdict is reused when the stored
  verdict's average intelligence index (`models.intelligenceIndex`) is at least
  the check's model's. Otherwise it's read again, and the new verdict replaces
  the public one when its index is higher. A model with no index never replaces
  one that has an index.

### Running in parallel

Copied from extraction's queue and Screen all:

- `verifyTasks`, one row per agent turn, leased with a run epoch, like
  `extractionPaperQueue`.
- A Workpool of its own (`verifyWorkpool`) so checks don't slow screening or
  extraction. Free capacity goes to a workspace's oldest check first, up to the
  plan's `concurrency` (`refillWorkspace` in
  `convex/extraction/queue/dispatcher.ts`, Firecrawl's rule).
- Workers write only their own rows. One batch worker
  (`@convex-dev/batch-worker`) updates each check's counts and refills, as
  `convex/screening/bookkeeping.ts` does.
- An agent that followed papers ends its turn. When the last of them concludes,
  its next turn is queued once, the way a chat hears that its job ended
  (`convex/assistant/jobEnds.ts`).
- A paper being read for one check is not read again by another check at the
  same time: the second waits for the first's verdict, and pays its stored
  price.
- An agent turn that reads many pages can take minutes. Turns are bounded so
  each fits within Convex's 10-minute action limit, and leases are longer than
  extraction's 60 seconds.
- Shallower papers are served first, so a check that hits its cap leaves its
  deepest papers unread.

### Credits

One approval with a cap, one Autumn hold, a ledger row per call under the hold,
settled once: the flow from one approval (#630) and the assistant's extraction
start. Each agent's tool results say how many credits are left. At the cap,
running agents get one last turn to conclude with what they have, and unread
papers become unassessed. A reused verdict writes its stored price to the
ledger.

### Defaults

- **Depth:** the agents decide. A ceiling of 4 levels below the starting paper
  stops a runaway tree.
- **Cap:** the person sets it on the approval. The suggested figure comes from
  the starting paper's reference count and the cost per paper measured in
  slice 1.

### Where verdicts show

- The Verify page: a check's tree as a graph, and a paged list with sort,
  a filter by verdict and an open button per paper.
- A badge on every paper card with a verdict: search, library, collections,
  focus mode, the assistant's paper chips. Opens the verdict with its reasons
  and quotes.
- Starting a check: a paper card's menu, focus mode, and the assistant, as a
  registered user action (`convex/lib/userActionRegistry.ts`).
- Anywhere else: a public query, `verify/verdicts:get`, OpenAlex IDs in (at
  most 100), verdicts out, needing no sign-in. Any public Convex query is
  already callable over HTTP (`POST <convex url>/api/query` with its path and
  arguments) or with a Convex client; on 2026-10-12 `models/queries:list` was
  read from shared dev with plain `curl`. Evidence Libraries read verdicts
  this way, and the library's record page shows the badge and the graph (a
  new-el issue in an EL milestone).

## Data

New tables, nothing migrated:

- `verifyChecks`: workspace, starting paper, cap, hold, status, counts.
- `verifyPapers`: one per OpenAlex work, shared by every workspace. Its current
  public verdict, reasons, findings with quotes and pages, models and their
  average intelligence index, price, how deep the reading went, when.
- `verifyNodes`: one per (check, work): its `verifyPapers` reading, agent
  thread, status.
- `verifyLinks`: one per (check, citing node, cited node): what the citing
  paper says the cited one supports.
- `verifyTasks`: the queue.

`verifyPapers` holds only facts about public papers, never who asked.

## Order

1. **Measure before building (no UI).** The agent and its tools as a script
   against shared dev's models, on the user's example tree. Measure cost per
   paper, time per check, agreement with the example graph (itself AI-made, so
   a comparison only) and with known retractions and corrected meta-analyses,
   and whether two runs agree. Report the numbers before slice 2.
2. **Backend.** Tables, queue, Workpool, agent runtime, the second look,
   credits, the user action for the assistant.
3. **Public verdicts.** Reuse and replacement, the public query.
4. **UI.** A mock first, on real data: the rail item, the Verify page with its
   graph and list, badges, the start points. Then the build.
5. **new-el.** Badge and graph on library records, from the route.

## Checks

- Slice 1: the measured report.
- Slice 2: tests for the parts with fixed answers (quote refusal, one agent
  per paper, the cycle return, the cap); a 100-paper check on the e2e backend
  with the load-test recipe from OS-18.
- Slices 3 and 4: `npm run verify -- shift` on every page touched, a live
  check on shared dev on the Cheap preset.
- Slice 5: new-el's own gates, then updating AIED, TVET and ECCAR.

## Risks

- False alarms. The second look reduces them; slice 1 measures how many
  remain.
- Paywalled papers and missing supplements leave nodes unverifiable.
- Verdicts can change between runs. The replacement rule only promotes better
  models; two runs on the same model can still disagree.
- Cost. About 3,000 input tokens a PDF page (the assistant's figure); a tree
  like the example is about 85 papers.
- Public verdicts about named papers are a reputational risk for the
  product: every shown verdict carries its reasons and quotes.
