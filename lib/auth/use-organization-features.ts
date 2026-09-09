"use client";

import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "./use-auth-query";

export function useOrganizationFeatures() {
  return useProtectedQuery(api.organizationFeatures.get, {});
}
