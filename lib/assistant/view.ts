/**
 * Where a person is in the app when they send the assistant a message (#327): the page's
 * path, and the parameters of its address that say what it shows. The assistant reads it
 * with the message, in a note that also says the date, and reads the page's records
 * through its tools.
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
function shown(value: string, max = VALUE_MAX) {
  const characters = [...value];
  const kept = characters.length > max ? `${characters.slice(0, max).join("")}…` : value;
  return kept.replace(/[<>&%;|\n\r\t]/g, encodeURIComponent);
}
/** Characters of one undone change, as the note says it: an action's name and a record's. */
const UNDONE_MAX = 300;

/** Any address, to resolve a path against as a browser would. */
const SITE = "https://openscholar.invalid";

/**
 * Whether an address the model wrote is a page of the app: a path that is still on this site
 * once a browser has read it. "//host" isn't, and neither is "/\\host", since a browser reads
 * a backslash there as a slash, nor a path with a tab or a line break before its second slash,
 * which a browser drops. Such an address would leave the app without the person being asked.
 */
export function inApp(address: string) {
  try {
    return address.startsWith("/") && new URL(address, SITE).origin === SITE;
  } catch {
    return false;
  }
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
  return `${path.replace(/;/g, "%3B")}${parameters.length ? `?${parameters.join("&")}` : ""}`;
}

/**
 * The app's note to the model, after what the person typed: the page they're on, when it's
 * a page of the app, the date, and the chat. Without the date a model takes "the past year"
 * from when it was trained. Without the chat's ID, "share this chat" made it look through
 * the person's chats for one with a matching title.
 */
export const notePart = ({ page, today, chat, undone }: { page?: string; today: string; chat: string; /** Changes of the assistant's the person undid and the model hasn't been told of. A record's name is theirs to choose, so each is encoded like a page's parameters. */ undone?: string[] }) =>
  `<app_context>${page === undefined ? "" : `page: ${page}; `}today: ${today}; chat: ${chat}${undone?.length ? `; undone: ${undone.map((change) => shown(change, UNDONE_MAX)).join(" | ")}` : ""}</app_context>`;
