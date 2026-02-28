# Phase 19: Data Export Tests - Research

**Researched:** 2026-02-28
**Domain:** CSV/JSON export, answer formatting, citation helpers, download output
**Confidence:** HIGH

## Summary

Phase 19 tests five distinct modules spanning data export functionality: (1) `jsonToCSV` in `lib/utils.ts` -- a generic JSON-to-CSV converter with `escapeCSVValue` handling special characters; (2) `exportToCSV`/`exportToJSON` in `lib/extraction/export.ts` -- extraction-specific exports with ExportOptions flags controlling field inclusion; (3) `formatAnswerForCSV`/`formatAnswerForExcel` in the same file -- answer type formatters for all value types; (4) citation helpers in `lib/extraction/citations.ts` -- `getStructuredCitations`, `getCitationStatus`, `getPrimaryCitation`, `getAllCitationLocations` with PDF feature flag gating; and (5) `downloadAll`/`downloadItem` in `lib/search-actions.ts` -- search result download functions producing JSON/CSV with metadata.

All functions under test are pure logic (formatting, mapping, filtering) or have well-defined side effects (DOM download triggers) that can be mocked. The existing test for `extraction-citation-panel.test.ts` demonstrates the established pattern for testing PDF feature flag gating via `vi.resetModules()` and dynamic imports.

**Primary recommendation:** Test each module in its own test file following established project patterns. Mock DOM APIs (`document.createElement`, `URL.createObjectURL`) for download functions. Use `vi.resetModules()` for feature flag gating tests. No new dependencies needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all decisions left to Claude's discretion.

### Claude's Discretion
- Test data construction for papers with various answer types (null, boolean, number, string, array)
- How to test ExportOptions flag combinations (exhaustive vs representative)
- How to mock/test PDF feature flag gating for citation helpers
- How to test CSV special character escaping (commas, quotes, newlines in fields)
- DOM/download function mocking strategy for downloadAll/downloadItem
- Test organization (one file per module vs grouped by concern)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXPRT-01 | `jsonToCSV` produces correct CSV with proper headers, row values, and special character escaping | `jsonToCSV` in `lib/utils.ts` (line 142) + `escapeCSVValue` helper (line 128). Pure function, no dependencies. Test headers from sorted unique keys, row values, and escaping of commas, quotes, newlines, null/undefined. |
| EXPRT-02 | `exportToCSV`/`exportToJSON` include correct fields based on ExportOptions flags | `exportToCSV` (line 67) and `exportToJSON` (line 142) in `lib/extraction/export.ts`. Both call `downloadFile` internally. Test by mocking `downloadFile` and inspecting the content string passed to it. Verify field inclusion/exclusion for each flag combination. |
| EXPRT-03 | `formatAnswerForCSV` and `formatAnswerForExcel` handle all answer types correctly | Both in `lib/extraction/export.ts` (lines 22, 39). Pure functions. Test null, undefined, boolean true/false, number, string, array inputs. Key difference: `formatAnswerForExcel` returns `Number(answer)` for type='number'. |
| EXPRT-04 | Citation helpers return correct data and respect PDF feature flag gating | `getStructuredCitations`, `getCitationStatus`, `getPrimaryCitation`, `getAllCitationLocations` in `lib/extraction/citations.ts`. `getPrimaryCitation` and `getAllCitationLocations` check `extractionFeatureFlags.pdf`. Use `vi.resetModules()` pattern from existing `extraction-citation-panel.test.ts`. |
| EXPRT-05 | `downloadAll`/`downloadItem` produce correct output for JSON/CSV with search metadata | In `lib/search-actions.ts` (lines 140, 208). These depend on Zustand stores (`useRatingsStore`, `useSearchHistoryStore`), `createSearchParameters`, `validateAndExpandKeywordsSilently`. Mock stores and utility imports. Verify output structure for both formats. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | (project version) | Test runner | Already configured in Phase 14 with multi-environment routing |
| vi.mock/vi.spyOn | built-in | Mocking | Standard Vitest mocking, used across all v2.0 test phases |
| vi.resetModules | built-in | Module re-import for env var isolation | Established pattern in `extraction-citation-panel.test.ts` |

### Supporting
No additional libraries needed. All test subjects are pure functions or have mockable side effects.

## Architecture Patterns

### Test File Organization
```
tests/
├── export-csv-json.test.ts          # EXPRT-01: jsonToCSV + escapeCSVValue
├── export-extraction.test.ts        # EXPRT-02 + EXPRT-03: exportToCSV, exportToJSON, formatAnswerForCSV, formatAnswerForExcel
├── export-citations.test.ts         # EXPRT-04: citation helpers + PDF flag gating
├── export-download.test.ts          # EXPRT-05: downloadAll, downloadItem + search metadata
```

### Pattern 1: Pure Function Testing (EXPRT-01, EXPRT-03)
**What:** Direct input/output testing with no mocking needed
**When to use:** `jsonToCSV`, `escapeCSVValue`, `formatAnswerForCSV`, `formatAnswerForExcel`
**Example:**
```typescript
import { jsonToCSV } from '../lib/utils';

it('escapes commas in values', () => {
  const csv = jsonToCSV([{ name: 'Smith, John' }]);
  expect(csv).toContain('"Smith, John"');
});
```

### Pattern 2: Mock `downloadFile` for Export Functions (EXPRT-02)
**What:** `exportToCSV`/`exportToJSON` call `downloadFile` internally (not exported). Mock `document.createElement` and `URL.createObjectURL` to capture output, or restructure the test to validate the CSV/JSON content construction separately.
**When to use:** When testing export functions that trigger browser downloads
**Note:** `downloadFile` is a private function in `lib/extraction/export.ts`. The approach is to mock the DOM APIs it uses (`document.createElement`, `URL.createObjectURL`, `URL.revokeObjectURL`, `document.body.appendChild`, `document.body.removeChild`) since these tests run in node environment.

### Pattern 3: Feature Flag Gating via `vi.resetModules()` (EXPRT-04)
**What:** Test citation helpers with PDF feature flag on/off
**When to use:** `getPrimaryCitation`, `getAllCitationLocations` check `extractionFeatureFlags.pdf`
**Example (from existing `extraction-citation-panel.test.ts`):**
```typescript
const ORIGINAL = process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;
  else process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = ORIGINAL;
});

it('returns null when PDF disabled', async () => {
  process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = 'false';
  vi.resetModules();
  const { getPrimaryCitation } = await import('../lib/extraction/citations');
  expect(getPrimaryCitation(validResult)).toBeNull();
});
```

### Pattern 4: Zustand Store Mocking (EXPRT-05)
**What:** `downloadAll`/`downloadItem` call `useRatingsStore.getState()` and `useSearchHistoryStore.getState()`
**When to use:** Testing download functions that depend on global state
**Approach:** Mock the store modules via `vi.mock('../lib/store', ...)` to return controlled state. Also mock `downloadWithMetadata` and `createSearchParameters` from `../lib/utils`.

### Anti-Patterns to Avoid
- **Testing `downloadFile` DOM side effects in node environment:** Don't try to fully simulate DOM download behavior. Instead mock the Blob/URL APIs and verify the content string.
- **Snapshot-testing CSV output:** Brittle. Assert specific properties (header presence, value escaping, field count) instead.
- **Testing all ExportOptions permutations exhaustively:** 2^4 = 16 combos. Test representative cases: all-on, all-off, each flag individually.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV parsing for test assertions | Custom CSV parser | String assertions on known patterns | Tests should verify output format, not parse it |
| Feature flag test isolation | Manual env var save/restore | `vi.resetModules()` + dynamic import | Established pattern in project, handles module caching correctly |

## Common Pitfalls

### Pitfall 1: Module Caching Defeats Feature Flag Tests
**What goes wrong:** Changing `process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED` after import has no effect because `extractionFeatureFlags` is evaluated at module load time.
**Why it happens:** ES modules are cached. The feature flags object is created once when the module first loads.
**How to avoid:** Always call `vi.resetModules()` BEFORE the dynamic `import()` to force re-evaluation of the module and its feature flags.
**Warning signs:** Feature flag tests pass individually but fail when run together, or always return the same value regardless of env var changes.

### Pitfall 2: `downloadFile` Uses DOM APIs Not Available in Node
**What goes wrong:** `document.createElement('a')`, `document.body.appendChild`, `URL.createObjectURL` throw in node test environment.
**Why it happens:** Export functions in `lib/extraction/export.ts` and `lib/utils.ts` directly manipulate the DOM.
**How to avoid:** For `exportToCSV`/`exportToJSON` tests, mock at the module level or mock the global DOM APIs. For `jsonToCSV` and format functions, they're pure and don't touch the DOM.
**Warning signs:** `ReferenceError: document is not defined` during test runs.

### Pitfall 3: CSV Escaping Edge Cases
**What goes wrong:** Missing tests for double-quote escaping within already-quoted fields, or fields that are empty strings.
**Why it happens:** `escapeCSVValue` quotes fields containing `"`, `,`, `\n`, `\r`, or empty strings. The quoting uses `""` to escape internal quotes. Easy to miss the empty string case.
**How to avoid:** Explicitly test: value with comma, value with quote, value with newline, value with CR, empty string, null, undefined, nested object (which gets JSON.stringified).

### Pitfall 4: Zustand Store Mock Leaks Between Tests
**What goes wrong:** Mock store state from one test leaks to another, causing intermittent failures.
**Why it happens:** `vi.mock` is hoisted and persists across tests unless explicitly cleared.
**How to avoid:** Use `vi.mocked()` with `.mockReturnValue()` in each test, or use `beforeEach` to reset mock return values.

## Code Examples

### jsonToCSV Internal Mechanics
```typescript
// lib/utils.ts - escapeCSVValue behavior:
escapeCSVValue(null)           // → ''
escapeCSVValue(undefined)      // → ''
escapeCSVValue('hello')        // → 'hello' (no quoting needed)
escapeCSVValue('Smith, John')  // → '"Smith, John"'
escapeCSVValue('say "hello"')  // → '"say ""hello"""'
escapeCSVValue('line1\nline2') // → '"line1\nline2"'
escapeCSVValue('')             // → '""' (empty string is quoted)
escapeCSVValue({a: 1})         // → '{"a":1}' (JSON.stringified, may need quoting if contains special chars)
```

### formatAnswerForCSV vs formatAnswerForExcel Differences
```typescript
// Both share: null → '', boolean → 'Yes'/'No', array → items.join('; ')
// Key difference:
formatAnswerForCSV(42, 'number')   // → '42' (String)
formatAnswerForExcel(42, 'number') // → 42  (Number)
formatAnswerForCSV('text', 'string')   // → 'text'
formatAnswerForExcel('text', 'string') // → 'text'
```

### Citation Helper Return Shapes
```typescript
// getStructuredCitations: filters invalid citations, returns CitationEvidence[]
// getCitationStatus: validates status string against known values
// getPrimaryCitation: returns first citation as CitationLocation (or null if PDF disabled)
// getAllCitationLocations: returns all citations as CitationLocation[] (or [] if PDF disabled)
```

## Open Questions

1. **`downloadAll`/`downloadItem` store dependencies**
   - What we know: These functions call `useRatingsStore.getState()` and `useSearchHistoryStore.getState()` synchronously
   - What's unclear: Whether `vi.mock` can cleanly mock these Zustand stores in node environment without jsdom
   - Recommendation: Mock the entire store module. If issues arise, extract the pure logic and test it separately.

2. **`exportToCSV`/`exportToJSON` private `downloadFile` dependency**
   - What we know: `downloadFile` is not exported, uses DOM APIs
   - What's unclear: Best mocking strategy -- mock DOM globals vs restructure for testability
   - Recommendation: Mock `document.createElement`, `URL.createObjectURL` etc. at global level in test setup, or mock at Blob level. The existing `downloadAsFile` in utils.ts shows the same pattern -- both use DOM. Since these run in node env, mock the globals.

## Sources

### Primary (HIGH confidence)
- Direct source code analysis of `lib/utils.ts`, `lib/extraction/export.ts`, `lib/extraction/citations.ts`, `lib/extraction/feature-flags.ts`, `lib/search-actions.ts`
- Existing test pattern from `tests/extraction-citation-panel.test.ts` for feature flag gating
- Project Vitest configuration from Phase 14

### Secondary (MEDIUM confidence)
- Vitest mocking documentation for `vi.resetModules()` and `vi.mock()` patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, using established Vitest patterns
- Architecture: HIGH - all source files analyzed, function signatures and dependencies mapped
- Pitfalls: HIGH - based on direct analysis of module caching, DOM dependencies, and store coupling

**Research date:** 2026-02-28
**Valid until:** Indefinite (testing pure functions in a stable codebase)
