// The people the assistant chat tests act as.
import { register as registerAgentComponent } from "@convex-dev/agent/test";
import { register as registerPresence } from "@convex-dev/presence/test";
import type { convexTest } from "convex-test";
import { seedFeatureUser, seedOrganizationFeatures } from "../organizationFeatures.test-support";

type Test = ReturnType<typeof convexTest>;

/**
 * Ada and Ben share an organization; Cy is in another. Each acts through their own session.
 */
export async function people(t: Test) {
  registerAgentComponent(t);
  registerPresence(t);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("featureFlags", { key: "assistant.enabled", enabled: true, updatedAt: 1 });
    const [ada, ben, cy] = await Promise.all(["ada", "ben", "cy"].map((clerkId) => seedFeatureUser(ctx, clerkId)));
    const team = await seedOrganizationFeatures(ctx, ["ada", "ben"], {});
    const elsewhere = await seedOrganizationFeatures(ctx, ["cy"], {});
    return { ada, ben, cy, team, elsewhere };
  });
  const as = (clerkId: string) => t.withIdentity({ subject: clerkId, tokenIdentifier: `${clerkId}|test` });
  return { ...ids, asAda: as("ada"), asBen: as("ben"), asCy: as("cy") };
}
