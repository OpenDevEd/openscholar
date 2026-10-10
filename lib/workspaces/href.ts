"use client";

// Links and navigation that stay in the workspace a page is in (#651): a workspace section's path
// takes the organization's prefix, /o/<slug>, when the page is one of its. No Convex here, so any
// component can link.

import { useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";

import { workspaceHref } from "./paths";

// The rule itself is in ./paths, with the others; components link through here.
export { workspaceHref };

/** The organization a page's address names, or undefined in the person's own workspace. */
export function useWorkspaceSlug(): string | undefined {
  const params = useParams();
  return typeof params?.slug === "string" ? params.slug : undefined;
}

/** `workspaceHref` for the workspace the page is in. */
export function useWorkspaceHref() {
  const slug = useWorkspaceSlug();
  return useCallback((path: string) => workspaceHref(slug, path), [slug]);
}

/** The router, with a workspace section's path kept in the workspace the page is in. The same object while the page stays in one workspace. */
export function useWorkspaceRouter() {
  const router = useRouter();
  const slug = useWorkspaceSlug();
  return useMemo(
    () => ({
      ...router,
      push: (path: string, ...options: [Parameters<typeof router.push>[1]?]) => router.push(workspaceHref(slug, path), ...options),
      replace: (path: string, ...options: [Parameters<typeof router.replace>[1]?]) => router.replace(workspaceHref(slug, path), ...options),
      prefetch: (path: string) => router.prefetch(workspaceHref(slug, path)),
    }),
    [router, slug],
  );
}
