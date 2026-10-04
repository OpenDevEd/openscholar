/**
 * Where a person is in the app when they send the assistant a message (#327): the page's
 * path, and the parameters of its address that name what it shows. The assistant reads it
 * with the message, and reads the page's records through its tools.
 */

/**
 * The parameters a view keeps: the ones that name a record, a place in a list or how the
 * list is narrowed. Nothing else in an address reaches a chat, so a sign-in ticket or an
 * invitation token in one never does.
 */
const KEPT = ["page", "col", "search", "job", "q", "sort", "tab", "step"] as const;
/** Characters of a view, and of each parameter in it. */
const VIEW_MAX = 300;
const VALUE_MAX = 80;

/** A page's address as a view: its path and the kept parameters. Null for one that isn't a page of the app. */
export function viewOf(address: string): string | null {
  if (!/^\/(?![/\\])/.test(address)) return null;
  let url: URL;
  try {
    url = new URL(address, "https://openscholar.invalid");
  } catch {
    return null;
  }
  const kept = new URLSearchParams(
    KEPT.flatMap((key) => {
      const value = url.searchParams.get(key);
      return value ? [[key, value.slice(0, VALUE_MAX)]] : [];
    }),
  );
  const view = `${url.pathname}${kept.size ? `?${kept}` : ""}`;
  return view.length <= VIEW_MAX ? view : url.pathname.slice(0, VIEW_MAX);
}

const OPEN = "<view>";
const CLOSE = "</view>";
/** A view as the model reads it, after what the person typed. */
export const viewPart = (view: string) => `${OPEN}${view}${CLOSE}`;
