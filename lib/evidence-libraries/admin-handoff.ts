/**
 * The plain rules behind the admin handoff.
 *
 * A person who opens a library's `/admin` without a session is sent to
 * OpenScholar at `/evidence-libraries/<libraryId>/admin?return=<path>`. This
 * file holds the parts of that trip that are pure decisions: which return
 * path may travel on, whether to ask the backend at all, and which panel the
 * page shows. Both the page and the Convex action use them, so the two can
 * never disagree.
 */

const DEFAULT_ADMIN_RETURN_PATH = "/admin";

const MAX_RETURN_PATH_LENGTH = 512;
const LOCALE_SEGMENT = /^[a-z]{2}(-[A-Za-z]{2,8})?$/;
// A decoded segment may not hold a separator, another escape (double
// encoding) or a fragment marker.
const SEPARATOR_OR_ESCAPE = /[\\/%#]/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * The path inside the library the person should land on. Anything that could
 * leave the library falls back to `/admin`: another site, a
 * protocol-relative address, a backslash, a walk up the tree, and the
 * encoded versions of all of those. Each segment is decoded once and checked
 * again, so `%2e%2e`, `%2f`, `%5c` and double encoding never slip through.
 */
export function sanitiseAdminReturnPath(
  raw: string | null | undefined,
): string {
  if (typeof raw !== "string") return DEFAULT_ADMIN_RETURN_PATH;
  if (raw.length === 0 || raw.length > MAX_RETURN_PATH_LENGTH) {
    return DEFAULT_ADMIN_RETURN_PATH;
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    return DEFAULT_ADMIN_RETURN_PATH;
  }
  // Nothing raw may carry a separator, a fragment, whitespace or a control
  // character; those never belong in a path we were handed.
  if (/[\\\s#]/.test(raw) || CONTROL_CHARACTER.test(raw)) {
    return DEFAULT_ADMIN_RETURN_PATH;
  }

  const path = raw.split("?")[0] ?? "";
  const segments: string[] = [];
  for (const segment of path.split("/").slice(1)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // A broken escape such as `%zz`.
      return DEFAULT_ADMIN_RETURN_PATH;
    }
    if (decoded === "." || decoded === "..") return DEFAULT_ADMIN_RETURN_PATH;
    if (SEPARATOR_OR_ESCAPE.test(decoded) || CONTROL_CHARACTER.test(decoded)) {
      return DEFAULT_ADMIN_RETURN_PATH;
    }
    segments.push(decoded);
  }

  const [first, second] = segments;
  const startsAtAdmin = first === "admin";
  const startsAtLocalisedAdmin =
    typeof first === "string" && LOCALE_SEGMENT.test(first) && second === "admin";
  if (!startsAtAdmin && !startsAtLocalisedAdmin) {
    return DEFAULT_ADMIN_RETURN_PATH;
  }
  return raw;
}

/** The first value of a query parameter, however Next hands it over. */
function readSingleSearchParam(
  value: string | string[] | undefined,
): string | null {
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === "string" && single.length > 0 ? single : null;
}

/**
 * The return path the page forwards to the backend: a path on the library,
 * never another site. The backend checks it again before it is used.
 */
export function readAdminReturnPath(
  value: string | string[] | undefined,
): string | undefined {
  const single = readSingleSearchParam(value);
  if (!single || !single.startsWith("/") || single.startsWith("//")) {
    return undefined;
  }
  return single;
}

/**
 * Whether to ask the backend for a fresh code. After a failed exchange the
 * library sends the person back with `error=…`; asking again straight away
 * would bounce them between the two sites, so the page stops and explains.
 */
export function shouldRequestAdminHandoff(
  errorParam: string | string[] | undefined,
): boolean {
  return readSingleSearchParam(errorParam) === null;
}

export type AdminHandoffResult =
  | { status: "allowed"; launchUrl: string }
  | { status: "no_access"; organisationName: string | null }
  | { status: "not_ready"; isOwner: boolean };

/** The page that explains why the admin area did not open. */
export function buildAdminStatusHref(input: {
  libraryId: string;
  returnPath?: string | undefined;
  state?: "expired_link";
}): string {
  const base = `/evidence-libraries/${encodeURIComponent(input.libraryId)}/admin/status`;
  const query = new URLSearchParams();
  if (input.state) query.set("state", input.state);
  if (input.returnPath) query.set("return", input.returnPath);
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}

/** The address of the admin route itself, without any leftover error. */
export function buildAdminRouteHref(input: {
  libraryId: string;
  returnPath?: string | undefined;
}): string {
  const base = `/evidence-libraries/${encodeURIComponent(input.libraryId)}/admin`;
  if (!input.returnPath) return base;
  return `${base}?return=${encodeURIComponent(input.returnPath)}`;
}
