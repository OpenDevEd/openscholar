"use client";

import { useCallback } from "react";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { usePathname } from "next/navigation";

/**
 * Hook that navigates to /sign-in with a redirect_url query parameter
 * so the user returns to their current page after authentication.
 */
export function useSignInRedirect() {
  const router = useWorkspaceRouter();
  const pathname = usePathname();

  return useCallback(() => {
    const redirectUrl = encodeURIComponent(pathname);
    router.push(`/sign-in?redirect_url=${redirectUrl}`);
  }, [router, pathname]);
}
