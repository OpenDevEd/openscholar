# Requirements: OpenAlex Count

**Defined:** 2026-03-12
**Core Value:** Reliable, well-tested academic search and AI extraction

## v5.1 Requirements

Requirements for Smart Grouping & PDF-Disabled Cleanup milestone.

### Answer Clustering

- [ ] **GROUP-01**: After extraction completes, system runs one LLM call per question to cluster unique answers into canonical semantic groups
- [ ] **GROUP-02**: Clustered groups stored in DB and used by frontend instead of static synonym map
- [ ] **GROUP-03**: Existing completed jobs can be re-clustered on demand (backfill)

### PDF-Disabled Cleanup

- [ ] **PDF-01**: Papers without abstracts silently excluded when PDF disabled — never inserted into DB
- [ ] **PDF-02**: No confidence cap (0.7) or citation penalty (best_effort) in abstract-only mode when PDF feature disabled
- [ ] **PDF-03**: PDF-specific UI elements (citation status bars, grounded rate, indexed/PDF badges) hidden when feature flag off
- [ ] **PDF-04**: Neutral i18n messages replacing PDF-specific text across all 6 locales
- [ ] **PDF-05**: All PDF cleanup changes verified with passing test suite (1077+ tests)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Fuzzy string matching (Levenshtein) | LLM clustering supersedes; string similarity can't link "banking" → "finance" |
| User-driven manual merge/unmerge UI | Deferred to v5.2+; LLM clustering handles 80% case |
| Re-extraction with controlled vocabulary | Requires prompt changes and re-running all jobs; clustering is non-destructive |
| PDF re-enablement testing | PDF is disabled for the foreseeable future |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| GROUP-01 | TBD | Pending |
| GROUP-02 | TBD | Pending |
| GROUP-03 | TBD | Pending |
| PDF-01 | TBD | Complete (implemented) |
| PDF-02 | TBD | Complete (implemented) |
| PDF-03 | TBD | Complete (implemented) |
| PDF-04 | TBD | Complete (implemented) |
| PDF-05 | TBD | Pending (needs deploy verification) |

**Coverage:**
- v5.1 requirements: 8 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 8

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 after milestone v5.1 definition*
