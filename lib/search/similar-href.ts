import { workId } from "../openalex/ids";

/** The address of a search for the papers closest in meaning to these, on our index. Only works it can name count; null when there are none, since a search with no papers would list everything. */
export function similarSearchHref(paperIds: readonly string[]) {
  const works = [...new Set(paperIds.flatMap((id) => workId(id) ?? []))].slice(0, 100);
  return works.length ? `/results?like=${works.join(",")}` : null;
}
