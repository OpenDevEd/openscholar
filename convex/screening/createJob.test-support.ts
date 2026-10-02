import type { TestConvexForDataModel } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import type { DataModel } from "../_generated/dataModel";

type JobArgs = Omit<FunctionArgs<typeof internal.screening.mutations.createScreeningJobForUser>, "userId">;

/** Starts a job as the signed-in person, as `screening/start:screenSearch` does once it has read the papers. */
export async function createJob(as: TestConvexForDataModel<DataModel>, args: JobArgs) {
  const user = await as.run((ctx) => requireAuth(ctx));
  return await as.mutation(internal.screening.mutations.createScreeningJobForUser, { userId: user._id, ...args });
}
