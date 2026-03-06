---
phase: quick-6
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - convex/lib/validators.ts
  - convex/extraction/validators.ts
autonomous: true
requirements: [QUICK-6]

must_haves:
  truths:
    - "Every field in convex/schema.ts for tables that have a corresponding validator is also present in that validator"
    - "No runtime validator mismatch can cause Convex to reject valid documents from the database"
  artifacts:
    - path: "convex/lib/validators.ts"
      provides: "Core table validators matching schema exactly"
    - path: "convex/extraction/validators.ts"
      provides: "Extraction table validators matching schema exactly"
  key_links:
    - from: "convex/schema.ts"
      to: "convex/lib/validators.ts"
      via: "Field-by-field match for users, credits, subscriptions, creditTransactions"
    - from: "convex/schema.ts"
      to: "convex/extraction/validators.ts"
      via: "Field-by-field match for all extraction* tables"
---

<objective>
Audit all Convex return validators against the schema to find fields that exist in the schema but are missing from the corresponding validators (like the libraryItemCount field that was missing from userValidator). Fix any mismatches found.

Purpose: Prevent runtime errors where Convex rejects valid documents because the return validator is missing a field that exists in the schema.
Output: Updated validator files with all schema fields accounted for.
</objective>

<execution_context>
@/Users/mcharrad/.claude/get-shit-done/workflows/execute-plan.md
@/Users/mcharrad/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@convex/schema.ts
@convex/lib/validators.ts
@convex/extraction/validators.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Audit schema vs validators and fix all mismatches</name>
  <files>convex/lib/validators.ts, convex/extraction/validators.ts</files>
  <action>
Systematically compare every field in convex/schema.ts against the corresponding validator in the validator files. The following tables have validators that need auditing:

**In convex/lib/validators.ts:**
- `users` schema vs `userValidator` -- already fixed (libraryItemCount was added in quick-5)
- `credits` schema vs `creditsValidator`
- `subscriptions` schema vs `subscriptionValidator`
- `creditTransactions` schema vs `creditTransactionValidator`

**In convex/extraction/validators.ts:**
- `extractionJobs` schema vs `extractionJobValidator`
- `extractionQuestions` schema vs `extractionQuestionValidator`
- `extractionPapers` schema vs `extractionPaperValidator`
- `extractionResults` schema vs `extractionResultValidator`
- `extractionResultReviews` schema vs `extractionResultReviewValidator`
- `extractionSavedViews` schema vs `extractionSavedViewValidator`
- `extractionReportSnapshots` schema vs `extractionReportSnapshotValidator`
- `extractionRunDiffs` schema vs `extractionRunDiffValidator`

For each table/validator pair:
1. List all fields from the schema definition (excluding index definitions)
2. List all fields from the validator (excluding _id and _creationTime which are Convex system fields added by validators but not in schema)
3. Identify any fields present in schema but missing from validator
4. Identify any fields present in validator but missing from schema (stale fields)
5. Fix mismatches by adding missing fields to validators (use the exact same v.* type from the schema)

Do NOT create validators for tables that don't already have one (e.g., billingCustomers, stripeEventLogs, auditLogs, apiKeys, zoteroConnections, libraryItems, collections, libraryItemCollections, etc.) -- only fix existing validators.

Also check inline return validators in query/mutation files that return full documents to ensure they match schema. Key files to check:
- convex/apiKeys/queries.ts (getMy returns partial -- OK, skip)
- convex/library/queries.ts (uses Doc type -- OK, skip)
- convex/zotero/queries.ts (returns custom shapes -- OK, skip)

Only fix validators that are meant to represent full document shapes (the named *Validator exports).
  </action>
  <verify>
    <automated>cd /Users/mcharrad/Documents/Github/openalex-count && npx convex typecheck 2>&1 | head -30</automated>
  </verify>
  <done>Every named document validator in convex/lib/validators.ts and convex/extraction/validators.ts contains all fields from the corresponding schema table definition. No field mismatches remain.</done>
</task>

</tasks>

<verification>
- `npx convex typecheck` passes with no errors
- Manual diff: for each validator, confirm field count matches schema field count
</verification>

<success_criteria>
- All existing document validators have been audited against schema.ts
- Any missing fields have been added with the correct v.* type
- Any stale fields (in validator but not schema) have been flagged or removed
- `npx convex typecheck` passes
</success_criteria>

<output>
After completion, create `.planning/quick/6-check-if-theres-any-such-issues/6-SUMMARY.md`
</output>
