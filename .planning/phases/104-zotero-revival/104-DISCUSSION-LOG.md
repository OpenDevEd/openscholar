# Phase 104: Zotero Revival - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 104-zotero-revival
**Mode:** --auto (all decisions auto-selected)
**Areas discussed:** Settings Connect Card placement, ZoteroTab browse experience, DOI resolution UX flow, Purge action surface

---

## Settings Connect Card placement

| Option | Description | Selected |
|--------|-------------|----------|
| New section on existing /settings/connections page | Add Zotero card above wallet keys on the existing connections page | ✓ |
| Separate /settings/zotero sub-page | Create a dedicated settings page for Zotero | |
| Inline on selector page only | Connect prompt only on the Zotero tab in /extraction/new | |

**User's choice:** [auto] New section on existing /settings/connections page (recommended default)
**Notes:** Maintains single-page-for-external-services pattern. The existing connections page already manages wallet API keys — Zotero is another external integration card.

---

## ZoteroTab browse experience

| Option | Description | Selected |
|--------|-------------|----------|
| Collection-browsable with flat item list per collection | Collection picker dropdown + paginated item list per collection | ✓ |
| Flat item list only | No collection navigation, just all items with search | |
| Full nested tree browser | Hierarchical collection tree with expand/collapse | |

**User's choice:** [auto] Collection-browsable with flat item list per collection (recommended default)
**Notes:** The backend already supports `fetchCollections` and `fetchItems` with `collectionKey` filter. A flat dropdown (not nested tree) balances discoverability with implementation simplicity for a revival phase.

---

## DOI resolution UX flow

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy resolution on check with inline spinner/status | Resolve DOI→OpenAlex only when user checks the item; show spinner/success/failure inline | ✓ |
| Eager batch resolution on tab load | Resolve all DOIs when the tab loads or collection changes | |
| Pre-resolve on hover | Resolve DOI when user hovers over the checkbox | |

**User's choice:** [auto] Lazy resolution on check with inline spinner/status (recommended default)
**Notes:** Avoids mass API calls when browsing. Items without DOI get disabled checkbox with tooltip (ZOT-04). Items with DOI that fails resolution show "Could not find in OpenAlex" tooltip. Local cache prevents re-resolution. Bulk select deliberately omitted.

---

## Purge action surface

| Option | Description | Selected |
|--------|-------------|----------|
| Internal function only | Platform-enforced unreachability, callable only via Convex dashboard | ✓ |
| Settings page button (dev-gated) | Button on connections page visible only when NODE_ENV=development | |
| CLI script | npm script that calls the internal action | |

**User's choice:** [auto] Internal function only (recommended default)
**Notes:** Follows v3.2 pattern of converting debug endpoints to internal functions. One-time dev cleanup, not a user feature. Platform-level enforcement is the strongest access control.

---

## Claude's Discretion

- Exact Tailwind styling for Zotero connection card
- Collection picker component type (Select vs Combobox)
- Animation transitions for connection status changes
- Toast wording for OAuth success/error/disconnect
- Loading skeleton design for ZoteroTab
- Item count display in collection dropdown
- Test file organization

## Deferred Ideas

None — discussion stayed within phase scope.
