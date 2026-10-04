// MOCK ONLY, for the author filter (draft PR #465). The shared backend doesn't know a
// search's `authors` yet and rejects any change that carries the field. Until that PR is
// merged, a signed-in search's authors are kept in this browser instead: taken out of
// everything sent to the backend, and put back onto each search read from it. So the
// filter works and a search remembers it, but only in this browser. Delete this file and
// its uses (lib/research/session.ts, migrate.ts, search-list.ts) once the backend has the field.

const KEY = "mock-author-filter";

function kept(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function keep(change: (authors: Record<string, string[]>) => void) {
  const authors = kept();
  change(authors);
  try {
    localStorage.setItem(KEY, JSON.stringify(authors));
  } catch (error) {
    console.warn("The mock author filter could not be kept in the browser", error);
  }
}

const strip = <T,>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (key, part) => {
      if (key === "authors") return undefined;
      if (key === "clear" && Array.isArray(part)) return part.filter((name) => name !== "authors");
      return part;
    }),
  ) as T;

type Sent = {
  command?: {
    kind: string;
    id?: string;
    search?: { id: string; authors?: string[] };
    edit?: { kind: string; from?: string; fields?: { authors?: string[] }; clear?: string[] };
  };
};

/** What is sent to the backend, without any search's authors; they are kept here first. */
export function withoutAuthors<T>(sent: T): T {
  const command = (sent as Sent).command;
  if (command?.kind === "createSearch" && command.search?.authors?.length) {
    const { id, authors } = command.search;
    keep((all) => { all[id] = authors; });
  }
  if (command?.kind === "editSearch" && command.id && command.edit) {
    const { id, edit } = command;
    const source = edit.kind === "copySearch" && edit.from ? kept()[edit.from] : undefined;
    const authors = edit.fields?.authors ?? source;
    if (authors?.length) keep((all) => { all[id] = authors; });
    else if (edit.fields && "authors" in edit.fields || edit.clear?.includes("authors")) keep((all) => { delete all[id]; });
  }
  if (command?.kind === "deleteSearch" && command.id) {
    const { id } = command;
    keep((all) => { delete all[id]; });
  }
  if (command?.kind === "clearSearches") keep((all) => { for (const id of Object.keys(all)) delete all[id]; });
  return strip(sent);
}

/** A search read from the backend, with the authors kept for it here. */
export function withAuthors<S extends { id: string; authors?: string[] }>(search: S): S {
  const authors = search.authors ?? kept()[search.id];
  return authors?.length ? { ...search, authors } : search;
}
