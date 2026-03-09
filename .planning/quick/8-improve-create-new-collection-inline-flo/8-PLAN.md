---
phase: quick
plan: 8
type: execute
wave: 1
depends_on: []
files_modified:
  - components/screening/collection-selector.tsx
  - messages/en-US.json
  - messages/en-GB.json
  - messages/fr.json
  - messages/hi.json
  - messages/ja.json
  - messages/zh.json
autonomous: true
requirements: []
must_haves:
  truths:
    - "User sees a labeled inline card when in create-collection mode"
    - "User can submit with a visible Create button or Enter key"
    - "User can cancel with a visible Cancel button or Escape key"
  artifacts:
    - path: "components/screening/collection-selector.tsx"
      provides: "Improved create-collection inline UX"
  key_links: []
---

<objective>
Improve the create-new-collection inline flow in CollectionSelector so it renders as a visually distinct mini-card with a label, properly styled Create and Cancel buttons, and clear affordances.

Purpose: Users currently see a bare input + invisible ghost button with no context about what they're doing or how to submit/cancel.
Output: Polished inline creation flow with label, styled buttons, and keyboard hints.
</objective>

<execution_context>
@/Users/mcharrad/.claude/get-shit-done/workflows/execute-plan.md
@/Users/mcharrad/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@components/screening/collection-selector.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Redesign inline create-collection flow with label, styled buttons, and i18n</name>
  <files>
    components/screening/collection-selector.tsx,
    messages/en-US.json,
    messages/en-GB.json,
    messages/fr.json,
    messages/hi.json,
    messages/ja.json,
    messages/zh.json
  </files>
  <action>
1. Add i18n key `createCollectionLabel` to all 6 locale files under `screeningDialog`:
   - en-US/en-GB: "New collection name"
   - fr: "Nom de la nouvelle collection"
   - hi: "नए संग्रह का नाम"
   - ja: "新しいコレクション名"
   - zh: "新集合名称"

2. Replace the `isCreating` block in `collection-selector.tsx` with a visually distinct inline card:

```tsx
if (isCreating) {
  return (
    <div className="rounded-md border border-border bg-muted/50 p-3 space-y-2">
      <label className="text-xs font-medium text-muted-foreground">
        {t("createCollectionLabel")}
      </label>
      <Input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder={t("newCollectionName")}
        className="h-8"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); handleCreate(); }
          if (e.key === "Escape") { setIsCreating(false); setNewName(""); }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setIsCreating(false); setNewName(""); }}
          className="h-7 px-3 text-xs"
        >
          {t("cancel")}
        </Button>
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="h-7 px-3 text-xs"
        >
          <Check className="h-3.5 w-3.5 mr-1.5" />
          {t("createNewCollection")}
        </Button>
      </div>
    </div>
  );
}
```

Key design decisions:
- Wrapped in `rounded-md border border-border bg-muted/50 p-3` for visual card distinction
- Label above input using `text-xs font-medium text-muted-foreground` for context
- Cancel button: ghost variant, always enabled, with "Cancel" text (uses existing `cancel` i18n key from screeningDialog)
- Create button: default variant (primary), disabled until name entered, shows Check icon + "Create new collection" text
- Both buttons are `h-7 px-3 text-xs` for compact but clickable sizing
- Keyboard shortcuts (Enter/Escape) preserved
  </action>
  <verify>
    <automated>npx next build 2>&1 | tail -5</automated>
  </verify>
  <done>
    - Create-collection mode renders as a bordered card with muted background
    - Label "New collection name" appears above the input
    - Cancel button is visible with text, resets state on click
    - Create button shows Check icon + text, disabled when input empty
    - Enter and Escape keyboard shortcuts still work
    - All 6 locale files have the new i18n key
  </done>
</task>

</tasks>

<verification>
- Build succeeds without errors
- No TypeScript errors in collection-selector.tsx
- All 6 locale files contain `createCollectionLabel` key
</verification>

<success_criteria>
The inline create-collection flow is visually distinct, labeled, and has discoverable submit/cancel buttons.
</success_criteria>

<output>
After completion, create `.planning/quick/8-improve-create-new-collection-inline-flo/8-SUMMARY.md`
</output>
