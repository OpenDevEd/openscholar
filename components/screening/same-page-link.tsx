"use client";

import type { ComponentProps } from "react";
import { WorkspaceLink } from "@/components/workspaces/link";
import { useWorkspaceHref } from "@/lib/workspaces/href";

/**
 * A link on the screening's pages. One that only changes the address of the page it is on (another filter, a reviewer
 * picked, another queue) changes it in place, a step in the history like any link: every screening page reads its
 * address on the client, so there is nothing to wait on the server for, and nothing on the page is drawn anew. A link to
 * another page, a section of one, a new tab or another site opens as any link does.
 */
export function SamePageLink({ onClick, ...link }: ComponentProps<typeof WorkspaceLink>) {
  const to = useWorkspaceHref()(link.href);
  return (
    <WorkspaceLink
      {...link}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target) return;
        const url = new URL(to, window.location.href);
        if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || url.hash) return;
        event.preventDefault();
        // Next.js keeps its router in step with the History API (node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md, "Native History API").
        window.history[link.replace ? "replaceState" : "pushState"](null, "", url.pathname + url.search);
      }}
    />
  );
}
