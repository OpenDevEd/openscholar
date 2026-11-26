/**
 * What happens in a screening with reviewers, written to its Activity (../activity): each change with a code its
 * page has a sentence for, and under it what the change did. The page words them (components/screening), so a
 * change reads in the language of whoever looks, and the generic kind beside the code keeps a row readable where
 * only kinds are known.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { noteActivity } from "../activity/notes";
import type { Note } from "../activity/validators";

/** Every code a screening logs, with the kind of change it is. */
export const CODES = {
  started: "created",
  renamed: "renamed",
  finished: "stopped",
  reopened: "resumed",
  paused: "paused",
  resumed: "resumed",
  moved: "moved",
  reviewerAdded: "added",
  reviewerRemoved: "removed",
  reviewerJoined: "added",
  madeViewer: "edited",
  reminded: "edited",
  retried: "retried",
  papersMoved: "moved",
  asked: "edited",
  checked: "added",
  scheduledCheck: "added",
  settings: "edited",
} as const satisfies Record<string, Note["happened"]>;
export type Code = keyof typeof CODES;
export type Line = { code: string; count?: number; detail?: string };

/** Notes one change to a screening, as whoever made it, or for a scheduled one as whoever started the screening. */
export async function logChange(ctx: Pick<MutationCtx, "db">, by: { userId: Id<"users">; author?: "user" | "assistant" }, job: Pick<Doc<"screeningJobs">, "_id" | "workspaceId">, code: Code, about: { count?: number; detail?: string; more?: Line[] } = {}) {
  await noteActivity(ctx, { workspaceId: job.workspaceId, by: by.userId, viaAssistant: by.author === "assistant" }, { kind: "screening", id: job._id, happened: CODES[code], code, ...(about.count === undefined ? {} : { count: about.count }), ...(about.detail ? { detail: about.detail } : {}), ...(about.more?.length ? { more: about.more } : {}) });
}
