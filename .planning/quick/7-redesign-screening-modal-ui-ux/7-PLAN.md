---
phase: quick
plan: 7
type: execute
wave: 1
depends_on: []
files_modified:
  - components/screening/screening-dialog.tsx
  - components/screening/scoring-rules-editor.tsx
  - components/screening/star-threshold-editor.tsx
autonomous: true
requirements: []

must_haves:
  truths:
    - "Star thresholds display actual Star icons (yellow, filled) instead of asterisk characters"
    - "Questions and scoring rules are merged into a single unified section — no duplicate question listing"
    - "Yes/No/Uncertain point inputs are horizontally aligned regardless of label text length"
    - "Dialog sections have clear visual hierarchy with backgrounds, borders, and spacing"
  artifacts:
    - path: "components/screening/star-threshold-editor.tsx"
      provides: "Star icons via lucide-react Star component"
      contains: "Star"
    - path: "components/screening/scoring-rules-editor.tsx"
      provides: "Merged question + scoring layout with aligned inputs"
    - path: "components/screening/screening-dialog.tsx"
      provides: "Cleaned up configure mode without separate questions list"
  key_links:
    - from: "components/screening/star-threshold-editor.tsx"
      to: "lucide-react"
      via: "Star icon import"
      pattern: "import.*Star.*lucide-react"
---

<objective>
Redesign the screening dialog's configure mode for better UX: replace asterisk characters with real Star icons, merge the duplicate questions list with the scoring rules editor into one unified section, fix input alignment issues in the scoring rules, and improve overall visual hierarchy.

Purpose: The current dialog is functional but visually bland with UX issues — asterisks instead of stars, redundant question listing, and misaligned form inputs.
Output: Polished screening dialog with proper star rendering, unified question/scoring section, and improved design.
</objective>

<execution_context>
@/Users/mcharrad/.claude/get-shit-done/workflows/execute-plan.md
@/Users/mcharrad/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@components/screening/screening-dialog.tsx
@components/screening/scoring-rules-editor.tsx
@components/screening/star-threshold-editor.tsx
@components/rating-selector.tsx (reference for RatingStarsDisplay pattern)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix star icons and improve star threshold editor</name>
  <files>components/screening/star-threshold-editor.tsx</files>
  <action>
In `star-threshold-editor.tsx`:

1. Import `Star` from `lucide-react` (already imported? check — it imports Trash2 and Plus, add Star).

2. Replace the asterisk-based star display in the Select dropdown items. Current code at line 120:
   ```tsx
   {s} {"*".repeat(s)}
   ```
   Replace with actual Star icons using the same pattern as `RatingStarsDisplay` from `rating-selector.tsx`:
   ```tsx
   <span className="flex items-center gap-1.5">
     <span>{s}</span>
     <span className="flex">
       {Array.from({ length: s }, (_, i) => (
         <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
       ))}
     </span>
   </span>
   ```

3. Also update the `SelectTrigger`/`SelectValue` display to show stars properly. Wrap the SelectValue in a custom renderer or use the same star pattern for the trigger display.

4. Add subtle visual improvements to each threshold row:
   - Wrap each row in a light bordered container: `rounded-lg border border-border/50 bg-muted/30 p-3`
   - Better label alignment using `items-center` instead of `items-end`
   - Use consistent gap spacing

5. Keep all existing functionality (add/remove/validation warnings) intact.
  </action>
  <verify>npx next build 2>&1 | tail -5</verify>
  <done>Star threshold editor shows real yellow Star icons in dropdown and trigger display. No asterisk characters remain. Threshold rows have improved visual styling.</done>
</task>

<task type="auto">
  <name>Task 2: Merge questions list into scoring rules and fix alignment</name>
  <files>components/screening/scoring-rules-editor.tsx, components/screening/screening-dialog.tsx</files>
  <action>
**In `scoring-rules-editor.tsx`:**

1. Fix the input alignment issue. The problem is the 3-column grid labels ("Yes (Points)", "No (Points)", "Uncertain/Missing (Points)") have different text lengths causing misalignment. Fix by:
   - Moving labels OUT of the per-question cards and into a shared header row above all questions
   - Use a consistent table-like layout: question text on top, then a row of 3 equal-width inputs below with short labels
   - Alternative approach: use `whitespace-nowrap` on labels and ensure all label containers have `min-h-[20px]` so they're uniform height

   Recommended layout per question card:
   ```
   [Badge: Q1] Question text here...
   [Yes: input] [No: input] [Uncertain: input]
   ```
   Where "Yes", "No", "Uncertain" are short fixed-width labels above or inline with each input. Drop the "(Points)" suffix — it's redundant. The section title already says "Scoring Rules".

2. Add the question number Badge (matching the style from the old questions list):
   ```tsx
   <Badge variant="outline" className="mt-0.5 h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums">
     {i + 1}
   </Badge>
   ```
   Import Badge from `@/components/ui/badge`.

3. Improve card styling:
   - Add subtle background: `bg-muted/20` or `bg-card`
   - Softer border: `border-border/50`
   - Better internal spacing

4. For the minimum score input at the bottom, give it a distinct look — perhaps `bg-muted/30` background with an info-style label.

**In `screening-dialog.tsx`:**

5. REMOVE the entire "Screening questions (read-only)" section (lines ~359-388) — the numbered `<ol>` with Badges showing each question. This is now redundant since questions appear in the scoring rules editor.

6. Update the scoring rules section title. Change from just `t("scoringTitle")` ("Scoring Rules") to something that conveys it's the questions AND scoring combined. Update the i18n key `scoringTitle` in `messages/en-US.json` to "Questions & Scoring" (and the 5 other locale files: en-GB, fr, hi, ja, zh). If changing i18n is too risky, just use a combined heading like:
   ```tsx
   <h4 className="text-sm font-medium">{t("questionsTitle")} & {t("scoringTitle")}</h4>
   ```

7. Expand dialog max-width from `sm:max-w-lg` to `sm:max-w-2xl` to give the merged layout more room.

8. Improve section visual hierarchy in configure mode:
   - Paper count and credit cost sections: add `bg-muted/30` background
   - Add subtle section dividers or group related sections
   - Use slightly larger font for section headers: `text-sm font-semibold` instead of `text-sm font-medium`
  </action>
  <verify>npx next build 2>&1 | tail -5</verify>
  <done>Questions list is removed from dialog. Scoring rules editor shows question text with numbered badge AND point inputs inline. Input boxes are horizontally aligned. Dialog is wider (max-w-2xl). Visual hierarchy is improved with backgrounds and better typography.</done>
</task>

</tasks>

<verification>
- `npx next build` succeeds with no type errors
- No i18n key errors (all referenced keys still exist)
- Star threshold dropdown shows actual Star icons, no asterisk characters
- Questions are NOT listed separately — only appear in scoring rules section
- Yes/No/Uncertain inputs are visually aligned across all question cards
</verification>

<success_criteria>
- Real Star icons replace all asterisk characters in the threshold editor
- Single unified questions+scoring section (no duplicate question list)
- Aligned input boxes in scoring rules
- Improved visual hierarchy (backgrounds, borders, typography)
- Build passes, no regressions
</success_criteria>

<output>
After completion, create `.planning/quick/7-redesign-screening-modal-ui-ux/7-SUMMARY.md`
</output>
