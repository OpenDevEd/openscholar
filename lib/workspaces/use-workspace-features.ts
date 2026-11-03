"use client";

import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { inWorkspace, useWorkspace } from "./url";

/**
 * What the workspace the page is in opens for the person: Evidence Libraries, when it has
 * them, or, in their own workspace, when a library of another's was shared with them.
 */
export function useWorkspaceFeatures() {
  return useProtectedQuery(api.organizationFeatures.opens, inWorkspace(useWorkspace(), {}));
}
