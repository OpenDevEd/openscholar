/**
 * Test support for the paper PDF store (./paperPdfs.ts): an in-memory R2 bucket that answers the signed requests
 * the store sends, and the env that points the store at it. The `.test-support.ts` extension keeps this file out
 * of the Convex bundle.
 */
import { vi } from "vitest";

const HOST = "r2.test";
const BUCKET = "papers";

export const fakeStore = {
  objects: new Map<string, Uint8Array>(),
  /** Keys written, in order. */
  kept: [] as string[],
  reset() {
    this.objects.clear();
    this.kept = [];
  },
};

/** Points the store at the fake bucket. */
export function stubPaperStore() {
  vi.stubEnv("PAPER_PDFS_ENDPOINT", `https://${HOST}`);
  vi.stubEnv("PAPER_PDFS_BUCKET", BUCKET);
  vi.stubEnv("PAPER_PDFS_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("PAPER_PDFS_SECRET_ACCESS_KEY", "test-secret");
}

/** The address a stored copy is linked by, without its signature. */
export const storedAddress = (key: string) => `https://${HOST}/${BUCKET}/${key}`;

/** Answers a request to the fake bucket, or null when it isn't one. */
export async function storeAnswer(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (url.host !== HOST) return null;
  const key = decodeURIComponent(url.pathname.slice(`/${BUCKET}/`.length));
  if (request.method === "PUT") {
    fakeStore.objects.set(key, new Uint8Array(await request.arrayBuffer()));
    fakeStore.kept.push(key);
    return new Response(null, { status: 200 });
  }
  const object = fakeStore.objects.get(key);
  return object ? new Response(object.slice(), { status: 200, headers: { "content-type": "application/pdf" } }) : new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
}
