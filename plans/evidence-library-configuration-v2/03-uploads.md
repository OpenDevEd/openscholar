# Plan 03 — Uploads to the `openscholar` bucket (OpenScholar)

Lane A, after plan 02 is merged.

## Goal

Owners upload logos, favicon, share image, institution and funder logos, and
legal Markdown files from the page. Files get stable public URLs.

## Scope

1. One platform bucket `openscholar` (public) in the existing Supabase
   storage, created once by a dev-only admin action if missing. Platform
   credentials come from the same environment values the setup steps use
   (`storageSetupClient.ts`); nothing per library.
2. Upload in two steps, because Convex caps function arguments at 1 MB and
   the share image limit is 2 MB: mutation
   `evidenceLibraries.uploads.generateUploadUrl({ libraryId })` (owner check)
   returns a short-lived Convex upload URL; the browser posts the file there
   and gets a `storageId`; action
   `evidenceLibraries.uploadActions.upload({ libraryId, kind, name, storageId })`
   (owner check) reads the temporary file, checks it, and deletes the
   temporary Convex file whatever the outcome. Kinds and limits: `image` (svg/png/webp, 1 MB), `shareImage`
   (png/jpg/webp, 2 MB), `legal` (md/txt, 200 KB → returned as text, not
   stored). Stores at `evidence-libraries/<libraryId>/<kind>-<sha256-8>.<ext>`
   with the right content type and immutable cache headers. Returns the public URL.
3. Action `evidenceLibraries.uploadActions.remove({ libraryId, url })` deletes a file
   that belongs to that library prefix. The page calls it on Replace/Remove.
4. Library teardown deletes the prefix.

## Tests

- Pure helpers (`lib/evidence-libraries/configuration/uploads.ts`, inside
  lane A's write-set): accepted types, size
  limits, object key derivation, prefix ownership check. Test-first.
- Action test with the storage client mocked at the HTTP boundary: upload
  returns a stable URL without a query string ending in the extension.

## Revisions

- 2026-08-26: `bytes` argument replaced by Convex file storage (`storageId`).
  Convex rejects arguments over 1 MB, so a 2 MB share image could never reach
  the action. Helper file moved under `lib/evidence-libraries/configuration/`
  to stay inside lane A's write-set. Storage helpers live in
  `convex/evidenceLibraries/uploadsClient.ts` (node runtime); action file is
  `uploadActions.ts` so the V8 mutation and node actions stay in separate files.

## Deployability gate

`npx convex dev --once` on the lane; upload a real PNG from the lane's web app
(port 3011) using the mock page's UploadField wired to the action; open the
returned URL in the browser; confirm the object in the Supabase dashboard.

## Completion

PR to `dev`. Plan 05 switches the page's UploadField to these actions.

## Risks

- The runtime requires stable HTTPS URLs ending in `.svg/.png/.webp/.ico` for
  logos and favicon; keep extensions in the key.
- Supabase public bucket caching: set `cacheControl` on upload; new content
  gets a new hash, so no stale files.
