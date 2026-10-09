"use client";

// The workspace a page acts in (#650). Every user action names it, and the server checks the
// person may act there. Until pages carry an organization in their address (#651), a page is in
// the person's own workspace.

import { useAction, useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

type WorkspaceId = Id<"workspaces">;
/** A function's arguments without the workspace, which these helpers add. */
type Own<Fn extends FunctionReference<"query" | "mutation" | "action">> = Omit<FunctionArgs<Fn>, "workspaceId">;

/** The page's workspace; undefined while it loads, or when signed out. */
export function useWorkspace(): WorkspaceId | undefined {
  return useProtectedQuery(api.workspaces.queries.personal, {}).data ?? undefined;
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
