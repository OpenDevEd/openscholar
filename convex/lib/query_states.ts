import { v, type Validator } from "convex/values";

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

export function statusResultValidator<Fields extends Record<string, Validator<any, any, any>>>(
  fields: Fields,
  includeNotFound = false
) {
  const base: Validator<any, any, any>[] = [
    v.object({ status: v.literal("ok"), ...fields }) as Validator<any, any, any>,
    v.object({ status: v.literal("unauthenticated") }) as Validator<any, any, any>,
    v.object({ status: v.literal("no_access") }) as Validator<any, any, any>,
  ];

  if (includeNotFound) {
    base.push(v.object({ status: v.literal("not_found") }) as Validator<any, any, any>);
  }

  return v.union(
    ...(base as [Validator<any, any, any>, Validator<any, any, any>, ...Validator<any, any, any>[]])
  );
}
