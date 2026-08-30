# Blocker: the original auth activation check needs a disposable runtime

## What is blocked

The original `dev` auth browser test did more than sign in. It reserved a new
Evidence Library, saved its configuration, previewed it, activated it, and
revisited the activated library.

The current self-hosted auth job safely runs six Clerk and configuration cases.
It uses a fixed draft, saves it, reopens it, and restores its original values.
That does not preserve the old activation check. Calling the smaller suite a
full replacement would weaken CI.

## Why activation cannot run in the current environment

`evidenceLibraries/mutations:activateLibrary` freezes the draft, claims its
setup operation, and schedules runtime setup. The scheduled chain then:

1. creates a database;
2. creates storage;
3. creates or changes a Coolify application;
4. deploys the Evidence Library runtime; and
5. waits for the public runtime to become ready.

The development Convex deployment `formal-rabbit-271` has no database, storage,
or Coolify provider credentials. The OpenScholar runners also have none. The
setup operation has no safe dry-run or cancellation path. Its development
teardown deletes the Coolify application, so cleanup also crosses the forbidden
boundary.

The task rules forbid touching Coolify applications, production services, or a
shared deployment to make CI pass. They also forbid weakening the auth check.
GitHub-hosted runners would not solve this and are forbidden for this pull
request anyway.

## Exact environment that would unblock it

Provide one disposable provisioning sandbox owned only by OpenScholar CI:

1. A separate Convex development deployment used only by the activation test.
2. Disposable database and storage providers with credentials scoped to that
   sandbox.
3. An isolated runtime provider with no access to existing Coolify applications,
   plus a test domain and the runtime image needed for the readiness check.
4. A reliable cleanup operation that removes only the library created by that
   test, including its runtime, database, storage, and Convex rows.
5. Secrets available only to the `OpenScholar Secret CI` runner group and an
   explicit network allowlist for those provider endpoints.

The sandbox must support two exact-head runs and simultaneous `new-el` CI
without sharing accounts, work directories, Docker sockets, writable tool
paths, or deployment credentials.

## Options

1. Provision the isolated sandbox above. This preserves the original browser
   contract and the security rules.
2. Add explicit test provider adapters that perform the full setup lifecycle
   against disposable services. This is product and provider work, not a CI
   setting change, and still needs a public runtime for the final readiness
   check.
3. Accept the smaller Save and reopen check. This weakens the existing auth
   contract and is not allowed by this task.
4. Give CI access to the shared development Coolify setup. This violates the
   task's safety rules and is not allowed.

## Safe work that continues

Unit tests, the production build, all live billing tests, all billing browser
tests, and the safe Clerk suite run on the four isolated OpenScholar runners.
No paid GitHub runner is used. Artifact uploads stay required while GitHub
recalculates storage after the expired artifacts were deleted.
