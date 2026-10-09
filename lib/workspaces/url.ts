"use client";

// The workspace a page acts in (#650, #651) is in its address: an organization's pages sit under
// /o/<slug>, and every other page is in the person's own workspace. Every user action names it,
// and the server checks the person may act there.

import { useWorkspaceSlug } from "./href";
import { useAction, useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

type WorkspaceId = Id<"workspaces">;
/** A function's arguments without the workspace, which these helpers add. */
type Own<Fn extends FunctionReference<"query" | "mutation" | "action">> = Omit<FunctionArgs<Fn>, "workspaceId">;

/**
 * The page's workspace; undefined while it loads, or when signed out. An organization's pages
 * answer someone outside it as not found (app/o/[slug]/layout.tsx); one they leave meanwhile is
 * undefined here, so its actions refuse.
 */
export function useWorkspace(): WorkspaceId | undefined {
  const slug = useWorkspaceSlug();
  const personal = useProtectedQuery(api.workspaces.queries.personal, slug ? "skip" : {}).data;
  const organization = useProtectedQuery(api.workspaces.queries.bySlug, slug ? { slug } : "skip").data;
  return (slug ? organization : personal) ?? undefined;
}

/**
 * The workspace argument of a read that also answers signed out or before the workspace loads:
 * none in the person's own workspace, where the server takes theirs; the organization's once it
 * has loaded, and "skip" until then, so an organization's page never shows the person's own.
 */
export function useWorkspaceScope(): { workspaceId?: WorkspaceId } | "skip" {
  const slug = useWorkspaceSlug();
  const workspaceId = useWorkspace();
  if (!slug) return {};
  return workspaceId ? { workspaceId } : "skip";
}

/** A read's arguments in `workspaceId`, or "skip" until the workspace is known. */
export function inWorkspace<Args extends object>(workspaceId: WorkspaceId | undefined, args: Args | "skip"): (Args & { workspaceId: WorkspaceId }) | "skip" {
  return args === "skip" || !workspaceId ? "skip" : { ...args, workspaceId };
}

const notReady = () => new Error("The workspace hasn't loaded yet. Try again in a moment.");

/** A mutation in the page's workspace. It refuses to run before the workspace has loaded. */
export function useWorkspaceMutation<Mutation extends FunctionReference<"mutation">>(mutation: Mutation) {
  const workspaceId = useWorkspace();
  const run = useMutation(mutation);
  return (args: Own<Mutation>): Promise<FunctionReturnType<Mutation>> =>
    workspaceId ? run({ ...args, workspaceId } as FunctionArgs<Mutation>) : Promise.reject(notReady());
}

/** An action in the page's workspace. It refuses to run before the workspace has loaded. */
export function useWorkspaceAction<Action extends FunctionReference<"action">>(action: Action) {
  const workspaceId = useWorkspace();
  const run = useAction(action);
  return (args: Own<Action>): Promise<FunctionReturnType<Action>> =>
    workspaceId ? run({ ...args, workspaceId } as FunctionArgs<Action>) : Promise.reject(notReady());
}
