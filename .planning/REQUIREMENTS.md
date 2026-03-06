# Requirements: OpenAlex Count v3.2

**Defined:** 2026-03-06
**Core Value:** Reliable, well-tested academic search and AI extraction

## v3.2 Requirements

Requirements for production readiness. Each maps to roadmap phases.

### Security

- [x] **SEC-01**: Debug query functions converted from public to internal (no client access possible)
- [ ] **SEC-02**: Debug gate module (`debug_gate.ts`) and env var pattern deleted
- [x] **SEC-03**: Debug gate test updated to verify internal function registration

### Performance — Counting

- [ ] **PERF-01**: Library count query uses denormalized counter (not `.take(10_000).length`)
- [ ] **PERF-02**: Counter atomically incremented/decremented in all save/delete mutations
- [ ] **PERF-03**: Lazy backfill computes count on first access for existing users

### Performance — Query Bounding

- [ ] **PERF-04**: All high-traffic `.collect()` calls bounded with `.take(N)` and documented MAX constants
- [ ] **PERF-05**: Cascade delete paths verified to not be over-bounded (no orphaned data)

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Observability

- **OBS-01**: Structured logging framework replacing console.log/warn/error
- **OBS-02**: Correlation IDs for tracing requests across function calls

### Testing

- **TEST-01**: Component-level tests for critical UI flows
- **TEST-02**: Unit tests for extraction workpool action steps

## Out of Scope

| Feature | Reason |
|---------|--------|
| `@convex-dev/aggregate` component | Overkill for single per-user counter with low write frequency |
| `@convex-dev/sharded-counter` component | Low contention makes sharding unnecessary; manual counter simpler |
| Structured logging | Separate concern, not a production blocker |
| Component tests | Important but not a launch blocker |
| Workpool action unit tests | Integration coverage exists via workflows |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 72 | Complete |
| SEC-02 | Phase 72 | Pending |
| SEC-03 | Phase 72 | Complete |
| PERF-01 | Phase 73 | Pending |
| PERF-02 | Phase 73 | Pending |
| PERF-03 | Phase 73 | Pending |
| PERF-04 | Phase 74 | Pending |
| PERF-05 | Phase 74 | Pending |

**Coverage:**
- v3.2 requirements: 8 total
- Mapped to phases: 8
- Unmapped: 0

---
*Requirements defined: 2026-03-06*
*Last updated: 2026-03-06 after roadmap creation*
