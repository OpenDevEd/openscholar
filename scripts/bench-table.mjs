#!/usr/bin/env node
// Turns two runs of `npm run bench` (#631) into before-and-after tables, one per area:
// documents and bytes read per call, time, and whether the call fit Convex's limits.
// usage: node scripts/bench-table.mjs bench-results/before.json bench-results/after.json
import { readFileSync } from "node:fs";

const [beforeFile, afterFile] = process.argv.slice(2);
if (!beforeFile) {
  console.error("usage: node scripts/bench-table.mjs <before.json> [after.json]");
  process.exit(1);
}
const rowsOf = (file) => (file ? Object.values(JSON.parse(readFileSync(file, "utf8"))).flat() : []);
const key = (row) => `${row.area}|${row.scenario}|${row.size}`;
const before = new Map(rowsOf(beforeFile).map((row) => [key(row), row]));
const after = new Map(rowsOf(afterFile).map((row) => [key(row), row]));

const n = (value) => (value === undefined ? "" : value.toLocaleString("en"));
const kb = (bytes) => (bytes === undefined ? "" : `${(bytes / 1024).toLocaleString("en", { maximumFractionDigits: 0 })} KB`);
const read = (row) => [row.documentsRead !== undefined ? `${n(row.documentsRead)} docs, ${kb(row.bytesRead)}` : "", row.result ?? ""].filter(Boolean).join(" · ");
const time = (row) => (row.ms === undefined ? "" : ` · ${n(row.ms)} ms`);
const cell = (row) => (!row ? "not run" : row.ok ? read(row) + time(row) : row.error === "wrong answer" ? `${read(row)}${time(row)} · **wrong**` : `**fails**: ${row.error ?? ""}`);
const change = (was, now) => {
  if (!was || !now) return "";
  if (!was.ok && now.ok) return "now fits";
  if (was.ok && !now.ok) return "**regressed**";
  if (was.documentsRead && now.documentsRead !== undefined) return `${Math.round((now.documentsRead / was.documentsRead) * 100)}% of the reads`;
  return "";
};

const keys = [...new Set([...before.keys(), ...after.keys()])];
const areas = [...new Set(keys.map((k) => k.split("|")[0]))];
for (const area of areas) {
  console.log(`\n### ${area}\n`);
  console.log(afterFile ? "| Scenario | Size | Before | After | Change |\n|---|---:|---|---|---|" : "| Scenario | Size | Result | Time |\n|---|---:|---|---:|");
  for (const k of keys.filter((k) => k.startsWith(`${area}|`)).sort((a, b) => a.split("|")[1].localeCompare(b.split("|")[1]) || Number(a.split("|")[2]) - Number(b.split("|")[2]))) {
    const [, scenario, size] = k.split("|");
    const was = before.get(k);
    const now = after.get(k);
    console.log(afterFile ? `| ${scenario} | ${n(Number(size))} | ${cell(was)} | ${cell(now)} | ${change(was, now)} |` : `| ${scenario} | ${n(Number(size))} | ${cell(was)} | ${n(was?.ms)} ms |`);
  }
}
