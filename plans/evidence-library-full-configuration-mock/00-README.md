# Full configuration page mock

Decided with the user on 2026-08-26. This is a click-through mock in the
`feat/library-interface-mock` worktree. Nothing here writes to Convex yet.
Every interaction is faked in the Zustand store with short timers.

## What the page is

One long page with the approved Anchor rail. The rail scrolls to a section.
Save and Activate stay in the sticky header. Every change is a draft; Activate
publishes one version and shows the deploy banner.

## Rail order and groups

Brand: Identity · Theme · Institutions
Content: Navigation · Footer · Contact & Legal · Collections
Discovery: Search & Filters · Citations & Exports · Features · Sources
Platform: Languages · Analytics · Team & Visibility
Publishing: Domain · Versions
Danger zone

Every rail item shows a state dot: complete, needs attention (required field
empty or a dependency rule fails), changed.

## Sections and fields

Identity: name, short name, address (read-only), tagline, description,
funding partners (name list), share image upload (PNG, 2 MB).

Theme: layout small/wide, default mode light/dark/system, fonts heading + body
from Montserrat/Poppins/Ubuntu with a sample, colours accent/secondary/link
with swatch picker, hex field, 8 presets, contrast warning; Advanced (collapsed):
dark/light background, dark/light card. Uploads: dark logo, light logo, favicon
(SVG/PNG/WEBP, 1 MB; favicon sizes are made for the owner).

Institutions: list of name + logo upload; add, edit, reorder, remove.

Navigation: up to 12 links. Label, target = built-in page (Home, Library, Map,
Contact, Privacy, Cookie policy, Takedown) / collection / external URL, icon
from the 15-icon catalog, open in new tab, visible, one level of children,
drag reorder. "Show search in navbar" toggle.

Footer: up to 6 link sections, social links (GitHub, X, LinkedIn, YouTube,
Bluesky), funders (name, logo upload, link), disclaimer, attribution,
"Powered by OpenScholar" toggle locked on with a "paid plans" tooltip.

Contact & Legal: contact email, phone, address, contact-form recipient,
takedown recipient (required). Privacy / cookie / terms: each is a Markdown or
text file upload (200 KB) or an external URL; file rows show name, size, View,
Replace, Remove.

Collections: presentation only. Order, show/hide, title override, featured
on home.

Search & Filters: toggles full text, tags, country, author country; scope
checklist + default scope; institution facet mode (+ featured value); year
range; collections expanded.

Citations & Exports: show URL in citations; RIS / BibTeX / Atom on/off.

Features: grouped toggles. Appearance: theme switcher, language switcher.
Accounts: login, Google sign-in, user collections. AI: AI, AI search, deep
research, related resources, provider + model. Discovery: collections,
collection notes, map page, author filter, author location, years dropdown.
Exports: downloads, Atom feed. A toggle whose dependency is off is disabled
with the reason.

Sources: multiple Zotero groups. Connect with Zotero sign-in or API key, group
ID, enabled, writeback, last sync, Sync now (mock progress), remove. Advanced
(collapsed): Zotero tag rules as chip inputs.

Languages: locales, default, detect from browser, priority order.

Analytics: provider none / PostHog (host + key) / Google (G- id). No consent
toggle; GDPR mode is always on.

Team & Visibility: visibility Public / Members only. Access list: rows of
person or organisation, role Editor / Viewer, status Active / Invited, remove.
Owners come from the owning Clerk organisation and are shown read-only.
Invite dialog with Person (email) and Organisation (search) tabs. Person grants
win over organisation grants. Read-only "Plan: Free · Manage" line.

Domain: custom domain field, DNS table (CNAME + TXT), Check DNS with mocked
pending → verified, TLS chip, redirect platform address toggle.

Versions: list (date, who, changed sections, Live / Previous / Failed),
Restore with confirm, runs the activation banner.

Danger: Pause library (holding page), Delete library.

## Behaviour

Per-card "Reset changes" when the card has edits. Back to top button.
Uploads: drop or click, inline errors, ~1.2 s mock progress, thumbnail,
Replace / Remove. Seed: "AI in Education" library full in every section;
the Draft library shows every empty state.

## Deferred

Gap maps, statistics page toggle, custom font uploads, password visibility,
transfer to another organisation, Owner role grants.

## Type and weight rules (decided 2026-08-26)

No forced uppercase anywhere. Sentence case for every label and chip.

1. Page title: `text-xl md:text-2xl font-bold`. The only bold on the page.
2. Section card title: `text-sm font-semibold` in the tinted header strip; description `text-xs text-muted-foreground`.
3. Group heading inside a card (SubHeading): `text-sm font-semibold`.
4. Field label: `text-sm font-medium` (shadcn Label). Row titles (a group, a collection): `text-sm font-medium`.
5. Small labels — rail groups, nested list labels, eyebrows: `text-xs font-medium text-muted-foreground`. Same as the app sidebar.
6. Help, meta and counts: `text-xs text-muted-foreground`. Codes and URLs add `font-mono`.
7. Chips: `text-xs font-medium`, rounded-full, tinted tone. No tracking.
8. Colour carries meaning only: emerald = done or healthy, amber = changed or waiting, destructive = wrong or dangerous, primary = active or running.

## Copy rules (decided 2026-08-26)

1. Show a number only when it changes what the owner does: records in a collection or group, "3 selected" in a picker, a limit message when the limit is hit. Never "3 of 200", "Links (5 of 12)", "Groups (3)", or "up to 20" in a hint.
2. One word for one thing. "Advanced" (never "Advanced colours"). "Remove" takes something out of a list; "Delete" is only for the library. "Add <thing>" for a single inline add; "Add <things>" opens a picker. A picker button and its dialog title use the same words.
3. Empty states are one short sentence: "No links yet." The add button beside it is the instruction.
4. File hints name the accepted types only ("SVG, PNG or WEBP."). Sizes appear only in the error when a file is too big.
5. Section chips: Complete · Changed · Needs attention. The header says "Unsaved changes".

## Grouping rule (decided 2026-08-26)

Fields inside a section card sit in `FieldGroup`s: a divider above (none on the first), a `text-sm font-semibold` heading with optional hint and a right-side action, then the fields with one 16px gap. A bare heading followed by siblings is not allowed. "Advanced" disclosures use the same divider and padding.
