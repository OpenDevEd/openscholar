# Phase 15: AI Prompts & Schema Tests - Research

**Researched:** 2026-02-28
**Domain:** Unit testing for AI prompt builders, Zod schema validation, JSON repair utilities, and codec round-trip functions
**Confidence:** HIGH

## Summary

Phase 15 tests six pure-logic modules inside `lib/ai/core/`: prompt builders (`prompts.ts`), query validation (`validate.ts`), JSON repair (`validate.ts` using `jsonrepair`), Zod schemas (`schemas.ts`), and question-key encoding/decoding (`question-key-codec.ts`). All six target modules are synchronous or trivially async pure functions with zero external dependencies beyond `zod` and `jsonrepair` -- making them ideal unit test targets.

The test infrastructure from Phase 14 is fully operational: Vitest 3.2+ with multi-environment routing, `tests/` directory convention, and `node` environment for non-DOM tests. These tests will all run in the default `node` environment since none require DOM or edge-runtime.

**Primary recommendation:** Write one test file per logical concern (prompts, validate, schemas, codec), importing directly from `lib/ai/core/` barrel. No mocks needed -- every function under test is pure.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AIPR-01 | All 6 prompt builders produce structurally correct prompts with required fields | Each builder returns `{ system: string, prompt: string }`. Tests assert both fields are non-empty strings containing expected structural markers (JSON format instructions, input interpolation). See prompt builder signatures and templates in `lib/ai/core/prompts.ts`. |
| AIPR-02 | `validateQuery` detects unbalanced parentheses and trailing Boolean operators | `validateQuery` in `lib/ai/core/validate.ts` is a 15-line pure function that counts parens and regex-checks for trailing OR/AND/NOT. Tests provide valid and invalid query strings. |
| AIPR-03 | `repairJSON` and `repairSingleField` recover malformed AI responses | Both in `lib/ai/core/validate.ts`. `repairJSON` delegates to `jsonrepair` library for JSON-like text and returns trimmed plain text for non-JSON. `repairSingleField` wraps non-JSON text in `{ [fieldName]: text }`. Tests provide common malformed patterns. |
| AIPR-04 | All Zod schemas accept valid inputs and reject invalid ones | `lib/ai/core/schemas.ts` exports `queryEnhancementSchema`, `screeningQuestionsSchema`, `createScreeningResponsesSchema` (factory), `translateQuerySchema`, `translatePaperContentSchema`, `extractionQuestionsSchema`. Tests call `.parse()` with valid data and `.safeParse()` with invalid data. |
| AIPR-05 | `encodeQuestionKey`/`decodeQuestionKey` round-trip for ASCII and non-ASCII | `lib/ai/core/question-key-codec.ts` uses `encodeURIComponent`/`decodeURIComponent` with a `__qk__:` prefix. Tests verify round-trip identity for plain ASCII, Unicode (CJK, Arabic, emoji), and special characters. |
| AIPR-06 | `encodeQuestionResponseMap`/`decodeQuestionResponseMap` preserve all key-value pairs | Same file. Maps `Object.entries` through encode/decode. Tests verify full map round-trip with mixed keys and boolean/null values. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | ^3.2.4 | Test runner and assertion library | Already installed and configured in Phase 14 |
| Zod | ^4.3.6 | Schema validation (production dependency under test) | Already used by schemas.ts |
| jsonrepair | ^3.13.2 | JSON repair (production dependency under test) | Already used by validate.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | -- | -- | All tests are pure function tests with zero mock requirements |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct Zod `.parse()` | `zod-mock` for generating test data | Unnecessary -- schemas are simple enough to hand-write valid/invalid inputs |
| Manual test cases | Property-based testing (`fast-check`) | Overkill for this phase; codec round-trip could benefit but scope is limited |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Recommended Test File Structure
```
tests/
├── ai-prompts.test.ts          # AIPR-01: All 6 prompt builders
├── ai-validate.test.ts         # AIPR-02 + AIPR-03: validateQuery, repairJSON, repairSingleField
├── ai-schemas.test.ts          # AIPR-04: All Zod schemas
└── ai-question-key-codec.test.ts  # AIPR-05 + AIPR-06: encode/decode round-trips
```

### Pattern 1: Prompt Builder Structural Assertion
**What:** Test that each prompt builder returns `{ system: string, prompt: string }` with expected content markers.
**When to use:** AIPR-01 -- testing all 6 prompt builders.
**Example:**
```typescript
import { describe, expect, it } from "vitest";
import { buildEnhanceQueryPrompts } from "../lib/ai/core/prompts";

describe("buildEnhanceQueryPrompts", () => {
  it("returns system and prompt strings with required structure", () => {
    const result = buildEnhanceQueryPrompts({ query: "climate change" }, 0);
    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("prompt");
    expect(typeof result.system).toBe("string");
    expect(typeof result.prompt).toBe("string");
    expect(result.system).toContain("JSON");  // must request JSON format
    expect(result.prompt).toContain("climate change"); // must interpolate input
  });
});
```

### Pattern 2: Schema Accept/Reject Testing
**What:** Use `.parse()` for valid data (should not throw) and `.safeParse()` for invalid data (should return `success: false`).
**When to use:** AIPR-04 -- testing all Zod schemas.
**Example:**
```typescript
import { describe, expect, it } from "vitest";
import { queryEnhancementSchema } from "../lib/ai/core/schemas";

describe("queryEnhancementSchema", () => {
  it("accepts valid input", () => {
    const result = queryEnhancementSchema.parse({ enhancedQuery: "AI AND health" });
    expect(result.enhancedQuery).toBe("AI AND health");
  });

  it("rejects missing enhancedQuery", () => {
    const result = queryEnhancementSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects wrong type", () => {
    const result = queryEnhancementSchema.safeParse({ enhancedQuery: 123 });
    expect(result.success).toBe(false);
  });
});
```

### Pattern 3: Round-Trip Identity Testing
**What:** Encode then decode should produce the original input. Decode then encode should produce the encoded form.
**When to use:** AIPR-05, AIPR-06 -- codec tests.
**Example:**
```typescript
import { describe, expect, it } from "vitest";
import { encodeQuestionKey, decodeQuestionKey } from "../lib/ai/core/question-key-codec";

describe("question key codec", () => {
  it.each([
    "Is this a randomized trial?",
    "Does the study focus on adults?",
    "Existe-t-il un groupe controle?",  // French
    "这是随机试验吗？",                 // Chinese
  ])("round-trips: %s", (question) => {
    expect(decodeQuestionKey(encodeQuestionKey(question))).toBe(question);
  });
});
```

### Anti-Patterns to Avoid
- **Testing AI output quality:** These tests verify structure, not content quality. Never assert on specific generated text beyond structural markers.
- **Mocking jsonrepair:** The `jsonrepair` library is fast, deterministic, and stateless -- test through it, not around it.
- **Testing execute.ts in this phase:** The `executeAIOperation` function calls real LLM APIs. It belongs in Phase 16 (batch processing) with appropriate mocking. This phase tests only the pure functions it consumes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON repair | Custom regex JSON fixers | `jsonrepair` library (already used) | Handles dozens of edge cases (trailing commas, missing quotes, etc.) |
| Schema validation | Manual type checking | Zod `.parse()` / `.safeParse()` (already used) | Type-safe, composable, great error messages |
| URI encoding | Custom encoding logic | `encodeURIComponent` (already used in codec) | Browser standard, handles all Unicode correctly |

**Key insight:** Every function under test already uses the right library. Tests should exercise the functions as-is, not replace their internals.

## Common Pitfalls

### Pitfall 1: Zod v4 API Differences
**What goes wrong:** Tests written with Zod v3 patterns (`.shape`, `.element`, etc.) fail because Zod v4 changed some APIs.
**Why it happens:** Project uses Zod ^4.3.6 which has breaking changes from v3.
**How to avoid:** Use only `.parse()` and `.safeParse()` for testing -- these are stable across versions. Avoid introspecting schema internals.
**Warning signs:** TypeScript errors on schema property access, unexpected `.safeParse()` error format.

### Pitfall 2: createScreeningResponsesSchema is a Factory
**What goes wrong:** Treating `createScreeningResponsesSchema` like a static schema instead of calling it with questions first.
**Why it happens:** Unlike the other 5 schemas, this one is a function that dynamically builds a schema based on the questions array.
**How to avoid:** Always call `createScreeningResponsesSchema(questions)` with a concrete array before `.parse()`.
**Warning signs:** "not a function" errors or type mismatches.

### Pitfall 3: repairJSON Returns null on Failure
**What goes wrong:** Tests assume `repairJSON` always returns a string.
**Why it happens:** `repairJSON` returns `null` when repair fails completely (non-JSON text that starts with `{`).
**How to avoid:** Test the `null` return path explicitly. The function has three code paths: (1) non-JSON text returned trimmed, (2) JSON repaired via `jsonrepair`, (3) null on total failure.
**Warning signs:** Uncaught `null` in test assertions.

### Pitfall 4: Async repairJSON/repairSingleField
**What goes wrong:** Forgetting `await` on repair functions.
**Why it happens:** Both `repairJSON` and `repairSingleField` are declared `async` even though their implementation is synchronous.
**How to avoid:** Always `await` the return value in tests.
**Warning signs:** Tests pass when they should fail because they're asserting against a Promise object.

### Pitfall 5: validateQuery Only Checks Two Things
**What goes wrong:** Writing tests for validation behaviors that don't exist (e.g., checking for empty queries, checking for invalid field syntax).
**Why it happens:** The function name suggests comprehensive validation, but it only checks (1) balanced parentheses and (2) trailing Boolean operators.
**How to avoid:** Read the implementation first. Test exactly what it does. The requirement (AIPR-02) is precisely scoped to these two checks.
**Warning signs:** Tests expecting throws that never happen.

## Code Examples

### All 6 Prompt Builders -- Structural Fields

Each prompt builder returns `{ system: string, prompt: string }`. The structural requirements per builder:

```typescript
// 1. buildEnhanceQueryPrompts(input, retryCount)
//    - system: Contains "JSON", "enhancedQuery"
//    - prompt: Contains input.query
//    - When retryCount > 0: prompt contains "unbalanced parentheses"
//    - When input.language set: system contains language name

// 2. buildScreeningQuestionsPrompts(input)
//    - system: Contains "JSON", "questions"
//    - prompt: Contains input.researchQuestion
//    - When existingQuestions non-empty: prompt lists them
//    - When responseLanguage set: system/prompt contain language name

// 3. buildScreeningResponsesPrompts(input)
//    - system: Contains "JSON", "responses", "confidence"
//    - prompt: Contains input.title and input.abstract
//    - prompt: Lists input.questions

// 4. buildTranslateQueryPrompts(input)
//    - system: Contains "AND, OR, and NOT" (operator preservation rule)
//    - prompt: Contains input.query and target language name

// 5. buildTranslatePaperContentPrompts(input)
//    - system: Contains "JSON", "translatedTitle", "translatedAbstract"
//    - prompt: Contains input.title and input.abstract

// 6. buildExtractionQuestionsPrompts(input)
//    - system: Contains "JSON", "questions", "type"
//    - prompt: Contains input.jobName
//    - When sourceContext set: prompt contains it
//    - When existingQuestions non-empty: prompt lists them
```

### validateQuery -- Edge Cases

```typescript
// Valid queries (should return the query string)
validateQuery("(AI OR ML) AND health")     // balanced parens
validateQuery("climate change")            // no parens at all
validateQuery("((nested)) AND test")       // deeply nested parens

// Invalid queries (should throw)
validateQuery("(AI OR ML AND health")      // unbalanced: 1 open, 0 close
validateQuery("AI AND health)")            // unbalanced: 0 open, 1 close
validateQuery("AI OR")                     // trailing OR
validateQuery("health AND ")              // trailing AND
validateQuery("NOT")                       // trailing NOT
```

### repairJSON -- Three Code Paths

```typescript
// Path 1: Non-JSON text (doesn't start with '{') -- returns trimmed text
await repairJSON("  hello world  ", null)  // => "hello world"

// Path 2: Repairable JSON -- jsonrepair fixes it
await repairJSON('{"key": "value",}', null)  // => '{"key":"value"}'  (trailing comma removed)
await repairJSON("{key: 'value'}", null)     // => '{"key":"value"}'  (unquoted keys, single quotes)

// Path 3: Unrepairable JSON-like text -- returns null
await repairJSON("{completely broken {{{{", null)  // => null
```

### repairSingleField -- Wrapping Behavior

```typescript
// Non-JSON text gets wrapped in { fieldName: text }
await repairSingleField("hello world", null, "enhancedQuery")
// => '{"enhancedQuery":"hello world"}'

// JSON text gets repaired normally
await repairSingleField('{"enhancedQuery": "test",}', null, "enhancedQuery")
// => '{"enhancedQuery":"test"}'
```

### Zod Schema Shapes

```typescript
// queryEnhancementSchema: { enhancedQuery: string }
// screeningQuestionsSchema: { questions: string[] } (min 1, max 10)
// createScreeningResponsesSchema(questions): { responses: Record<question, boolean|null>, confidence: number(0-1) }
// translateQuerySchema: { translatedQuery: string }
// translatePaperContentSchema: { translatedTitle: string, translatedAbstract: string }
// extractionQuestionsSchema: { questions: Array<{ question: string, type: enum, description?: string }> } (min 1, max 10)
```

### Question Key Codec -- Encoding Scheme

```typescript
// Prefix: "__qk__:"
// Encoding: encodeURIComponent(question)
// Example: "Is this valid?" => "__qk__:Is%20this%20valid%3F"

// Non-prefixed keys pass through decodeQuestionKey unchanged
decodeQuestionKey("plain key")  // => "plain key"

// Invalid URI sequences in prefixed keys return the raw key
decodeQuestionKey("__qk__:%E0%A4%A")  // => "__qk__:%E0%A4%A" (malformed UTF-8)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod v3 `.parse()` | Zod v4 `.parse()` (same API) | Zod v4 release (2025) | Parse/safeParse API is stable; internal schema introspection changed |
| `jsonrepair` v2 | `jsonrepair` v3 (^3.13.2) | 2024 | ESM-only, same repair API |
| Vitest 1.x | Vitest 3.2+ | 2025 | `environmentMatchGlobs` deprecated but functional; no impact on node-env tests |

**Deprecated/outdated:**
- Vitest `environmentMatchGlobs` is deprecated in Vitest 3.x (replaced by `test.projects`), but still functional and used in the project config. No impact on this phase since all tests here use the default `node` environment.

## Open Questions

1. **jsonrepair unrepairable edge cases**
   - What we know: `jsonrepair` handles most common malformation patterns (trailing commas, unquoted keys, single quotes, truncated JSON).
   - What's unclear: The exact boundary between "repairable" and "unrepairable" for `jsonrepair` v3 is not formally documented.
   - Recommendation: Test a representative set of common AI failure patterns (truncated mid-string, markdown-wrapped JSON, double-encoded JSON) and document which ones recover vs return null.

## Sources

### Primary (HIGH confidence)
- Direct source code inspection of `lib/ai/core/prompts.ts`, `validate.ts`, `schemas.ts`, `question-key-codec.ts`, `configs.ts`, `execute.ts`, `types.ts`, `languages.ts`, `errors.ts`
- Existing test suite in `tests/` directory -- 42 test files establishing project patterns
- `vitest.config.ts` -- confirmed test environment configuration
- `package.json` -- confirmed dependency versions (zod ^4.3.6, jsonrepair ^3.13.2, vitest ^3.2.4)

### Secondary (MEDIUM confidence)
- Zod v4 `.parse()`/`.safeParse()` API stability confirmed by project usage across `schemas.ts` and `configs.ts`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies already installed and configured; no new packages needed
- Architecture: HIGH - All source files read, function signatures and return types fully understood
- Pitfalls: HIGH - Identified from direct code inspection (async signatures, factory schema, three code paths in repairJSON)

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable -- pure function tests, no external API changes)
