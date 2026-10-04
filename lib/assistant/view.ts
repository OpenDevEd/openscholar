/**
 * Where a person is in the app when they send the assistant a message (#327): the page's
 * path, and the parameters of its address that say what it shows. The assistant reads it
 * with the message, and reads the page's records through its tools.
 */

/**
 * For each page, the parameters of its address that say what it shows: a record, a place
 * in a list, or how the list is narrowed. Nothing else in an address reaches a chat, so a
 * sign-in ticket or an invitation token in one never does. A page that isn't here keeps
 * its path alone, and one that gains a parameter is added here.
 */
const KEPT: ReadonlyArray<readonly [page: RegExp, parameters: readonly string[]]> = [
  [/^\/results\/[^/]+$/, ["page"]],
  [/^\/library$/, ["col", "q", "sort", "rmin", "rmax", "yf", "yt", "sf", "st"]],
  [/^\/screening$/, ["search", "job"]],
  [/^\/extraction\/new$/, ["step", "tab"]],
  [/^\/topics$/, ["q", "domain", "field", "subfield"]],
  [/^\/topics\/[^/]+$/, ["libraryQuery"]],
  [/^\/evidence-libraries$/, ["view"]],
  [/^\/evidence-libraries\/[^/]+\/configuration$/, ["section"]],
];
/** Characters of an address that is read at all, of a path, and of a parameter's value. */
const ADDRESS_MAX = 4_000;
const PATH_MAX = 200;
const VALUE_MAX = 80;

/**
 * A parameter's value as the model reads it. What would break out of the view's tag or
 * its list of parameters is percent-encoded, so two different values never read the same.
 * One cut short, by whole characters, ends in an ellipsis, so the start of a long search
 * isn't read as the whole of it.
 */
function shown(value: string) {
  const characters = [...value];
  const kept = characters.length > VALUE_MAX ? `${characters.slice(0, VALUE_MAX).join("")}…` : value;
  return kept.replace(/[<>&%\n\r\t]/g, encodeURIComponent);
}

/** A page's address as a view: its path and the parameters kept for that page. Null for one that isn't a page of the app. */
export function viewOf(address: string): string | null {
  if (address.length > ADDRESS_MAX || !/^\/(?![/\\])/.test(address)) return null;
  let url: URL;
  try {
    url = new URL(address, "https://openscholar.invalid");
  } catch {
    return null;
  }
  if (url.pathname.length > PATH_MAX) return null;
  // A page's address is the same with a slash at its end.
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const kept = KEPT.find(([page]) => page.test(path))?.[1] ?? [];
  const parameters = kept.flatMap((key) => {
    const value = url.searchParams.get(key);
    return value ? [`${key}=${shown(value)}`] : [];
  });
  return `${path}${parameters.length ? `?${parameters.join("&")}` : ""}`;
}

/** A view as the model reads it, after what the person typed. */
export const viewPart = (view: string) => `<view>${view}</view>`;
