"use server";

import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { hashedClientAddress } from "@/lib/openalex/spend-requests";

export type FreeQueryAnswer =
  | { ok: true; query: string }
  | { ok: false; reason: "off" | "limit" | "limitSignedOut" | "failed" };

/**
 * Writes a query from a research question for someone who can't pay for it, under the limit of the
 * account they're signed in to, or of their address. An answer, not a throw: Next strips a thrown
 * error's message in production. Limits keep the address hashed, so it isn't stored.
 */
export async function writeFreeQuery(input: { question: string; language?: string; syntax?: "oql" }): Promise<FreeQueryAnswer> {
  const secret = process.env.FREE_QUERIES_SECRET;
  if (!secret) {
    console.error("[free-queries] FREE_QUERIES_SECRET is not set");
    return { ok: false, reason: "failed" };
  }
  const { userId } = await auth();
  const who = userId ? { person: userId } : { address: hashedClientAddress(secret, await headers()) };
  try {
    const answer = await fetchAction(api.ai.freeQueriesAction.write, { secret, who, question: input.question, language: input.language, syntax: input.syntax });
    if (answer.ok) return answer;
    if (answer.reason === "limit") return { ok: false, reason: userId ? "limit" : "limitSignedOut" };
    return { ok: false, reason: answer.reason === "off" ? "off" : "failed" };
  } catch (error) {
    console.error("[free-queries] the call failed", error);
    return { ok: false, reason: "failed" };
  }
}
