import OpenAlexClient from "@sickrin/openalex-sdk";
import { withEncodedValues } from "./openalex/works-url";

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
const sdk = new OpenAlexClient(
  process.env.OPENALEX_CONTACT_EMAIL ?? null,
  process.env.OPENALEX_API_KEY ?? null,
);

/** The SDK, with every search's text encoded before the SDK pastes it into a URL. */
const client = {
  works: (parameters: Parameters<typeof sdk.works>[0]) => sdk.works(withEncodedValues(parameters ?? {})),
  authors: (parameters: Parameters<typeof sdk.authors>[0]) => sdk.authors(withEncodedValues(parameters ?? {})),
  author: (id: string) => sdk.author(id),
};

export default client;
