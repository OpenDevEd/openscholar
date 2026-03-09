# Requirements: OpenAlex Count v4.0

**Defined:** 2026-03-08
**Core Value:** Reliable, well-tested academic search and AI extraction

## v4.0 Requirements

Requirements for Bulk Screening & Auto-Rating milestone. Each maps to roadmap phases.

### Bulk Job Infrastructure

- [ ] **JOB-01**: User can trigger a bulk screening job for up to 200 search results from the results page
- [ ] **JOB-02**: User sees how many papers will be screened (capped at 200 with clear messaging if results exceed cap)
- [ ] **JOB-03**: User sees estimated credit cost before confirming the job
- [ ] **JOB-04**: System verifies user has sufficient credits before starting the job
- [ ] **JOB-05**: Bulk screening runs in background via Convex workflow (papers processed even if user closes browser)
- [ ] **JOB-06**: User can view real-time progress of a running job (X/N papers screened)
- [ ] **JOB-07**: User can cancel a running bulk screening job (stops processing, keeps partial results)
- [ ] **JOB-08**: User can view a list of past bulk screening jobs with status, paper count, and date

### Scoring & Rating

- [ ] **SCORE-01**: User can define point values per screening question for each answer (yes → +/- points, no → +/- points, null/uncertain → +/- points)
- [ ] **SCORE-02**: System computes a total score per paper based on AI screening responses and user-defined rules
- [ ] **SCORE-03**: User can define star rating thresholds (score ranges that map to 0-5 stars)
- [ ] **SCORE-04**: System maps each paper's total score to a star rating using user-defined thresholds
- [ ] **SCORE-05**: User can set a minimum score threshold — only papers meeting the threshold are saved to library

### Library & Collection Integration

- [ ] **LIB-01**: Qualifying papers are automatically saved to the user's library with the computed star rating
- [ ] **LIB-02**: Qualifying papers are automatically added to the user-selected collection
- [ ] **LIB-03**: User selects a target collection (or creates a new one) in the configuration dialog

### Configuration Dialog

- [ ] **DIALOG-01**: "Screen All" button on results page opens a configuration dialog
- [ ] **DIALOG-02**: Dialog displays the screening questions from the existing screening panel
- [ ] **DIALOG-03**: Dialog provides a scoring rules editor per question (point values for yes/no/null)
- [ ] **DIALOG-04**: Dialog provides a star rating threshold editor (score ranges → stars)
- [ ] **DIALOG-05**: Dialog includes a collection picker with option to create new collection
- [ ] **DIALOG-06**: Dialog shows paper count, credit cost estimate, and confirm/cancel buttons
- [ ] **DIALOG-07**: Dialog prevents dismissal during job submission (dismiss guards like upgrade dialog)

## Future Requirements

### Bulk Screening Enhancements

- **JOB-09**: Plan-tier limits on bulk screening cap (free=50, go=100, pro=200)
- **JOB-10**: Bulk screening job results page with detailed per-paper breakdown
- **SCORE-06**: Saved scoring rule presets that users can reuse across searches
- **SCORE-07**: Export screening results with scores to CSV/JSON

## Out of Scope

| Feature | Reason |
|---------|--------|
| Active learning / priority ordering | Only pays off at 10,000+ papers; 200-paper cap makes sequential sufficient |
| Full-text PDF screening | Scope limited to title + abstract; PDF adds cost and complexity |
| Modifying existing per-page screening | Zustand-based per-page screening stays as-is; bulk is separate |
| Shared/collaborative screening jobs | Requires permission model; personal use only for now |
| Real-time WebSocket progress | Convex reactive queries provide real-time updates natively |
| Scoring rule marketplace/templates | User defines their own rules; no preset library needed for v4.0 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| JOB-01 | Phase 75 | Pending |
| JOB-02 | Phase 78 | Pending |
| JOB-03 | Phase 78 | Pending |
| JOB-04 | Phase 75 | Pending |
| JOB-05 | Phase 77 | Pending |
| JOB-06 | Phase 78 | Pending |
| JOB-07 | Phase 75 | Pending |
| JOB-08 | Phase 78 | Pending |
| SCORE-01 | Phase 76 | Pending |
| SCORE-02 | Phase 76 | Pending |
| SCORE-03 | Phase 76 | Pending |
| SCORE-04 | Phase 76 | Pending |
| SCORE-05 | Phase 76 | Pending |
| LIB-01 | Phase 77 | Pending |
| LIB-02 | Phase 77 | Pending |
| LIB-03 | Phase 77 | Pending |
| DIALOG-01 | Phase 78 | Pending |
| DIALOG-02 | Phase 78 | Pending |
| DIALOG-03 | Phase 78 | Pending |
| DIALOG-04 | Phase 78 | Pending |
| DIALOG-05 | Phase 78 | Pending |
| DIALOG-06 | Phase 78 | Pending |
| DIALOG-07 | Phase 78 | Pending |

**Coverage:**
- v4.0 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0

---
*Requirements defined: 2026-03-08*
*Last updated: 2026-03-09 after roadmap creation*
