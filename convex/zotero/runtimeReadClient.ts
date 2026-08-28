// Reads the library's own data (collections, institutions) through the
// runtime's OpenScholar read API, using the library's machine credential.

export const RUNTIME_READ_CACHE_MS = 5 * 60 * 1000;
export const RUNTIME_READ_PAGE_SIZE = 50;
const REQUEST_TIMEOUT_MS = 15_000;

export type RuntimeCollection = {
  id: string;
  title: string;
  count: number;
  source: string;
  parentId: string | null;
};

export type RuntimeCollectionsPage = {
  items: RuntimeCollection[];
  nextCursor: string | null;
};

export type RuntimeInstitution = { name: string; count: number };

/** What the library knows about one collection the owner already shows. */
export type RuntimeCollectionFacts = {
  id: string;
  name: string;
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

export class RuntimeReadError extends Error {
  constructor(
    readonly code: "RUNTIME_READ_REFUSED" | "RUNTIME_READ_INVALID" | "RUNTIME_READ_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "RuntimeReadError";
  }
}

export function isFreshRuntimeRead(fetchedAt: number, now: number): boolean {
  return now - fetchedAt < RUNTIME_READ_CACHE_MS;
}

// One cache row per page: the search text, the cursor, the order and the
// ids all change which rows come back.
export function runtimeReadCacheKey(input: {
  query?: string;
  cursor?: string;
  sort?: string;
  direction?: string;
  ids?: readonly string[];
}): string {
  return JSON.stringify({
    query: input.query ?? "",
    cursor: input.cursor ?? "",
    sort: input.sort ?? "",
    direction: input.direction ?? "",
    ids: input.ids ? [...input.ids].sort() : [],
  });
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
    (value.parentId !== null && typeof value.parentId !== "string")
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    count: value.count,
    source: value.source,
    parentId: value.parentId ?? null,
  };
}

// The library answers ids with `name`; a library that has not learned about
// `ids` answers its own first page instead, whose rows carry `title`. Those
// rows are not answers to the question, so they are left out.
function readCollectionFacts(value: unknown): RuntimeCollectionFacts | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.count !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    source: typeof value.source === "string" ? value.source : "",
    count: value.count,
  };
}

function readInstitution(value: unknown): RuntimeInstitution | null {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.count !== "number") {
    return null;
  }
  return { name: value.name, count: value.count };
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
      headers: { Authorization: `Bearer ${target.credential}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new RuntimeReadError(
      "RUNTIME_READ_UNAVAILABLE",
      `The library did not answer: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new RuntimeReadError("RUNTIME_READ_REFUSED", "The library refused the machine credential");
  }
  if (!response.ok) {
    throw new RuntimeReadError("RUNTIME_READ_UNAVAILABLE", `The library answered ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new RuntimeReadError("RUNTIME_READ_INVALID", "The library did not answer with JSON");
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
  const items = isRecord(body) && Array.isArray(body.items) ? body.items.map(readItem) : null;
  const nextCursor = isRecord(body) ? body.nextCursor : undefined;
  if (
    !items ||
    items.some((item) => item === null) ||
    (nextCursor !== undefined && nextCursor !== null && typeof nextCursor !== "string")
  ) {
    throw new RuntimeReadError("RUNTIME_READ_INVALID", `The library's ${what} has an unexpected shape`);
  }
  return { items: items as T[], nextCursor: typeof nextCursor === "string" ? nextCursor : null };
}

export async function readRuntimeCollections(
  fetchImpl: typeof fetch,
  input: { baseUrl: string; credential: string; query?: string; cursor?: string },
): Promise<RuntimeCollectionsPage> {
  const body = await runtimeGet(fetchImpl, input, "/api/openscholar/collections", {
    query: input.query,
    cursor: input.cursor,
    pageSize: String(RUNTIME_READ_PAGE_SIZE),
  });
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
  const body = await runtimeGet(fetchImpl, input, "/api/openscholar/institutions", {
    query: input.query,
    cursor: input.cursor,
    sort: input.sort,
    direction: input.direction,
    pageSize: String(RUNTIME_READ_PAGE_SIZE),
  });
  return readPage(body, readInstitution, "institution list");
}

/** The most ids one call may ask about, as the runtime allows. */
export const RUNTIME_RESOLVE_MAX_IDS = 200;

/**
 * The names and record counts of collections the owner already shows.
 * A library that does not answer `ids` yet gives nothing back, so the page
 * falls back to the id instead of failing.
 */
export async function readRuntimeCollectionsByIds(
  fetchImpl: typeof fetch,
  input: { baseUrl: string; credential: string; ids: readonly string[] },
): Promise<{ items: RuntimeCollectionFacts[] }> {
  if (input.ids.length === 0) return { items: [] };
  const body = await runtimeGet(fetchImpl, input, "/api/openscholar/collections", {
    ids: input.ids.slice(0, RUNTIME_RESOLVE_MAX_IDS).join(","),
  });
  const asked = new Set(input.ids);
  const items = isRecord(body) && Array.isArray(body.items) ? body.items : null;
  if (!items) {
    throw new RuntimeReadError("RUNTIME_READ_INVALID", "The library's collection list has an unexpected shape");
  }
  return {
    items: items
      .map(readCollectionFacts)
      .filter((item): item is RuntimeCollectionFacts => item !== null && asked.has(item.id)),
  };
}
