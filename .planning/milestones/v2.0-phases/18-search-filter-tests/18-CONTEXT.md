# Phase 18: Search & Filter Tests - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Test search parameter construction, region encoding bijectivity, filter assembly, keyword validation/expansion, and URL param serialization round-trips. Verify all filter types translate correctly to OpenAlex API params. No production code changes — tests only.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
- Test data construction for each filter type (field, year range, date range, cites, citedBy, relatedTo, region, countryFocus, reviewOnly)
- How to test region codec bijectivity exhaustively (iterate all entries vs representative sample)
- How to test URL param serialization round-trips (which param combinations to test)
- How to handle keyword bookmark expansion test data
- Test organization (one file per module vs grouped by concern)
- Edge case selection for each function

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Success criteria are fully defined in ROADMAP.md (SRCH-01 through SRCH-06).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-search-filter-tests*
*Context gathered: 2026-02-28*
