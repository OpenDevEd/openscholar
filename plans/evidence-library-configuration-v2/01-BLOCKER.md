# Plan 01 blocker — local acceptance suite cannot run

Date: 2026-08-26. Repository: OpenDevEd/new-el, branch `codex/openscholar-read-api`.

## What is blocked

The plan's gate requires `npm run test:acceptance` to pass locally before the PR. It cannot run on this machine.

## What failed

- The host disk is full: `/System/Volumes/Data` at 100% (about 1.2 GiB free).
- Docker Desktop's storage is returning `input/output error` on its own metadata and image blobs. `docker buildx bake` for the acceptance images fails while extracting layers. `docker builder prune` and `docker image prune` fail with the same error.

## What was tried

1. Ran `npm run test:acceptance` once; the image build failed with I/O errors.
2. Ran `docker builder prune -af` and `docker image prune -f`; both failed on the daemon's metadata database.
3. Ran `npm run test:acceptance:cleanup` to make sure no acceptance project was left behind.

## What is done anyway

- All code units are committed. `npm run check:changed` passes (144 test files, 1173 tests, Fallow verdict `pass`, nothing introduced).
- The branch is pushed and the PR to `main` is open. GitHub's required "Runtime acceptance" check runs the same suite, including the new `verifyOpenScholarReadApi` and `verifyOwnerLegalText` steps.

## What unblocks it

1. Free space on the host disk (at least several GiB).
2. Restart Docker Desktop. If the daemon still reports I/O errors, reset its disk image from Docker Desktop settings.
3. Re-run `npm run test:acceptance` from `/Users/mcharrad/Documents/Github/new-el-runtime-api`, then `npm run test:acceptance:cleanup`.
