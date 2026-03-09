---
phase: quick-11
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - components/app-sidebar.tsx
autonomous: true
requirements: [QUICK-11]

must_haves:
  truths:
    - "Screening button no longer appears in the nav items section"
    - "Screening button appears in the sidebar footer area"
    - "When a screening job is active, a circular SVG progress ring shows around the icon"
    - "When no active job, the icon displays normally without ring"
    - "Button works in both collapsed (icon-only + tooltip) and expanded (icon + label) states"
  artifacts:
    - path: "components/app-sidebar.tsx"
      provides: "Screening button in footer with circular progress"
      contains: "stroke-dasharray"
  key_links:
    - from: "components/app-sidebar.tsx"
      to: "api.screening.queries.listUserScreeningJobs"
      via: "useProtectedQuery"
      pattern: "useProtectedQuery.*listUserScreeningJobs"
---

<objective>
Move the screening button from the nav items section to the sidebar footer and add a circular SVG progress indicator that shows real-time screening job progress.

Purpose: Better UX placement -- screening is an action/status indicator, not a navigation destination, so it belongs in the footer alongside other utility controls. The progress ring gives instant visual feedback on active jobs.
Output: Updated app-sidebar.tsx with screening button in footer + SVG progress ring.
</objective>

<execution_context>
@/Users/mcharrad/.claude/get-shit-done/workflows/execute-plan.md
@/Users/mcharrad/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@components/app-sidebar.tsx
@components/screening/screening-job-history.tsx (for useProtectedQuery pattern)
@convex/screening/queries.ts (for listUserScreeningJobs return shape)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Move screening button to footer with circular progress ring</name>
  <files>components/app-sidebar.tsx</files>
  <action>
1. **Add import** for `useProtectedQuery` from `@/lib/auth/use-auth-query` and `api` from `@/convex/_generated/api`.

2. **Add screening job query** near the top of SidebarContent:
   ```
   const { data: screeningJobs } = useProtectedQuery(
     api.screening.queries.listUserScreeningJobs,
     { limit: 1 }
   );
   ```
   Derive active job state:
   ```
   const activeJob = screeningJobs?.find(j => j.status === "pending" || j.status === "processing");
   const progressPercent = activeJob ? (activeJob.totalPapers > 0 ? (activeJob.processedPapers / activeJob.totalPapers) * 100 : 0) : null;
   ```

3. **Remove the screening button block** from the nav items section (lines ~398-496, the entire collapsed/expanded screening button between Library NavItem and History NavItem).

4. **Create a ScreeningFooterButton component** (inline in the same file, above SidebarContent) that renders:
   - A `button` that calls `onClick` (to open the dialog)
   - The ListChecks icon (h-5 w-5)
   - An SVG circular progress ring wrapping the icon when `progressPercent !== null`:
     - SVG viewBox="0 0 36 36", size matching the icon container (~36x36px)
     - Background circle: stroke="currentColor" with 10% opacity, strokeWidth=2.5, r=15, cx=18, cy=18, fill="none"
     - Progress circle: stroke with the project accent color `oklch(0.70 0.17 54)`, strokeWidth=2.5, same r/cx/cy, fill="none"
     - strokeDasharray = `2 * PI * 15` (~94.25), strokeDashoffset = `94.25 - (94.25 * progressPercent / 100)`
     - strokeLinecap="round", transform="rotate(-90 18 18)" to start from top
     - Add CSS transition on stroke-dashoffset for smooth updates
   - When expanded (!isCollapsed): show label "Screening" text next to icon, and if active job, show small percentage text like "42%"
   - When collapsed: icon-only with tooltip showing "Screening" (and percentage if active)
   - Styling: match existing footer button patterns -- use `text-muted-foreground hover:text-foreground` colors, same padding/rounded as other footer items

5. **Add the ScreeningFooterButton to the footer section** (the motion.div starting at line ~717):
   - **Expanded state** (inside the `!isCollapsed || isMobile` branch): Add a screening button row ABOVE the ThemeToggle/LanguageSwitcher row. Use the same gap-2 spacing. The button should be full-width, flex, items-center, with icon+ring on left, "Screening" label, and optional percentage on right.
   - **Collapsed state** (the else branch with stacked icons): Add the screening button icon ABOVE ThemeToggle. It should be centered like the other collapsed footer icons.

6. The `isScreeningJobsOpen` state and `ScreeningJobsDialog` remain unchanged -- just pass `() => setIsScreeningJobsOpen(true)` as the onClick to ScreeningFooterButton.
  </action>
  <verify>
    <automated>cd /Users/mcharrad/Documents/Github/openalex-count && npx tsc --noEmit --pretty 2>&1 | head -30</automated>
  </verify>
  <done>
    - Screening button removed from nav items section (no ListChecks between Library and History NavItems)
    - Screening button renders in sidebar footer with circular SVG progress ring when a job is active
    - Button works in collapsed (icon-only + tooltip) and expanded (icon + label + percentage) states
    - TypeScript compiles without errors
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Screening button moved to sidebar footer with circular progress indicator</what-built>
  <how-to-verify>
    1. Open the app in the browser
    2. Check sidebar expanded state: screening button should appear in footer area (above theme/language row), NOT in the nav items list
    3. Check sidebar collapsed state: screening icon should appear in footer, stacked with other icons
    4. If you have an active screening job: verify the circular progress ring animates around the icon showing real progress
    5. If no active job: verify the icon appears clean without any ring
    6. Click the screening button: verify the ScreeningJobsDialog opens correctly
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
- TypeScript compilation passes
- Screening button no longer in nav section
- Screening button visible in footer section
- SVG progress ring renders when active job exists
- Dialog still opens on click
</verification>

<success_criteria>
- Screening button relocated from nav items to sidebar footer
- Circular SVG progress ring shows real-time progress for active screening jobs
- Both collapsed and expanded sidebar states work correctly
- No TypeScript errors
</success_criteria>

<output>
After completion, create `.planning/quick/11-move-screening-button-to-sidebar-footer-/11-SUMMARY.md`
</output>
