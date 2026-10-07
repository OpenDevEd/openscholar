/**
 * The app's Convex function builders. Everything is `_generated/server`, except that
 * `mutation` and `internalMutation` run every write through the list caps in
 * `./capWrites.ts` and the triggers in `./triggers.ts`. Import builders from here, never
 * from `_generated/server`: `npm run check:convex-rules` fails on a mutation builder
 * imported from there.
 */
import { customMutation } from "convex-helpers/server/customFunctions";
import { internalMutation as rawInternalMutation, mutation as rawMutation, type MutationCtx } from "../_generated/server";
import { capWrites } from "./capWrites";
import { triggers } from "./triggers";
import { flushCountQueue, type CountQueue } from "./countQueue";

export * from "../_generated/server";

/**
 * The writes a mutation makes: through the triggers, then capped (#426). The caps sit under
 * the triggers, so a trigger's own writes are capped too. The count writes the triggers
 * gather are queued once, when the mutation ends (./countQueue.ts).
 */
const writes = {
  args: {},
  input: async (ctx: MutationCtx) => {
    const countQueue: CountQueue = new Map();
    return {
      ctx: { db: triggers.wrapDB({ ...ctx, db: capWrites(ctx.db), countQueue }).db, countQueue },
      args: {},
      onSuccess: () => flushCountQueue(ctx, countQueue),
    };
  },
};

export const mutation = customMutation(rawMutation, writes);
export const internalMutation = customMutation(rawInternalMutation, writes);
