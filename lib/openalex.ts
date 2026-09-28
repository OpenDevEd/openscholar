import OpenAlexClient from "@sickrin/openalex-sdk";

/**
 * OpenAlex SDK singleton. Used by every `"use server"` action that wraps
 * an SDK call (searchOpenAlex, searchOpenAlexCount).
 *
 * `OPENALEX_API_KEY` raises OpenAlex's daily allowance from 1,000 credits,
 * shared by everything on the server's address, to 2,000,000, and makes a
 * search cost 1 credit instead of 10. `OPENALEX_CONTACT_EMAIL` identifies
 * us to OpenAlex. Both are passed explicitly rather than left to the SDK's
 * own environment defaults, which read a different email variable.
 */
const client = new OpenAlexClient(
  process.env.OPENALEX_CONTACT_EMAIL ?? null,
  process.env.OPENALEX_API_KEY ?? null,
);

export default client;
