/**
 * Caps on the lists stored inside one record (#426). Every array and record field in the
 * schema is wrapped in `capped(validator, CAP)`, and every write (`./capWrites.ts`) is
 * refused when it puts more than CAP entries in one, so no record, and no read of it, grows
 * with use. A list that would need more than MAX_LIST_CAP becomes its own table and pages
 * (#428). `convex/lib/listCaps.test.ts` fails on a schema list without a cap.
 *
 * Wrap the outermost validator: `capped(v.optional(v.array(x)), N)`, since `v.optional`
 * copies the validator it's given.
 */
import { convexToJson, type GenericValidator, type Value, type VAny, type VArray, type VObject, type VRecord, type VUnion } from "convex/values";
import { CONTEXT_BYTE_CAP, ERROR_CODES } from "../../lib/errors/taxonomy";

/** The longest list a record may hold. Longer ones are tables, read a page at a time. */
export const MAX_LIST_CAP = 1_000;

/** The type a capped list carries, so `npm run check:convex-rules` can see the cap. */
export type Capped<N extends number> = { readonly __listCap: N };

/** Marks `validator`, an array or record, as holding at most `cap` entries. */
export function capped<V extends VArray<any, any, any> | VRecord<any, any, any, any, any>, N extends number>(validator: V, cap: N): V & Capped<N> {
  if (!Number.isInteger(cap) || cap < 0 || cap > MAX_LIST_CAP) throw new Error(`A list cap is a whole number from 0 to ${MAX_LIST_CAP}; ${cap} needs its own table.`);
  Object.defineProperty(validator, "__listCap", { value: cap, enumerable: false });
  return validator as V & Capped<N>;
}

/** The type a size-bounded untyped field carries, so `npm run check:convex-rules` can see the bound. */
export type Sized<N extends number> = { readonly __jsonBytes: N };

/**
 * Marks an untyped field (`v.any()`) as at most `bytes` long as JSON: a value whose own
 * contract checks its shape, such as an Evidence Library section, kept within a size the
 * writes enforce like a list cap.
 */
export function sized<V extends VAny<any, any, any>, N extends number>(validator: V, bytes: N): V & Sized<N> {
  Object.defineProperty(validator, "__jsonBytes", { value: bytes, enumerable: false });
  return validator as V & Sized<N>;
}

/** The cap on an array or record validator, if it has one. */
export function capOf(validator: GenericValidator): number | undefined {
  return (validator as Partial<Capped<number>>).__listCap;
}

/** Each list in a validator, by path, with its cap (undefined when uncapped); `json` caps bytes. */
export type ListAt = { path: string[]; cap: number | undefined; kind: "array" | "record" | "json" };

/** Every array and record a validator holds, walking objects, unions and elements. */
export function listsIn(validator: GenericValidator, path: string[] = [], out: ListAt[] = []): ListAt[] {
  switch (validator.kind) {
    case "array": {
      out.push({ path, cap: capOf(validator), kind: "array" });
      listsIn((validator as VArray<any, any, any>).element, [...path, "[]"], out);
      break;
    }
    case "record": {
      out.push({ path, cap: capOf(validator), kind: "record" });
      listsIn((validator as VRecord<any, any, any, any, any>).value, [...path, "{}"], out);
      break;
    }
    case "object":
      for (const [key, field] of Object.entries((validator as VObject<any, any, any, any>).fields)) listsIn(field as GenericValidator, [...path, key], out);
      break;
    case "union":
      for (const member of (validator as VUnion<any, any, any, any>).members) listsIn(member as GenericValidator, path, out);
      break;
    case "any":
      out.push({ path, cap: (validator as Partial<Sized<number>>).__jsonBytes, kind: "json" });
      break;
  }
  return out;
}

/** The values at `path` in `value`: one per element under `[]` and per entry under `{}`. */
function valuesAt(value: unknown, path: string[]): unknown[] {
  if (!path.length) return [value];
  const [step, ...rest] = path;
  if (step === "[]") return Array.isArray(value) ? value.flatMap((item) => valuesAt(item, rest)) : [];
  if (step === "{}") return value && typeof value === "object" ? Object.values(value).flatMap((item) => valuesAt(item, rest)) : [];
  return value && typeof value === "object" && step! in value ? valuesAt((value as Record<string, unknown>)[step!], rest) : [];
}

/** A value's size as Convex stores it: UTF-8 bytes of its JSON form, binary values included. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(convexToJson(value as Value))).length;
}

/** The first capped list in `doc` holding more than its cap, if any. */
export function overCap(doc: unknown, lists: ListAt[]): { path: string; size: number; cap: number; unit: "entries" | "bytes" } | undefined {
  for (const list of lists) {
    if (list.cap === undefined) continue;
    for (const found of valuesAt(doc, list.path)) {
      if (found === undefined) continue;
      const size = list.kind === "json"
        ? jsonBytes(found)
        : Array.isArray(found) ? found.length : found && typeof found === "object" ? Object.keys(found).length : 0;
      if (size > list.cap) return { path: list.path.join("."), size, cap: list.cap, unit: list.kind === "json" ? "bytes" : "entries" };
    }
  }
  return undefined;
}

// ── Caps, one per kind of list. Each says why it's enough. ──

/** Both ends of a range, such as years or ratings: [from, to]. */
export const RANGE_ENDS = 2;
/** Values one search filter holds, such as countries or work types; the country picker allows 100. */
export const MAX_FILTER_VALUES = 100;
/** Questions one screening or extraction asks, and so the answers, scores and keys per paper. */
export const MAX_QUESTIONS = 50;
/** Star ratings run from one to five. */
export const MAX_STARS = 5;
/** OpenAlex lists at most 100 authorships for a work; longer author lists are cut to these. */
export const MAX_AUTHORS = 100;
/** People whose chats one shared search links to. */
export const MAX_LINKED_ACCOUNTS = 100;
/**
 * Legacy lists that nothing adds to any more: the history arrays on searches saved before
 * #354 (dropped by #373) and the answer chunks moved out by #334. Shared dev holds 40 at most.
 */
export const MAX_LEGACY_ENTRIES = MAX_LIST_CAP;
/** The topic tree is four levels deep (the topic contract's path). */
export const MAX_TOPIC_DEPTH = 4;
/** An OpenAlex topic's keywords: OpenAlex gives ten or so. */
export const MAX_TOPIC_KEYWORDS = 100;
/** Topics one library record is filed under (the topic contract's limit). */
export const MAX_RECORD_TOPICS = 100;
/** Creators of one library record (the topic contract's limit). */
export const MAX_RECORD_CREATORS = 1_000;
/** Redirect addresses one OAuth client registers. */
export const MAX_REDIRECT_URIS = 20;
/** Changes and releases one runtime release lists, and notes per release (runtimeReleases.ts cuts to these). */
export const MAX_RELEASE_CHANGES = 250;
export const MAX_RELEASES = 100;
export const MAX_RELEASE_NOTES = 40;
/** Sources one Evidence Library reports a status for. */
export const MAX_LIBRARY_SOURCES = 200;
/** Kinds of issue one source reports. */
export const MAX_ISSUE_KINDS = 50;
/** Issues one configuration operation reports (operations.ts cuts to these). */
export const MAX_CONFIGURATION_ISSUES = 200;
/** Custom domains one Evidence Library has. */
export const MAX_LIBRARY_DOMAINS = 5;
/** A model's modalities, parameters and effort levels, as OpenRouter lists them. */
export const MAX_MODEL_MODALITIES = 20;
export const MAX_MODEL_PARAMETERS = 100;
export const MAX_EFFORT_LEVELS = 10;
/** Plans, features, highlights and bundles in Autumn's catalog or one account's plan. */
export const MAX_BILLING_PLANS = 50;
export const MAX_BILLING_FEATURES = 200;
export const MAX_PLAN_DETAILS = 50;
/** Fields of one audit log or credit transaction's metadata. */
export const MAX_METADATA_FIELDS = 50;
/** Papers one chat reads from (lib/extraction/limits.ts PAPER_LIMIT). */
export const MAX_CHAT_PAPERS = 1_000;
/**
 * Buckets an extraction job counts in (convex/extraction/counts.ts): five by status, and a
 * `permanent:` and an `error:` bucket for each error code.
 */
export const MAX_COUNT_BUCKETS = 5 + 2 * ERROR_CODES.length;
/** Words in one evidence unit: a unit is at most 360 characters. */
export const MAX_UNIT_TOKENS = 400;
/** Items in one list answer (lib/extraction/evidence-policy.ts ARRAY_ANSWER_MAX_ITEMS). */
export const MAX_ANSWER_ITEMS = 8;
/** Evidence one answer cites; a longer list is cut to these. */
export const MAX_CITATIONS = 50;
/** AI tasks one preset or person picks a model for (lib/ai/tasks.ts AI_TASKS). */
export const MAX_AI_TASKS = 50;
/** DNS records one custom domain needs (dnsClient.ts reads at most 64 answers). */
export const MAX_DNS_RECORDS = 64;
/** Sections of an Evidence Library configuration. */
export const MAX_CONFIG_SECTIONS = 50;
/** An Evidence Library section's payload as JSON (convex/evidenceLibraries/sectionPayload.ts refuses more). */
export const MAX_SECTION_PAYLOAD_BYTES = 512 * 1024;
/** An extraction error's context as JSON (lib/errors/taxonomy.ts cuts it to this). */
export const MAX_ERROR_CONTEXT_BYTES = CONTEXT_BYTE_CAP;
