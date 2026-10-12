"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { useWorkspaceHref } from "@/lib/workspaces/href";

/** Next's Link, with a workspace section's path kept in the workspace the page is in (lib/workspaces/url.ts). */
function Link({ href, ...props }: ComponentProps<typeof NextLink>) {
  const inWorkspace = useWorkspaceHref();
  return <NextLink {...props} href={typeof href === "string" ? inWorkspace(href) : href} />;
}

export default Link;
