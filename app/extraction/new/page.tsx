import { auth } from "@clerk/nextjs/server";
import { preloadQuery } from "convex/nextjs";
import { NewExtraction } from "@/components/extraction/new-extraction";
import { api } from "@/convex/_generated/api";

export default async function NewExtractionPage() {
  // The papers the person's plan takes in one extraction, there on the first frame.
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  return <NewExtraction preloadedLimits={await preloadQuery(api.billing.accounts.myLimits, {}, { token })} />;
}
