# Caitlin access implementation

Library assignments, invitations, configuration Team and cross-organization list. Resolve roles through one shared Convex helper.

Owner access is inherited from organization ownership. Editor and Creator access is library-specific and may be granted without organization membership. Ordinary organization membership alone grants no editorial access. The same identity may have different roles across libraries. Existing role changes and revocations must affect established admin sessions.

Use the existing Clerk identity, Convex projections, library credential and admin handoff. Keep team management in library configuration and preserve the approved mock layout. Do not ship mock transport, fixtures or role selection as authorization. Creators prepare drafts, files and references; only Editors/Owners publish or activate providers.

## Verification and delivery

- [ ] Implement the connected OpenScholar/runtime permission contract.
- [ ] Verify cross-library isolation, invitations and role revocation with focused tests.
- [ ] Exercise real configuration, invitation and admin flows in Zen using computer use against isolated development services.
- [ ] Run one Fable 5.1 review of the complete access part via Claude Code. Fix findings and verify locally without a second review.
- [ ] Pass required CI on each final PR head before merging into OpenScholar dev and Evidence Library main. Do not push production branches.

Issue scope: OpenDevEd/openalex-count#174 and #46. Editorial review and snapshots are the next part; this access work must not expose Creator publication routes in the interim. Product documentation is deferred.
