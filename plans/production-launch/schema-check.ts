import schema from "../../convex/schema";
// Checks every row of a Convex export against the schema. Run from the dev checkout: npx vite-node --config vitest.config.ts plans/production-launch/schema-check.ts <export.zip>
import { execSync } from "node:child_process";
const ZIP = process.argv[2];
const tables = (schema as any).tables as Record<string, any>;
const names = execSync(`unzip -Z1 ${ZIP}`, { maxBuffer: 1e8 }).toString().split("\n").filter((f) => /^[^_/][^/]*\/documents\.jsonl$/.test(f)).map((f) => f.split("/")[0]);
function check(v: any, x: any, path: string, out: Map<string, number>): boolean {
  const note = (m: string) => { out.set(`${path}: ${m}`, (out.get(`${path}: ${m}`) ?? 0) + 1); return false; };
  switch (v.type) {
    case "any": return true;
    case "string": return typeof x === "string" || note("not string");
    case "number": return typeof x === "number" || (x && x.$float !== undefined) || note("not number");
    case "bigint": return (x && x.$integer !== undefined) || note("not bigint");
    case "boolean": return typeof x === "boolean" || note("not boolean");
    case "null": return x === null || note("not null");
    case "id": return typeof x === "string" || note("not id");
    case "literal": return x === v.value || note(`literal: ${JSON.stringify(x)?.slice(0, 40)}`);
    case "array": if (!Array.isArray(x)) return note("not array"); { let ok = true; for (const i of x) ok = check(v.value, i, path + "[]", out) && ok; return ok; }
    case "record": if (typeof x !== "object" || x === null) return note("not record"); { let ok = true; for (const k of Object.keys(x)) ok = check(v.values.fieldType, x[k], path + "{}", out) && ok; return ok; }
    case "union": { const tmp = new Map<string, number>(); for (const m of v.value) { const t = new Map<string, number>(); if (check(m, x, path, t)) return true; for (const [k, n] of t) tmp.set(k, n); } for (const [k, n] of tmp) out.set(k, (out.get(k) ?? 0) + n); return false; }
    case "object": { if (typeof x !== "object" || x === null || Array.isArray(x)) return note("not object"); let ok = true; for (const [k, f] of Object.entries<any>(v.value)) { if (x[k] === undefined) { if (f.optional !== true) { ok = false; note(`missing ${k}`); } } else ok = check(f.fieldType, x[k], `${path}.${k}`, out) && ok; } for (const k of Object.keys(x)) if (!(k in v.value) && !k.startsWith("_")) { ok = false; note(`extra ${k}`); } return ok; }
    default: return true;
  }
}
let bad = 0, rows = 0;
for (const n of names) {
  if (!tables[n]) continue;
  const v = JSON.parse(JSON.stringify(tables[n].export().documentType));
  const lines = execSync(`unzip -p ${ZIP} ${n}/documents.jsonl`, { maxBuffer: 2e9 }).toString().split("\n").filter(Boolean);
  const out = new Map<string, number>(); let b = 0;
  for (const l of lines) if (!check(v, JSON.parse(l), n, out)) b++;
  rows += lines.length; bad += b;
  if (b) { console.log(`BAD ${n}: ${b} of ${lines.length}`); for (const [k, c] of [...out].slice(0, 6)) console.log(`   ${c}x ${k}`); }
}
console.log(`checked ${rows} rows in ${names.length} tables, ${bad} fail`);
if (bad > 0) process.exitCode = 1;
