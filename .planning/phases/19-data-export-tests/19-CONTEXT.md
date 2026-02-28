# Phase 19: Data Export Tests - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Test CSV/JSON export correctness, answer formatting for all types, citation helpers with PDF feature flag gating, and download output shape. Verify field inclusion/exclusion based on ExportOptions flags. No production code changes — tests only.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
- Test data construction for papers with various answer types (null, boolean, number, string, array)
- How to test ExportOptions flag combinations (exhaustive vs representative)
- How to mock/test PDF feature flag gating for citation helpers
- How to test CSV special character escaping (commas, quotes, newlines in fields)
- DOM/download function mocking strategy for downloadAll/downloadItem
- Test organization (one file per module vs grouped by concern)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Success criteria are fully defined in ROADMAP.md (EXPRT-01 through EXPRT-05).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-data-export-tests*
*Context gathered: 2026-02-28*
