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

/**
 * The path inside the library the person should land on. Anything that could
 * leave the library — another site, a protocol-relative address, a backslash
 * trick, a page outside the admin area — falls back to `/admin`.
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
  if (/[\\\s#]/.test(raw)) return DEFAULT_ADMIN_RETURN_PATH;

  const path = raw.split("?")[0] ?? "";
  const segments = path.split("/").slice(1);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return DEFAULT_ADMIN_RETURN_PATH;
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

export type AdminHandoffView =
  | { kind: "launch"; launchUrl: string }
  | { kind: "no_access"; organisationName: string | null }
  | { kind: "not_ready"; isOwner: boolean }
  | { kind: "expired_link" };

export function decideAdminHandoff(input: {
  errorParam: string | string[] | undefined;
  result: AdminHandoffResult | null;
}): AdminHandoffView {
  if (!shouldRequestAdminHandoff(input.errorParam) || !input.result) {
    return { kind: "expired_link" };
  }
  const { result } = input;
  if (result.status === "allowed") {
    return { kind: "launch", launchUrl: result.launchUrl };
  }
  if (result.status === "no_access") {
    return { kind: "no_access", organisationName: result.organisationName };
  }
  return { kind: "not_ready", isOwner: result.isOwner };
}

/** The address of this page itself, without any leftover error. */
export function buildAdminRouteHref(input: {
  libraryId: string;
  returnPath?: string | undefined;
}): string {
  const base = `/evidence-libraries/${encodeURIComponent(input.libraryId)}/admin`;
  if (!input.returnPath) return base;
  return `${base}?return=${encodeURIComponent(input.returnPath)}`;
}
