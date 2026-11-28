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
import { recordAppUse } from "./appCalls";

export * from "../_generated/server";

/**
 * The writes a mutation makes: through the triggers, then capped (#426). The caps sit under
 * the triggers, so a trigger's own writes are capped too. The count writes the triggers
 * gather are queued once, when the mutation ends (./countQueue.ts). A developer app's call
 * is checked and put on the person's list of sites first (`recordAppUse`).
 */
const appWrites = (ctx: MutationCtx) => {
  const countQueue: CountQueue = new Map();
  return { db: triggers.wrapDB({ ...ctx, db: capWrites(ctx.db), countQueue }).db, countQueue };
};
const writes = {
  args: {},
  input: async (ctx: MutationCtx) => {
    await recordAppUse(ctx);
    const wrapped = appWrites(ctx);
    return { ctx: wrapped, args: {}, onSuccess: () => flushCountQueue(ctx, wrapped.countQueue) };
  },
};

/**
 * Runs a mutation that another library built, such as a work pool's `defineOnComplete` handler, with the app's
 * writes: through the triggers and the caps, its counts queued when it ends. Without it, its writes skip every
 * trigger, and what they keep (cards, list counts, the screening counts) falls behind for good.
 */
export async function withAppWrites<Ctx extends MutationCtx, T>(ctx: Ctx, run: (ctx: Ctx) => Promise<T>): Promise<T> {
  const wrapped = appWrites(ctx);
  const result = await run({ ...ctx, ...wrapped });
  await flushCountQueue(ctx, wrapped.countQueue);
  return result;
}

export const mutation = customMutation(rawMutation, writes);
export const internalMutation = customMutation(rawInternalMutation, writes);
