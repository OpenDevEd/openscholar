"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { useWorkspaceHref } from "@/lib/workspaces/href";

/**
 * A link to a page of a workspace section that stays in the workspace the page is in (#651): the path it is given
 * is the one in a person's own workspace, and it takes the organization's prefix where the page is one of its.
 */
export function WorkspaceLink({ href, ...link }: Omit<ComponentProps<typeof NextLink>, "href"> & { href: string }) {
  return <NextLink href={useWorkspaceHref()(href)} {...link} />;
}
