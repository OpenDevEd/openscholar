/**
 * The link to each record a read returns, written the way a reply writes it: `[name](address)`.
 * The model copies `link` instead of putting the link together from an ID and a page, which a
 * weaker model leaves out, so the person sees an address where a chip should be.
 */
type Row = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
/** A paper's page on OpenAlex, from its ID in either form. */
const paperUrl = (id: unknown) => {
  const value = text(id);
  if (!value) return undefined;
  if (/^https:\/\/openalex\.org\/W\d+$/i.test(value)) return value;
  return /^W\d+$/i.test(value) ? `https://openalex.org/${value.toUpperCase()}` : undefined;
};

/** A saved search's page. An imported search keeps its outside ID, which may hold a `/`, a space or a bracket. */
const searchUrl = (id: string) => `/results/${encodeURIComponent(id).replace(/[()]/g, (bracket) => `%${bracket.charCodeAt(0).toString(16).toUpperCase()}`)}`;

/** Each kind of record: its address, and what names it. */
const KINDS = {
  // A search with no query yet is named by its questions, as the @ picker names it.
  search: { href: (row: Row) => text(row.id) && searchUrl(row.id as string), name: (row: Row) => text(row.query) ?? row.questionText },
  collection: { href: (row: Row) => text(row._id) && `/library?col=${row._id}`, name: (row: Row) => row.name },
  extraction: { href: (row: Row) => text(row._id) && `/extraction/${row._id}`, name: (row: Row) => row.name },
  screening: { href: (row: Row) => text(row._id) && `/screening?job=${row._id}`, name: (row: Row) => row.name ?? row.label ?? "Screening" },
  chat: { href: (row: Row) => text(row._id) && `/?chat=${row._id}`, name: (row: Row) => row.title },
  // A library paper's row has its paper ID in `id`; other reads call it `openalexId`.
  paper: { href: (row: Row) => paperUrl(row.openalexId ?? row.id), name: (row: Row) => row.title },
} satisfies Record<string, { href: (row: Row) => string | undefined; name: (row: Row) => unknown }>;
type Kind = keyof typeof KINDS;

/** The reads whose records come with a link, and what kind they are. */
const READS: Record<string, Kind> = {
  "research/records:listedSearches": "search",
  "research/records:getSearch": "search",
  "library/collections:listCollections": "collection",
  "library/collections:getCollection": "collection",
  "library/queries:papers": "paper",
  "library/queries:savedPaper": "paper",
  "extraction/queries:listJobs": "extraction",
  "extraction/queries:getJobDetails": "extraction",
  "screening/queries:listJobs": "screening",
  "screening/queries:getScreeningJob": "screening",
  "assistant/threads:list": "chat",
  "assistant/threads:get": "chat",
};

/** The page a step's card opens, for a change or a read of one record it names by ID: the job it stopped, paused or read the cost of. One it deleted has none. */
const OPENS: Record<string, (args: Row) => string | undefined> = {
  "extraction/mutations:cancelExtraction": (args) => KINDS.extraction.href({ _id: args.jobId }),
  "extraction/mutations/pause:pauseExtraction": (args) => KINDS.extraction.href({ _id: args.jobId }),
  "extraction/mutations/resume:resumeExtraction": (args) => KINDS.extraction.href({ _id: args.jobId }),
  "extraction/start:resume": (args) => KINDS.extraction.href({ _id: args.jobId }),
  "extraction/start:retry": (args) => KINDS.extraction.href({ _id: args.jobId }),
  "extraction/queries/costs:getJobCost": (args) => KINDS.extraction.href({ _id: args.jobId }),
  "screening/mutations:cancelScreeningJob": (args) => KINDS.screening.href({ _id: args.jobId }),
  // An Evidence Library's settings, on its configuration page.
  "evidenceLibraries/assistant:draft": (args) => (typeof args.libraryId === "string" ? `/evidence-libraries/${args.libraryId}/configuration` : undefined),
  "evidenceLibraries/assistant:editDraft": (args) => (typeof args.libraryId === "string" ? `/evidence-libraries/${args.libraryId}/configuration` : undefined),
  "evidenceLibraries/assistant:team": (args) => (typeof args.libraryId === "string" ? `/evidence-libraries/${args.libraryId}/configuration` : undefined),
  "evidenceLibraries/assistant:invite": (args) => (typeof args.libraryId === "string" ? `/evidence-libraries/${args.libraryId}/configuration` : undefined),
  "evidenceLibraries/assistant:sources": (args) => (typeof args.libraryId === "string" ? `/evidence-libraries/${args.libraryId}/configuration` : undefined),
  "evidenceLibraries/assistant:runningCollections": (args) => (typeof args.libraryId === "string" ? `/evidence-libraries/${args.libraryId}/configuration` : undefined),
  "evidenceLibraries/assistant:runningInstitutions": (args) => (typeof args.libraryId === "string" ? `/evidence-libraries/${args.libraryId}/configuration` : undefined),
  "evidenceLibraries/assistant:runningPublications": (args) => (typeof args.libraryId === "string" ? `/evidence-libraries/${args.libraryId}/configuration` : undefined),
  "evidenceLibraries/assistant:runningPublication": (args) => (typeof args.libraryId === "string" ? `/evidence-libraries/${args.libraryId}/configuration` : undefined),
  "evidenceLibraries/assistant:syncSource": (args) => (typeof args.libraryId === "string" ? `/evidence-libraries/${args.libraryId}/configuration` : undefined),
  "evidenceLibraries/assistant:invitations": () => "/evidence-libraries?view=invitations",
  // A research area, by its topic ID as the read checked it.
  "research/topics:get": (args) => (typeof args.id === "string" && /^T[1-9]\d*$/i.test(args.id.trim()) ? `/topics/${args.id.trim().toUpperCase()}` : undefined),
};
/** The page a step's card opens, from its action and its arguments as JSON (`OPENS`). */
export function opensOf(path: string, input: string): string | undefined {
  const open = OPENS[path];
  if (!open) return undefined;
  try {
    const args: unknown = JSON.parse(input);
    return args && typeof args === "object" ? open(args as Row) || undefined : undefined;
  } catch {
    // Arguments too long to keep whole were cut, and don't parse.
    return undefined;
  }
}

/** What a link says: the record's name on one line, short, with markdown's own characters escaped so it reads as text, in a table cell too. */
export function linkLabel(name: string) {
  const line = name.replace(/\s+/g, " ").trim();
  const short = line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
  return short.replace(/[\\[\]*_`|]/g, (character) => `\\${character}`);
}

function withLink(row: unknown, kind: Kind): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const { href, name } = KINDS[kind];
  const address = href(row as Row);
  const label = text(name(row as Row));
  return address && label ? { ...row, link: `[${linkLabel(label)}](${address})` } : row;
}

/** A mention the @ picker found: each kind of its own. */
const MENTIONS: Record<string, (id: string) => string> = {
  search: searchUrl,
  collection: (id) => `/library?col=${id}`,
  paper: (id) => paperUrl(id) ?? "",
};

/**
 * `result` with a link on each record it holds: the record itself, each row of its page, each
 * of its papers, or its job. A read of anything else comes back as it was.
 */
export function linked(path: string, result: unknown): unknown {
  if (path === "assistant/mentions:find" && Array.isArray(result)) {
    return result.map((row) => {
      const { kind, id, label } = row as { kind?: string; id?: string; label?: string };
      const address = kind && id ? MENTIONS[kind]?.(id) : undefined;
      return address && text(label) ? { ...row, link: `[${linkLabel(label!)}](${address})` } : row;
    });
  }
  const kind = READS[path];
  if (!kind || !result || typeof result !== "object") return result;
  if (Array.isArray(result)) return result.map((row) => withLink(row, kind));
  const holder = result as Row;
  return {
    ...(withLink(holder, kind) as Row),
    ...(Array.isArray(holder.page) ? { page: holder.page.map((row) => withLink(row, kind)) } : {}),
    ...(Array.isArray(holder.papers) ? { papers: holder.papers.map((row) => withLink(row, kind)) } : {}),
    ...(holder.job && typeof holder.job === "object" ? { job: withLink(holder.job, kind) } : {}),
  };
}
