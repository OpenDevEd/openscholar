/**
 * The app's Convex function builders. Everything is `_generated/server`, except that
 * `mutation` and `internalMutation` run every write through the triggers in
 * `./triggers.ts`. Import builders from here, never from `_generated/server`:
 * `npm run check:convex-rules` fails on a mutation builder imported from there.
 */
import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import { internalMutation as rawInternalMutation, mutation as rawMutation } from "../_generated/server";
import { triggers } from "./triggers";

export * from "../_generated/server";

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));
