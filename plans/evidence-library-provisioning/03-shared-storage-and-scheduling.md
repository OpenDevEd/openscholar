# Plan 03 — Shared storage and scheduling

## Goal

Start setup when the first configuration is activated, create this library's
two buckets in the shared Supabase Storage project, and move between setup
steps without leaving an unscheduled gap.

## Scope

1. Activation claims the existing setup operation and schedules the database
   action in the same Convex mutation.
2. Database completion schedules storage in the same mutation that records the
   database receipt.
3. Storage reconciles one private documents bucket and one public images
   bucket. Names are deterministic hashes of the Convex library ID, so retries
   find the same buckets and names stay inside Supabase's 63-character limit.
4. Storage uses one fixed Supabase origin and service-role key from Convex
   environment values. A caller cannot supply a URL, key, bucket name, or
   bucket policy.
5. Storage completion saves the encrypted service-role key, records the two
   bucket names, and schedules the application step in the same mutation.

## Design

Use a small Node client over the documented Supabase Storage bucket API:

- `GET /storage/v1/bucket/<id>` reads the current bucket;
- `POST /storage/v1/bucket` creates a missing bucket;
- `PUT /storage/v1/bucket/<id>` corrects a bucket with the wrong visibility,
  size limit, or MIME types.

Every request carries the service-role key in both `apikey` and bearer headers.
The private bucket allows PDFs up to the managed PDF limit. The public bucket
allows images and uses the same size ceiling. Read both buckets again before
recording success. Return only `created`, `matched`, or `updated`; do not save
remote error text.

Use these Convex environment names so the current self-hosted server accepts
them: `EL_STORAGE_URL`, `EL_STORAGE_SERVICE_KEY`, and
`EL_STORAGE_MAX_PDF_BYTES`.

The setup operation remains the one workflow record. Do not add a job table,
bucket table, cleanup worker, or per-library storage service. The runtime
binding stays unassigned until the application step has all fields required by
its current all-or-nothing schema.

## Test-first steps

1. Add a behavior test proving first activation atomically schedules the
   database action and a repeated activation does not create a second setup.
2. Change database completion to schedule storage in the same mutation. Prove
   the scheduled function and stage change exist together.
3. Add pure bucket-name and Storage client tests for create, match, correction,
   fixed request paths, fixed policy, bounded timeout, and safe errors.
4. Add the storage action and completion mutation. Prove a failed call leaves
   the operation retryable, a retry reuses both names, the service key is
   encrypted, and application scheduling is atomic with the storage receipt.

## Files

- `convex/evidenceLibraries/mutations.ts`
- `convex/evidenceLibraries/databaseSetup.ts`
- `convex/evidenceLibraries/databaseSetupActions.ts`
- `convex/evidenceLibraries/storageSetup.ts`
- `convex/evidenceLibraries/storageSetupActions.ts`
- `convex/evidenceLibraries/storageSetupClient.ts`
- focused tests beside those files
- `convex/_generated/api.d.ts`

## Data migration

None. Development data is disposable and the existing setup operation and
credential tables already hold the required state.

## Exact tests

```sh
npm test -- convex/evidenceLibraries/operations.test.ts
npm test -- convex/evidenceLibraries/databaseSetup.test.ts
npm test -- convex/evidenceLibraries/storageSetup.test.ts
npx tsc --noEmit
npm run schema:check:evidence-library-config
```

## Runtime check

Against the assigned Convex Cloud lane, reconcile two disposable bucket pairs,
repeat both calls, and read the final bucket policies. Delete only those four
test buckets after the check. Upload Convex once and read the last 200 log
entries.

## Completion rules

- Activation schedules database without a second user action.
- Database and storage transitions cannot commit without their next scheduled
  action.
- Retry creates no duplicate bucket and does not change names.
- Stored queries expose no service-role key.
- Focused tests, TypeScript, schema check, live bucket check, cleanup, Convex
  upload, and log check pass.

## Risks

- A create response can be lost. The retry must read by deterministic name.
- A pre-existing bucket with the same name may have the wrong policy. Correct
  it and read it back; do not accept it on name alone.
- Never delete a bucket during normal retry. Cleanup is only for named test
  fixtures created during verification.

## Sources

- [Supabase create bucket](https://supabase.com/docs/reference/javascript/file-buckets-createbucket)
- [Supabase bucket guide](https://supabase.com/docs/guides/storage/buckets/creating-buckets)
- Installed `@supabase/storage-js` bucket client source in Evidence Library
- GitHub issue OpenDevEd/openalex-count #28

