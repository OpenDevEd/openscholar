import { bareWork } from "../openalex/ids";

const WORK_PARAMS = ["cites", "citedBy", "rel"];
const RESULTS_PAGE = /\/results(?:\/[^/]+)?$/;

/** A results link from before citation filters held IDs, with its paper addresses as IDs. Null when it has none, so it can't redirect to itself. */
export function bareWorkLink<Url extends URL>(url: Url): Url | null {
  if (!RESULTS_PAGE.test(url.pathname)) return null;
  const given = WORK_PARAMS.flatMap((param) => {
    const value = url.searchParams.get(param);
    return value && bareWork(value) !== value ? [[param, bareWork(value)] as const] : [];
  });
  if (!given.length) return null;
  const bare = new URL(url) as Url;
  for (const [param, value] of given) bare.searchParams.set(param, value);
  return bare;
}
