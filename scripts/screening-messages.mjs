// Builds the `screening` namespace of the two English message files from the fragments in
// messages/screening-fragments/, one file a part of the Screening pages. Used while those pages are being
// moved to messages by several people at once: each owns one fragment, and nobody edits the big files by hand.
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const dir = new URL("../messages/", import.meta.url);
const fragments = new URL("screening-fragments/", dir);
const parts = Object.fromEntries(
  readdirSync(fragments)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => [name.slice(0, -5), JSON.parse(readFileSync(new URL(name, fragments), "utf8"))]),
);
for (const locale of ["en-US", "en-GB"]) {
  const file = new URL(`${locale}.json`, dir);
  const all = JSON.parse(readFileSync(file, "utf8"));
  all.screening = parts;
  // Written beside it and moved into place, so nobody reads half a file.
  const half = new URL(`${locale}.json.${process.pid}.tmp`, dir);
  writeFileSync(half, JSON.stringify(all, null, 2));
  renameSync(half, file);
}
console.log(`screening: ${Object.keys(parts).length} parts, ${JSON.stringify(parts).match(/":\s*"/g)?.length ?? 0} messages`);
