import { v, type GenericValidator } from "convex/values";

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

export function statusResultValidator<Fields extends Record<string, GenericValidator>>(
  fields: Fields,
  includeNotFound = false
) {
  const base: GenericValidator[] = [
    v.object({ status: v.literal("ok"), ...fields }) as GenericValidator,
    v.object({ status: v.literal("unauthenticated") }) as GenericValidator,
    v.object({ status: v.literal("no_access") }) as GenericValidator,
  ];

  if (includeNotFound) {
    base.push(v.object({ status: v.literal("not_found") }) as GenericValidator);
  }

  return v.union(
    ...(base as [GenericValidator, GenericValidator, ...GenericValidator[]])
  );
}
