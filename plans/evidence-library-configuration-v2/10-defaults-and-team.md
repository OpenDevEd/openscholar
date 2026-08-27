# Plan 10 — Defaults and the Team section

## Goal

Four owner-facing changes the user asked for on 2026-08-27 after using the
live configuration page.

## Fixed decisions (user)

1. Logo and favicon are not required. When the owner uploads nothing, the
   platform puts the OpenScholar logo and favicon into the config.
2. Contact and takedown recipients are switchable and off by default.
3. PostHog and Google Analytics can both be on at the same time.
4. Team lists the real people: Owners = organisation admins, Editors =
   organisation members, each with name and email. The manage control gets a
   proper design.
5. Per-card "Reset changes" and status chips stay as they are (user: keep).

## Scope

1. **Default brand assets.** `identity.assets.logoDark` and `favicon` are
   required by the runtime (`schema.ts:160-166`, `stableImageUrlSchema`).
   Remove the page rule that makes uploads required (Theme/Identity cards
   show "Uses the OpenScholar logo until you upload one"). At assembly
   (`lib/evidence-libraries/configuration/assembly.ts`) fill missing
   `logoDark`/`logoLight`/`favicon` from platform values read like the other
   managed values (`convex/evidenceLibraries/runtimeConfiguration.ts`):
   `EL_DEFAULT_LOGO_URL`, `EL_DEFAULT_FAVICON_URL`. Upload the OpenScholar
   logo (`public/` in this repo has the brand files; check) and favicon once
   to the platform `openscholar` bucket with the existing upload helper as a
   one-off script or admin action, and set the two env values on the shared
   deployment. The URLs must satisfy the runtime's stable-URL rule (read it).
2. **Recipients switchable.** Contact & legal: "Contact form" and "Takedown
   requests" each get a `ToggleRow`; off by default; the email field appears
   only when on. Remove the hand rule "takedown recipient required"
   (`rules.ts`, `owner-rules.ts` if present) and update plan 06's row and its
   tests. Off = the key is not written. The platform-mail check stays as is.
3. **Both analytics providers.** Analytics card: two `ToggleRow`s (PostHog,
   Google Analytics), each revealing its fields when on; both may be on.
   `rules.ts` writes both objects; the "only the chosen provider" logic and
   `AnalyticsProvider` union go away. Runtime: `analyticsSchema`
   `schema.ts:1337-1357` (posthog + google are independent).
4. **Team section.** New query in `convex/evidenceLibraries/queries.ts` (or
   `organizations`) returning the organisation's admins and members from the
   projected `organizationMemberships` (name, email, role) — check what the
   Clerk webhook projection stores; if email/name are missing from the
   projection, extend the webhook projection (Convex + test) rather than
   calling Clerk at render time. The card shows two lists (Owners, Editors)
   with avatar initials, name, email, and a plain "Manage people" link/button
   styled like the other card actions (compare the mock's team-section.tsx on
   `feat/library-interface-mock` for spacing and type), no three loose cards.
   Empty states: "No editors yet."

## Design rules

`plans/evidence-library-full-configuration-mock/00-README.md` on the mock
branch. Six locales, English mirrored.

## Migration

None; development data is disposable. Existing drafts that saved recipients
keep them (the switch reads "on" when a value exists).

## Tests

- assembly: missing assets filled from platform values; owner assets win.
- rules: recipients off write nothing; on requires a valid email; both
  analytics objects written; validators pass (pinned + runtime, throwaway).
- components: contact switches reveal fields; analytics both on; team lists
  people by role with empty states.

## Deployability gate

Lane: `npx convex dev --once`, `npm run dev:web`, open the four cards signed
in, screenshots. After merge: `npm run convex:push`, set `EL_DEFAULT_*` on the
shared deployment, publish one `el-*` library with no uploads and no
recipients and both analytics on; the public site must show the OpenScholar
logo and favicon; tear it down.

## Completion

All four items live on dev.openscholar.ai and shown to the user.
