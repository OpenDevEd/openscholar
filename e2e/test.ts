import { test as base } from "next/experimental/testmode/playwright";

export { expect, type Page } from "next/experimental/testmode/playwright";

export const test = base.extend<{ nextProxy: void }>({
  // Every spec needs the proxy headers, even when it keeps all responses real.
  nextProxy: [async ({ next }, use) => {
    next.onFetch(async (request) => {
      const response = await fetch(request);
      const headers = new Headers(response.headers);
      // fetch decodes the body. Axios and browsers must not decode it a second time.
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    });
    await use();
  }, { auto: true }],
});
