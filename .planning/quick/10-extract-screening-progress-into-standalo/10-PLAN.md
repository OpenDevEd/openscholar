---
phase: quick-10
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - components/screening/screening-jobs-dialog.tsx
  - components/screening/screening-dialog.tsx
  - components/app-sidebar.tsx
  - components/search-command-center/search-command-footer.tsx
  - messages/en-US.json
  - messages/en-GB.json
  - messages/fr.json
  - messages/hi.json
  - messages/ja.json
  - messages/zh.json
autonomous: true
requirements: [QUICK-10]

must_haves:
  truths:
    - "Sidebar has a Screening nav item that opens a dialog showing job history and progress"
    - "Screening config dialog (from footer) no longer shows progress mode after submit"
    - "After submitting a screening job, config dialog closes and shows success toast"
    - "ScreeningJobsDialog shows ScreeningProgress for selected job and ScreeningJobHistory list"
  artifacts:
    - path: "components/screening/screening-jobs-dialog.tsx"
      provides: "Standalone screening jobs dialog with progress + history"
      min_lines: 40
    - path: "components/app-sidebar.tsx"
      provides: "Screening nav item triggering dialog"
  key_links:
    - from: "components/app-sidebar.tsx"
      to: "components/screening/screening-jobs-dialog.tsx"
      via: "button onClick opens dialog state"
      pattern: "ScreeningJobsDialog"
---

<objective>
Extract screening progress/history out of the config dialog into a standalone ScreeningJobsDialog, accessible from a new Screening sidebar entry.

Purpose: Decouple job monitoring from job configuration so users can check screening progress from anywhere, not just when the config dialog is open.
Output: New ScreeningJobsDialog component, updated sidebar with Screening item, simplified config dialog.
</objective>

<execution_context>
@.planning/quick/10-extract-screening-progress-into-standalo/10-PLAN.md
</execution_context>

<context>
@components/screening/screening-dialog.tsx
@components/screening/screening-progress.tsx
@components/screening/screening-job-history.tsx
@components/app-sidebar.tsx
@components/search-command-center/search-command-footer.tsx
@messages/en-US.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create ScreeningJobsDialog and add sidebar entry</name>
  <files>components/screening/screening-jobs-dialog.tsx, components/app-sidebar.tsx, messages/en-US.json, messages/en-GB.json, messages/fr.json, messages/hi.json, messages/ja.json, messages/zh.json</files>
  <action>
1. Create `components/screening/screening-jobs-dialog.tsx`:
   - A Dialog component with open/onOpenChange props
   - State: `selectedJobId: Id<"screeningJobs"> | null` (initially null)
   - Content: When selectedJobId is set, show `<ScreeningProgress jobId={selectedJobId} />` at the top. Always show `<ScreeningJobHistory onSelectJob={(id) => setSelectedJobId(id)} />` below.
   - Use ScrollArea for the content area, same pattern as screening-dialog.tsx
   - DialogHeader with ListChecks icon and title from i18n `screeningDialog.jobsDialogTitle`
   - DialogFooter with "Close" button (calls onOpenChange(false))
   - Use useTranslations("screeningDialog") for all text
   - Reset selectedJobId to null when dialog closes (in onOpenChange wrapper)

2. Modify `components/app-sidebar.tsx`:
   - Import ScreeningJobsDialog and ListChecks icon
   - Add `isScreeningJobsOpen` state (useState(false)) in SidebarContent
   - Add a new sidebar button item AFTER Library and BEFORE History. Since NavItem wraps a Link, create a lightweight button-based nav item inline that matches NavItem styling (same classes: flex items-center gap-3 px-3 py-2.5 rounded-lg, hover:bg-sidebar-accent/60, text-sidebar-foreground). Use `<button>` not `<Link>`. Label: `tc("screening")`. Icon: ListChecks. onClick: `setIsScreeningJobsOpen(true)`.
   - When collapsed, wrap in Tooltip showing label (same pattern as NavItem collapsed).
   - Render `<ScreeningJobsDialog open={isScreeningJobsOpen} onOpenChange={setIsScreeningJobsOpen} />` at the end of SidebarContent return, outside the flex layout div.

3. Add i18n keys across all 6 locale files:
   - In `common` section add: `"screening": "Screening"` (en-US/en-GB), `"screening": "Criblage"` (fr), `"screening": "screening"` (hi - transliterate), `"screening": "screening"` (ja - use katakana), `"screening": "screening"` (zh - use Chinese)
   - In `screeningDialog` section add: `"jobsDialogTitle": "Screening Jobs"` (en-US/en-GB), translate for other locales
   - For hi, ja, zh use appropriate translations: hi: "स्क्रीनिंग" / "स्क्रीनिंग कार्य", ja: "スクリーニング" / "スクリーニングジョブ", zh: "筛选" / "筛选任务", fr: "Criblage" / "Taches de criblage"
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>ScreeningJobsDialog renders progress+history, sidebar shows Screening button that opens it, all 6 locales have keys</done>
</task>

<task type="auto">
  <name>Task 2: Remove progress mode from screening config dialog</name>
  <files>components/screening/screening-dialog.tsx, components/search-command-center/search-command-footer.tsx</files>
  <action>
1. Modify `components/screening/screening-dialog.tsx`:
   - Remove `activeJobId` state entirely
   - Remove `isProgressMode` variable and the entire progress mode branch (lines 294-314)
   - Remove `handleNewScreening` function
   - Remove imports: ScreeningProgress, ScreeningJobHistory
   - In handleSubmit success path: instead of `setActiveJobId(jobId)`, call `onOpenChange(false)` to close the dialog. Keep the toast.success call.
   - The dialog now only renders the configure mode (the else branch becomes the only branch)
   - Remove `closeDialog` and `newScreening` i18n usage (they move to the jobs dialog)

2. Verify search-command-footer.tsx needs no changes (it already just opens/closes the dialog with boolean state, which still works).
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>Screening config dialog is configure-only. After submit it closes and shows toast. No progress/history rendering in config dialog.</done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` passes with no errors
- Sidebar renders Screening button between Library and History
- Clicking sidebar Screening opens ScreeningJobsDialog with history list
- Clicking a job in history shows its progress
- "Screen All" button in footer still opens config-only dialog
- After submitting screening job, config dialog closes
</verification>

<success_criteria>
- ScreeningJobsDialog component exists and renders ScreeningProgress + ScreeningJobHistory
- Sidebar has Screening nav item that opens the dialog
- Screening config dialog no longer has progress mode
- All 6 locale files have screening/jobsDialogTitle keys
- TypeScript compiles clean
</success_criteria>

<output>
After completion, create `.planning/quick/10-extract-screening-progress-into-standalo/10-SUMMARY.md`
</output>
