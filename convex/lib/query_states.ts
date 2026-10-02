import { v, type PropertyValidators } from "convex/values";

export const queryStatusValidator = v.union(
  v.literal("ok"),
  v.literal("unauthenticated"),
  v.literal("no_access"),
  v.literal("not_found")
);

export type QueryStatus =
  | "ok"
  | "unauthenticated"
  | "no_access"
  | "not_found";

export function ok<T extends Record<string, unknown>>(payload: T): { status: "ok" } & T {
  return { status: "ok", ...payload };
}

export function unauthenticated() {
  return { status: "unauthenticated" as const };
}

export function noAccess() {
  return { status: "no_access" as const };
}

export function notFound() {
  return { status: "not_found" as const };
}

function threeStates<Fields extends PropertyValidators>(fields: Fields) {
  return v.union(
    v.object({ status: v.literal("ok"), ...fields }),
    v.object({ status: v.literal("unauthenticated") }),
    v.object({ status: v.literal("no_access") }),
  );
}

function fourStates<Fields extends PropertyValidators>(fields: Fields) {
  return v.union(
    v.object({ status: v.literal("ok"), ...fields }),
    v.object({ status: v.literal("unauthenticated") }),
    v.object({ status: v.literal("no_access") }),
    v.object({ status: v.literal("not_found") }),
  );
}

/**
 * A query's result with its access status. Typed per field, so the returns check sees the
 * lists the fields hold (scripts/check-convex-rules.ts).
 */
export function statusResultValidator<Fields extends PropertyValidators>(fields: Fields): ReturnType<typeof threeStates<Fields>>;
export function statusResultValidator<Fields extends PropertyValidators>(fields: Fields, includeNotFound: true): ReturnType<typeof fourStates<Fields>>;
export function statusResultValidator(fields: PropertyValidators, includeNotFound = false) {
  return includeNotFound ? fourStates(fields) : threeStates(fields);
}
