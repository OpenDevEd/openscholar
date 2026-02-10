import type { AuthQuerySettlement } from "@/lib/auth/use-auth-query";

export type AuthSensitiveListRenderState =
  | "loading"
  | "empty"
  | "filtered_empty"
  | "ready";

type ListRenderStateArgs = {
  settlement: AuthQuerySettlement;
  hasLoadedFirstPage: boolean;
  visibleCount: number;
  hasActiveFilter: boolean;
};

export function getAuthSensitiveListRenderState({
  settlement,
  hasLoadedFirstPage,
  visibleCount,
  hasActiveFilter,
}: ListRenderStateArgs): AuthSensitiveListRenderState {
  if (settlement !== "ready" || !hasLoadedFirstPage) {
    return "loading";
  }

  if (visibleCount > 0) {
    return "ready";
  }

  return hasActiveFilter ? "filtered_empty" : "empty";
}
