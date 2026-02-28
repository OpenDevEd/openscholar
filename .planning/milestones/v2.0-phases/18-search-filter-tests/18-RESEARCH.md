# Phase 18: Search & Filter Tests - Research

**Researched:** 2026-02-28
**Domain:** Search parameter construction, region encoding, filter assembly, keyword validation, URL serialization
**Confidence:** HIGH

## Summary

Phase 18 tests pure-logic modules with zero external dependencies at runtime. All six target functions/modules (`createSearchParameters`, region codec, `buildFilterData`, filter active predicates, `validateAndExpandKeywords`, URL param serialization) are deterministic, synchronous, and side-effect-free -- making them ideal for fast unit tests in the Node environment.

The existing test infrastructure (Phase 14) provides a multi-environment Vitest config with `tests/setup.ts`. All Phase 18 tests run in the default `node` environment since they test pure TypeScript logic with no DOM or edge-runtime requirements.

**Primary recommendation:** One test file per source module, exhaustive `it.each` tables for combinatorial coverage, bijectivity loops for codecs, and snapshot-free assertion style matching the existing codebase conventions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(None -- CONTEXT.md has no locked decisions section)

### Claude's Discretion
- Test data construction for each filter type (field, year range, date range, cites, citedBy, relatedTo, region, countryFocus, reviewOnly)
- How to test region codec bijectivity exhaustively (iterate all entries vs representative sample)
- How to test URL param serialization round-trips (which param combinations to test)
- How to handle keyword bookmark expansion test data
- Test organization (one file per module vs grouped by concern)
- Edge case selection for each function

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-01 | `createSearchParameters` translates all filter combinations to OpenAlex API params | Function at `lib/utils.ts:224` is pure, takes `(query, SearchFilters)`, returns params object. Test with `it.each` over all filter types. |
| SRCH-02 | Region codec bijectivity for all INTERNAL_TO_URL_CODE entries | `lib/search-params/regions.ts` has 27 region entries + country codes. Iterate all entries for `decode(encode(x)) === x` and `encode(decode(s)) === s`. |
| SRCH-03 | `buildFilterData` assembles correct filter sections | `lib/filters/filter-builder.ts:254` takes `FilterParams` and returns `FilterSection[]`. Test each section type independently. |
| SRCH-04 | Filter active predicates return correct booleans | 7 predicates in `lib/utils.ts:71-120`. Test active/inactive/edge cases for each. |
| SRCH-05 | `validateAndExpandKeywords` rejects invalid queries and expands bookmarks | `lib/keyword-validation.ts` -- needs Zustand store mock for `useKeywordExpansionStore`. |
| SRCH-06 | URL param serialization round-trips | `lib/search-params/parsers.ts` uses `nuqs` library. `serializeSearchParams` + manual parse round-trip. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (project) | Test framework | Already configured in vitest.config.ts |
| nuqs | (project) | URL param serialization | Already used in parsers.ts for search params |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @testing-library/jest-dom | (project) | Extended matchers | Already in setup.ts, available for all tests |

### No Additional Libraries Needed
All tests are pure unit tests against existing functions. No mocking libraries needed beyond Vitest's built-in `vi.mock` for Zustand store mocking.

## Architecture Patterns

### Recommended Test Structure
```
tests/
├── search-params-construction.test.ts  # SRCH-01: createSearchParameters
├── region-codec.test.ts                # SRCH-02: encodeRegions/decodeRegions bijectivity
├── filter-builder.test.ts              # SRCH-03: buildFilterData sections
├── filter-predicates.test.ts           # SRCH-04: isXxxFilterActive predicates
├── keyword-validation.test.ts          # SRCH-05: validateAndExpandKeywords
└── search-params-serialization.test.ts # SRCH-06: URL round-trip
```

### Pattern 1: Parameterized Testing with `it.each`
**What:** Use Vitest's `it.each` for combinatorial filter testing
**When to use:** Testing the same function with many input variations
**Example:**
```typescript
it.each([
  ['title', 'machine learning', { title: { search: 'machine learning' } }],
  ['abstract', 'neural nets', { abstract: { search: 'neural nets' } }],
  ['fulltext', 'deep learning', { fulltext: { search: 'deep learning' } }],
])('maps field=%s with query=%s to filter %j', (field, query, expectedFilter) => {
  const result = createSearchParameters(query, { ...defaultFilters, searchField: field });
  expect(result.filter).toMatchObject(expectedFilter);
});
```

### Pattern 2: Bijectivity Testing for Codecs
**What:** Exhaustive round-trip in both directions
**When to use:** Testing encode/decode pairs
**Example:**
```typescript
Object.entries(INTERNAL_TO_URL_CODE).forEach(([internal, urlCode]) => {
  it(`encode then decode: ${internal} -> ${urlCode} -> ${internal}`, () => {
    const encoded = encodeRegions([internal]);
    const decoded = decodeRegions(encoded);
    expect(decoded).toContain(internal);
  });
  it(`decode then encode: ${urlCode} -> ${internal} -> ${urlCode}`, () => {
    const decoded = decodeRegions(urlCode);
    const reEncoded = encodeRegions(decoded);
    expect(reEncoded).toBe(urlCode);
  });
});
```

### Pattern 3: Zustand Store Mocking
**What:** Mock `useKeywordExpansionStore.getState()` for keyword expansion tests
**When to use:** Testing `validateAndExpandKeywords` which reads from Zustand
**Example:**
```typescript
vi.mock('../lib/store', () => ({
  useKeywordExpansionStore: {
    getState: () => ({
      expandQuery: (query: string) => {
        // Mock implementation
        const expandedQuery = query.replace(/ml\.\.\./g, '(machine learning OR ML)');
        return { expandedQuery, warnings: [] };
      },
    }),
  },
}));
```

### Anti-Patterns to Avoid
- **Snapshot testing for filter output:** Filter sections contain icons (React components) that don't serialize well. Use structural assertions instead.
- **Testing with real COUNTRIES import in region codec:** The full COUNTRIES map is large. Tests should verify codec logic, not country data completeness.
- **Mocking nuqs internals:** For serialization round-trips, use the exported `serializeSearchParams` and `searchParamsParsers` directly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parameterized tests | Manual for-loops | `it.each` or `describe.each` | Better test naming, proper isolation |
| Store mocking | Manual store replacement | `vi.mock` with inline factory | Vitest handles module caching |
| URL parsing for round-trip | Manual URLSearchParams parsing | nuqs `createParser` / parse methods | Matches production code path |

## Common Pitfalls

### Pitfall 1: Zustand Store Not Mocked for Keyword Tests
**What goes wrong:** `validateAndExpandKeywords` calls `useKeywordExpansionStore.getState()` which fails in Node test environment without Zustand setup
**Why it happens:** Zustand stores need browser-like module initialization
**How to avoid:** Use `vi.mock('../lib/store', ...)` at the top of keyword validation test file
**Warning signs:** "Cannot read properties of undefined (reading 'getState')"

### Pitfall 2: `COUNTRIES` Import Pulls in Full Constants
**What goes wrong:** `lib/constants.ts` exports a large COUNTRIES map and region maps. Importing for tests is fine since it's pure data, but tests should not depend on specific country counts.
**Why it happens:** The constants file has 250+ country entries
**How to avoid:** Test codec logic with known entries from INTERNAL_TO_URL_CODE, not by counting countries

### Pitfall 3: Date Object Comparison
**What goes wrong:** `createSearchParameters` converts Date objects to ISO strings. Tests must use consistent Date inputs.
**Why it happens:** `new Date()` creates timezone-dependent objects; `toISOString().split('T')[0]` extracts the date part
**How to avoid:** Use explicit UTC dates: `new Date('2024-01-15T00:00:00Z')`

### Pitfall 4: `DEFAULT_FILTERS.yearRange()` is Dynamic
**What goes wrong:** `yearRange` default uses `new Date().getFullYear()`, so default filter comparison is time-sensitive
**Why it happens:** The year range default factory function returns current year
**How to avoid:** Test with explicit year ranges, not by comparing to defaults

### Pitfall 5: nuqs Serializer Behavior
**What goes wrong:** `serializeSearchParams` with `clearOnDefault: false` will include default values in the URL string
**Why it happens:** The serializer is configured to preserve defaults for valid URLs
**How to avoid:** Round-trip tests should compare parsed values, not raw URL strings

### Pitfall 6: LucideIcon Imports in filter-builder
**What goes wrong:** `buildFilterData` returns `FilterItem` objects containing `icon` (a LucideIcon component). Testing in Node environment requires careful assertion -- don't deep-equal the full object.
**Why it happens:** `filter-config.ts` maps filter types to Lucide React icon components
**How to avoid:** Assert on structural properties (id, items.length, displayValue) rather than full object equality. Use `expect(section.items[0]).toMatchObject({ key: 'year', displayValue: '2020 - 2024' })`.

## Code Examples

### createSearchParameters Test Shape
```typescript
import { createSearchParameters, createDefaultFilters } from '../lib/utils';
import type { SearchFilters } from '../lib/types';

describe('createSearchParameters', () => {
  const baseFilters = createDefaultFilters();

  it('sets search filter for title_and_abstract field', () => {
    const result = createSearchParameters('quantum', baseFilters);
    expect(result.filter.title_and_abstract).toEqual({ search: 'quantum' });
  });

  it('adds cites filter with OpenAlex URL prefix', () => {
    const filters = { ...baseFilters, citesItemId: 'W123' };
    const result = createSearchParameters('test', filters);
    expect(result.filter.cites).toBe('https://openalex.org/W123');
  });
});
```

### Region Codec Bijectivity Test Shape
```typescript
import { INTERNAL_TO_URL_CODE, encodeRegions, decodeRegions } from '../lib/search-params/regions';

describe('region codec bijectivity', () => {
  const entries = Object.entries(INTERNAL_TO_URL_CODE);

  it.each(entries)('encode(decode(%s)) round-trips for internal=%s, url=%s', (internal, urlCode) => {
    const encoded = encodeRegions([internal]);
    expect(encoded).toBe(urlCode);
    const decoded = decodeRegions(encoded);
    expect(decoded).toContain(internal);
  });
});
```

### Filter Predicates Test Shape
```typescript
import { isDateFilterActive, isRatingFilterActive } from '../lib/utils';

describe('filter active predicates', () => {
  it('isDateFilterActive returns false for year filter when not enabled', () => {
    expect(isDateFilterActive(undefined, [2020, 2025], 'year', false)).toBe(false);
  });

  it('isRatingFilterActive returns false when onlyRated is false', () => {
    expect(isRatingFilterActive([3, 5], false)).toBe(false);
  });
});
```

## Open Questions

1. **nuqs parse function availability in Node**
   - What we know: `serializeSearchParams` is a function exported from parsers.ts that creates URL query strings. Individual parsers have `.parse()` methods.
   - What's unclear: Whether nuqs parsers work correctly outside Next.js context in plain Node tests
   - Recommendation: Test serialization output format directly; if parse fails in Node, test decode logic separately

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all target files
- `lib/utils.ts` -- `createSearchParameters` (line 224), filter predicates (lines 71-120), `DEFAULT_FILTERS` (line 9)
- `lib/search-params/regions.ts` -- Region codec with 27 entries
- `lib/search-params/parsers.ts` -- nuqs-based URL serialization
- `lib/filters/filter-builder.ts` -- `buildFilterData` (line 254)
- `lib/keyword-validation.ts` -- `validateAndExpandKeywords`
- `lib/store.ts` -- `useKeywordExpansionStore` with `expandQuery` (line 711)
- `vitest.config.ts` -- Test infrastructure already configured
- Existing test patterns from `tests/ai-question-key-codec.test.ts`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All tools already in project
- Architecture: HIGH - Follows established test patterns from Phase 14-17
- Pitfalls: HIGH - Direct codebase inspection reveals all dependencies

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable -- pure logic tests)
