// Reads the library's own data (collections, institutions, reviewed
// publications, home page questions) through the
// runtime's OpenScholar read API, using the library's machine credential.

export const RUNTIME_READ_PAGE_SIZE = 50;
const REQUEST_TIMEOUT_MS = 15_000;

export type RuntimeCollection = {
  id: string;
  title: string;
  count: number;
  source: string;
  parentId: string | null;
  /** True when a live collection sits under this one. Only those render on the site. */
  hasChildren: boolean;
};

export type RuntimeCollectionsPage = {
  items: RuntimeCollection[];
  nextCursor: string | null;
};

export type RuntimeInstitution = { name: string; count: number };

/** What the library knows about one collection the owner already shows. */
export type RuntimeCollectionFacts = {
  id: string;
  title: string;
  source: string;
  count: number;
};

/** Ascending or descending, as the library orders a list. */
export type RuntimeSortDirection = "asc" | "desc";

/** How the library orders institutions: most records first, or by name. */
export type RuntimeInstitutionSort = "count" | "name";

export type RuntimeInstitutionsPage = {
  items: RuntimeInstitution[];
  nextCursor: string | null;
};

/**
 * A publication with a PDF the home timeline can follow. When `reviewed`,
 * `publishedAt` is the approval and `reviewer` the approver's Clerk user id;
 * otherwise `publishedAt` is when it was added and `reviewer` is empty.
 */
export type RuntimeReviewedPublication = {
  key: string;
  title: string;
  publishedAt: string;
  reviewer: string;
  reviewed: boolean;
};

export type RuntimeReviewedPublicationsPage = {
  items: RuntimeReviewedPublication[];
  nextCursor: string | null;
};

export class RuntimeReadError extends Error {
  constructor(
    readonly code:
      | "RUNTIME_READ_REFUSED"
      | "RUNTIME_READ_INVALID"
      | "RUNTIME_READ_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "RuntimeReadError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCollection(value: unknown): RuntimeCollection | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.count !== "number" ||
    typeof value.source !== "string" ||
    (value.parentId !== null && typeof value.parentId !== "string") ||
    typeof value.hasChildren !== "boolean"
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    count: value.count,
    source: value.source,
    parentId: value.parentId ?? null,
    hasChildren: value.hasChildren,
  };
}

// The ids answer carries the same rows as a page of the catalogue.
function readCollectionFacts(value: unknown): RuntimeCollectionFacts | null {
  const collection = readCollection(value);
  return collection
    ? {
        id: collection.id,
        title: collection.title,
        source: collection.source,
        count: collection.count,
      }
    : null;
}

function readInstitution(value: unknown): RuntimeInstitution | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.count !== "number"
  ) {
    return null;
  }
  return { name: value.name, count: value.count };
}

function readReviewedPublication(
  value: unknown,
): RuntimeReviewedPublication | null {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.title !== "string" ||
    typeof value.publishedAt !== "string" ||
    Number.isNaN(Date.parse(value.publishedAt)) ||
    typeof value.reviewer !== "string"
  ) {
    return null;
  }
  return {
    key: value.key,
    title: value.title,
    publishedAt: value.publishedAt,
    reviewer: value.reviewer,
    // Older libraries list only what editors approved, without saying so.
    reviewed: typeof value.reviewed === "boolean" ? value.reviewed : true,
  };
}

async function runtimeGet(
  fetchImpl: typeof fetch,
  target: { baseUrl: string; credential: string },
  path: string,
  params: Record<string, string | undefined>,
): Promise<unknown> {
  const url = new URL(path, target.baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: {
        Authorization: `Bearer ${target.credential}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new RuntimeReadError(
      "RUNTIME_READ_UNAVAILABLE",
      `The library did not answer: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new RuntimeReadError(
      "RUNTIME_READ_REFUSED",
      "The library refused the machine credential",
    );
  }
  if (!response.ok) {
    throw new RuntimeReadError(
      "RUNTIME_READ_UNAVAILABLE",
      `The library answered ${response.status}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new RuntimeReadError(
      "RUNTIME_READ_INVALID",
      "The library did not answer with JSON",
    );
  }
}

/**
 * One page of a list answer. A library that answers without `nextCursor`
 * has given its whole list, so the page is the only one.
 */
function readPage<T>(
  body: unknown,
  readItem: (value: unknown) => T | null,
  what: string,
): { items: T[]; nextCursor: string | null } {
  const items =
    isRecord(body) && Array.isArray(body.items)
      ? body.items.map(readItem)
      : null;
  const nextCursor = isRecord(body) ? body.nextCursor : undefined;
  if (
    !items ||
    items.some((item) => item === null) ||
    (nextCursor !== undefined &&
      nextCursor !== null &&
      typeof nextCursor !== "string")
  ) {
    throw new RuntimeReadError(
      "RUNTIME_READ_INVALID",
      `The library's ${what} has an unexpected shape`,
    );
  }
  return {
    items: items as T[],
    nextCursor: typeof nextCursor === "string" ? nextCursor : null,
  };
}

export async function readRuntimeCollections(
  fetchImpl: typeof fetch,
  input: {
    baseUrl: string;
    credential: string;
    query?: string;
    cursor?: string;
  },
): Promise<RuntimeCollectionsPage> {
  const body = await runtimeGet(
    fetchImpl,
    input,
    "/api/openscholar/collections",
    {
      query: input.query,
      cursor: input.cursor,
      pageSize: String(RUNTIME_READ_PAGE_SIZE),
    },
  );
  return readPage(body, readCollection, "collection list");
}

export async function readRuntimeInstitutions(
  fetchImpl: typeof fetch,
  input: {
    baseUrl: string;
    credential: string;
    query?: string;
    cursor?: string;
    sort?: RuntimeInstitutionSort;
    direction?: RuntimeSortDirection;
  },
): Promise<RuntimeInstitutionsPage> {
  const body = await runtimeGet(
    fetchImpl,
    input,
    "/api/openscholar/institutions",
    {
      query: input.query,
      cursor: input.cursor,
      sort: input.sort,
      direction: input.direction,
      pageSize: String(RUNTIME_READ_PAGE_SIZE),
    },
  );
  return readPage(body, readInstitution, "institution list");
}

/** The most ids one call may ask about, as the runtime allows. */
export const RUNTIME_RESOLVE_MAX_IDS = 200;
/**
 * The most collections a site can show, from the pinned configuration
 * schema (`/properties/collections`, `maxItems`). Asking about more than
 * that is a mistake, not a long list.
 */
export const RUNTIME_RESOLVE_MAX_TOTAL_IDS = 500;

/**
 * The names and record counts of collections the owner already shows.
 * `ids` is the only parameter the library accepts here; it answers the rows
 * it knows and leaves the rest out. A library that does not read `ids` yet
 * answers with its own first page, and only rows that were asked for are
 * kept, so the page falls back to the id instead of showing the wrong name.
 */
export async function readRuntimeCollectionsByIds(
  fetchImpl: typeof fetch,
  input: { baseUrl: string; credential: string; ids: readonly string[] },
): Promise<{ items: RuntimeCollectionFacts[] }> {
  if (input.ids.length === 0) return { items: [] };
  // Asking for more than the library allows would quietly lose the rest, so
  // the caller has to split the list itself.
  if (input.ids.length > RUNTIME_RESOLVE_MAX_IDS) {
    throw new Error(
      `Ask the library about at most ${RUNTIME_RESOLVE_MAX_IDS} collections at a time`,
    );
  }
  const body = await runtimeGet(
    fetchImpl,
    input,
    "/api/openscholar/collections",
    {
      ids: input.ids.join(","),
    },
  );
  const rows =
    isRecord(body) && Array.isArray(body.items)
      ? body.items.map(readCollectionFacts)
      : null;
  if (!rows || rows.some((row) => row === null)) {
    throw new RuntimeReadError(
      "RUNTIME_READ_INVALID",
      "The library's collection list has an unexpected shape",
    );
  }
  // A library that does not read `ids` answers with its own first page, so
  // only the rows that were asked for are kept.
  const asked = new Set(input.ids);
  return {
    items: (rows as RuntimeCollectionFacts[]).filter((row) =>
      asked.has(row.id),
    ),
  };
}

/**
 * One page of the publications editors approved, newest first. With `ids`
 * the library answers just those publications; it does not combine them
 * with a search or a cursor.
 */
export async function readRuntimeReviewedPublications(
  fetchImpl: typeof fetch,
  input: {
    baseUrl: string;
    credential: string;
    query?: string;
    cursor?: string;
    ids?: readonly string[];
  },
): Promise<RuntimeReviewedPublicationsPage> {
  const body = await runtimeGet(
    fetchImpl,
    input,
    "/api/openscholar/reviewed-publications",
    input.ids
      ? { ids: input.ids.join(",") }
      : {
          query: input.query,
          cursor: input.cursor,
          pageSize: String(RUNTIME_READ_PAGE_SIZE),
        },
  );
  return readPage(body, readReviewedPublication, "reviewed publication list");
}

/**
 * The questions the home page asks when the owner leaves a slot empty, one
 * per slot. `null` means the library has nothing to ask in that slot.
 */
export async function readRuntimeHomeQuestions(
  fetchImpl: typeof fetch,
  target: { baseUrl: string; credential: string },
): Promise<(string | null)[]> {
  const body = await runtimeGet(
    fetchImpl,
    target,
    "/api/openscholar/home-questions",
    {},
  );
  const questions =
    isRecord(body) && Array.isArray(body.questions) ? body.questions : null;
  if (
    !questions ||
    questions.some((question) => question !== null && typeof question !== "string")
  ) {
    throw new RuntimeReadError(
      "RUNTIME_READ_INVALID",
      "The library's home page questions have an unexpected shape",
    );
  }
  return questions as (string | null)[];
}
