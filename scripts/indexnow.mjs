#!/usr/bin/env node
// Tells Bing and the other IndexNow search engines (indexnow.org) which of our addresses are new or changed, so they
// read them now instead of at their next crawl. Google doesn't take IndexNow.
//
//   node scripts/indexnow.mjs https://openscholar.ai/sitemap.xml
//   node scripts/indexnow.mjs https://discover.openscholar.ai/sitemap.xml https://discover.openscholar.ai/papers/sitemap/0.xml
//   node scripts/indexnow.mjs https://openscholar.ai/publithon/
//
// A sitemap is read for its addresses, a sitemap index for its sitemaps' addresses, and any other address is sent as it
// is. The key is the 32-character .txt file in public/ and marketing/public/: each host serves it at its root, which
// proves the list comes from that host. It is public by design.
import { readdirSync } from "node:fs";

const KEY = readdirSync(new URL("../public", import.meta.url)).find((name) => /^[0-9a-f]{32}\.txt$/.test(name))?.slice(0, 32);
if (!KEY) throw new Error("public/ holds no IndexNow key file (32 hex characters, .txt)");
/** The most addresses IndexNow takes in one request. */
const BATCH = 10_000;

const isSitemap = (address) => new URL(address).pathname.endsWith(".xml");

async function addressesOf(address) {
  if (!isSitemap(address)) return [address];
  const response = await fetch(address, { headers: { "User-Agent": "openscholar-indexnow/1.0" } });
  if (!response.ok) throw new Error(`${address} answered ${response.status}`);
  const listed = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].replaceAll("&amp;", "&"));
  return (await Promise.all(listed.map(addressesOf))).flat();
}

const given = process.argv.slice(2);
if (!given.length) throw new Error("Give at least one sitemap or page address");
const byHost = Map.groupBy((await Promise.all(given.map(addressesOf))).flat(), (address) => new URL(address).host);
for (const [host, addresses] of byHost) {
  for (let from = 0; from < addresses.length; from += BATCH) {
    const urlList = addresses.slice(from, from + BATCH);
    const response = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key: KEY, keyLocation: `https://${host}/${KEY}.txt`, urlList }),
    });
    // 200 is taken, 202 is taken with the key still to be checked. Anything else says why in its body.
    console.log(`${host}: ${urlList.length} addresses, IndexNow answered ${response.status}${response.ok ? "" : ` ${(await response.text()).slice(0, 300)}`}`);
    if (!response.ok) process.exitCode = 1;
  }
}
