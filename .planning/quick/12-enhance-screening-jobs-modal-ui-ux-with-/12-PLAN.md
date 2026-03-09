---
phase: quick-12
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - convex/screening/queries.ts
  - components/screening/screening-job-history.tsx
  - components/screening/screening-jobs-dialog.tsx
  - messages/en-US.json
  - messages/en-GB.json
  - messages/fr.json
  - messages/ja.json
  - messages/zh.json
  - messages/hi.json
autonomous: true
requirements: [QUICK-12]

must_haves:
  truths:
    - "Each job history entry shows the screening questions used"
    - "Each job history entry shows the target collection name when set"
    - "User can click a link on a job entry to navigate to the collection in the library"
    - "Job history entries have clear iconography and visual hierarchy"
  artifacts:
    - path: "convex/screening/queries.ts"
      provides: "listUserScreeningJobs returns questions and targetCollectionId+name"
      contains: "questions"
    - path: "components/screening/screening-job-history.tsx"
      provides: "Enhanced job entries with icons, questions, collection link"
    - path: "components/screening/screening-jobs-dialog.tsx"
      provides: "Polished dialog matching app design language"
  key_links:
    - from: "components/screening/screening-job-history.tsx"
      to: "convex/screening/queries.ts"
      via: "listUserScreeningJobs query"
      pattern: "api\\.screening\\.queries\\.listUserScreeningJobs"
    - from: "components/screening/screening-job-history.tsx"
      to: "/library?col="
      via: "Next.js Link navigation"
      pattern: "library\\?col="
---

<objective>
Enhance the screening jobs modal with richer data (questions, collection names) and improved visual design using Lucide icons and the app's design language.

Purpose: The current jobs history is plain text with minimal information. Users need to see what questions were used, which collection results went to, and have a quick link to navigate there.
Output: Enhanced backend query + redesigned job history UI with iconography and collection links.
</objective>

<execution_context>
@/Users/mcharrad/.claude/get-shit-done/workflows/execute-plan.md
@/Users/mcharrad/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@components/screening/screening-jobs-dialog.tsx
@components/screening/screening-job-history.tsx
@components/screening/screening-progress.tsx
@convex/screening/queries.ts
@convex/screening/validators.ts
@messages/en-US.json

<interfaces>
<!-- Backend query currently returns -->
From convex/screening/queries.ts (listUserScreeningJobs return shape):
```typescript
{
  _id: Id<"screeningJobs">,
  _creationTime: number,
  status: ScreeningStatus,
  totalPapers: number,
  processedPapers: number,
  qualifiedPapers: number,
  createdAt: number,
  completedAt?: number,
}
```

<!-- Full job record has these additional fields we need -->
From convex/screening/queries.ts (getScreeningJob has):
```typescript
questions: Array<{ key: string; question: string }>,
targetCollectionId?: Id<"collections">,
```

<!-- Collection filter URL pattern -->
From lib/library/search-params.ts:
```typescript
col: parseAsString, // Collection ID filter (null = all collections)
// URL pattern: /library?col=<collectionId>
```

<!-- Validator import -->
From convex/screening/validators.ts:
```typescript
export const screeningQuestionValidator = v.object({ key: v.string(), question: v.string() });
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend listUserScreeningJobs query to return questions and collection info</name>
  <files>convex/screening/queries.ts</files>
  <action>
Modify the `listUserScreeningJobs` query to also return `questions` and resolved collection info:

1. Add to the return validator:
   - `questions: v.array(v.object({ key: v.string(), question: v.string() }))` — reuse `screeningQuestionValidator` if cleaner
   - `targetCollectionId: v.optional(v.id("collections"))`
   - `targetCollectionName: v.optional(v.string())`

2. In the handler, after fetching jobs, resolve collection names:
   - For each job with a `targetCollectionId`, do `ctx.db.get(j.targetCollectionId)` to get the collection doc and extract its `name` field
   - Use `Promise.all` to resolve all collection names in parallel
   - If collection was deleted (returns null), set `targetCollectionName` to undefined

3. Update the map to include the new fields:
   ```typescript
   return Promise.all(jobs.map(async (j) => ({
     ...existingFields,
     questions: j.questions,
     targetCollectionId: j.targetCollectionId,
     targetCollectionName: j.targetCollectionId
       ? (await ctx.db.get(j.targetCollectionId))?.name
       : undefined,
   })));
   ```

Keep the existing fields unchanged. The limit is max 20 jobs so N+1 collection lookups are fine.
  </action>
  <verify>
    <automated>cd /Users/mcharrad/Documents/Github/openalex-count && npx convex typecheck 2>&1 | tail -5</automated>
  </verify>
  <done>listUserScreeningJobs returns questions array, targetCollectionId, and targetCollectionName for each job. Typechecks pass.</done>
</task>

<task type="auto">
  <name>Task 2: Redesign screening job history with icons, questions, and collection links</name>
  <files>components/screening/screening-job-history.tsx, components/screening/screening-jobs-dialog.tsx, messages/en-US.json, messages/en-GB.json, messages/fr.json, messages/ja.json, messages/zh.json, messages/hi.json</files>
  <action>
**screening-job-history.tsx** — Full redesign of job entries:

1. Add Lucide icon imports: `FileText`, `CheckCircle2`, `Clock`, `XCircle`, `AlertCircle`, `HelpCircle`, `FolderOpen`, `ExternalLink`, `Loader2`

2. Create a `getStatusIcon` helper that returns an appropriate icon per status:
   - pending: `Clock` (text-muted-foreground)
   - processing: `Loader2` with `animate-spin` (text-orange-500)
   - completed: `CheckCircle2` (text-green-500)
   - cancelled: `XCircle` (text-muted-foreground)
   - failed: `AlertCircle` (text-destructive)
   - creditsExhausted: `AlertCircle` (text-destructive)

3. Redesign each job entry (the `<li>` button) with this layout:
   ```
   [StatusIcon] [Status Badge]  [Date — right aligned]
   [FileText icon] N papers screened, M qualified
   [HelpCircle icon] Questions: "Q1", "Q2", ... (truncated if >2, show "+N more")
   [FolderOpen icon] Collection: "Name" [ExternalLink button]
   ```

   - Use `bg-muted/30 border-border/50 rounded-lg` for each entry (matching app design language)
   - Add `p-4` padding, `hover:bg-muted/50` hover state
   - The questions line: show first 2 question texts (just the `question` field, not the key), if more show "+N more" in muted text
   - The collection line: only show if `targetCollectionId` is set. Show collection name. Add a small `ExternalLink` icon button that links to `/library?col=${job.targetCollectionId}` using Next.js `Link`. This link should use `onClick` with `e.stopPropagation()` so it doesn't trigger the parent job selection button.
   - Each info row uses `flex items-center gap-2 text-xs text-muted-foreground` with the icon at `h-3.5 w-3.5`

4. Remove the wrapping Card/CardHeader/CardTitle — the dialog already provides the container. Just render the list directly with a section header if needed.

**screening-jobs-dialog.tsx** — Minor polish:
   - Add `DialogDescription` import and add a brief description under the title: `t("jobsDialogDescription")` — "View your screening job history and progress"
   - Ensure the dialog content area uses `bg-background` and has proper spacing

**Translation files** — Add new keys to `screeningDialog` namespace in ALL 6 message files:
   - `"jobsDialogDescription": "View your screening job history and progress"`
   - `"questionsUsed": "Questions"`
   - `"questionsMore": "+{count} more"`
   - `"targetCollection": "Collection"`
   - `"viewCollection": "View in library"`
   - `"collectionDeleted": "Collection deleted"`

For non-English files, translate appropriately:
   - fr: "Voir l'historique et la progression de vos taches de screening", "Questions", "+{count} de plus", "Collection", "Voir dans la bibliotheque", "Collection supprimee"
   - ja: use appropriate Japanese translations
   - zh: use appropriate Chinese translations
   - hi: use appropriate Hindi translations
   - en-GB: same as en-US (British English is fine as-is)
  </action>
  <verify>
    <automated>cd /Users/mcharrad/Documents/Github/openalex-count && npx next build 2>&1 | tail -10</automated>
  </verify>
  <done>Job history entries show status icons, screening questions (truncated), and collection name with link to library. All translation files updated. Build passes.</done>
</task>

</tasks>

<verification>
1. `npx convex typecheck` passes (backend changes valid)
2. `npx next build` passes (frontend changes compile)
3. Visual: Job history entries show status icons, questions used, and collection links
4. Collection link navigates to `/library?col=<id>` correctly
</verification>

<success_criteria>
- listUserScreeningJobs returns questions and collection name for each job
- Job entries display Lucide status icons with appropriate colors
- Screening questions shown per job (truncated to 2 with "+N more")
- Target collection name shown with working link to library view
- All 6 translation files updated with new keys
- Build and typecheck pass
</success_criteria>

<output>
After completion, create `.planning/quick/12-enhance-screening-jobs-modal-ui-ux-with-/12-SUMMARY.md`
</output>
