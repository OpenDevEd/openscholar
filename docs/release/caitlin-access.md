# Caitlin access implementation

Library assignments, invitations, configuration Team and cross-organization list. Resolve roles through one shared Convex helper.

Owner access is inherited from organization ownership. Editor and Creator access is library-specific and may be granted without organization membership. Ordinary organization membership alone grants no editorial access. The same identity may have different roles across libraries. Existing role changes and revocations must affect established admin sessions.

Use the existing Clerk identity, Convex projections, library credential and admin handoff. Keep team management in library configuration and use the actual approved mock components, preserving their markup and styles while replacing fixtures and callbacks with real data and interactions. The only permitted redesign is the checkbox and its surrounding text beneath the Crossref/Zenodo tabs. Do not ship mock transport, fixtures or role selection as authorization. Creators prepare drafts, files and references; only Editors/Owners publish or activate providers.

## Verification and delivery

- [ ] Implement the connected OpenScholar/runtime permission contract.
- [ ] Verify cross-library isolation, invitations and role revocation with focused tests.
- [ ] Exercise real configuration, invitation and admin flows in Zen using computer use against isolated development services.
- [ ] Run one Fable 5.1 review of the complete access part via Claude Code. Fix findings and verify locally without a second review.
- [ ] Pass required CI on each final PR head before merging into OpenScholar dev and Evidence Library main. Do not push production branches.

Issue scope: OpenDevEd/openalex-count#174 and #46. Editorial review and snapshots are the next part; this access work must not expose Creator publication routes in the interim. Product documentation is deferred.

## Deployment requirements

Convex needs `CLERK_SECRET_KEY` for verified-email invitation acceptance, in addition to the existing Clerk issuer and webhook settings. Set it on the Convex deployment, not only on the Next.js application. The isolated Caitlin backend has this key; verify and install it on shared development before rollout. `EL_SMTP_*` and `NEXT_PUBLIC_APP_URL` must also point to the intended delivery service and OpenScholar app.

The access phase received its single Fable 5.1 review on 2026-09-09. The first CLI account failed authentication before any review ran; the alternate configured account completed the review. Findings cover credential-error reporting, recovery actions, delivery status, deleted-user grants, deployment prerequisites and invitation wording. Verify fixes locally and through final CI; do not request another access review.
