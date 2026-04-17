import OpenAlexClient from "@sickrin/openalex-sdk";

/**
 * Client-side OpenAlex SDK singleton. Used by every `"use server"`
 * action that wraps an SDK call (searchOpenAlex, searchOpenAlexCount).
 *
 * `OPENALEX_CONTACT_EMAIL` is passed as the SDK's `email` constructor
 * arg so every outbound request joins the OpenAlex "polite pool" —
 * higher rate limits, priority routing, and the courtesy of
 * identifying ourselves to their operators.
 *
 * https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication#the-polite-pool
 *
 * No throw when unset: the SDK degrades to the shared pool. The native
 * fetch path in `convex/extraction/actions.ts::fetchPapersFromHistory`
 * already hard-errors when the env var is missing, so mis-configuration
 * is caught at extraction-submit time.
 */
const client = new OpenAlexClient(
  process.env.OPENALEX_CONTACT_EMAIL ?? null,
);

export default client;
