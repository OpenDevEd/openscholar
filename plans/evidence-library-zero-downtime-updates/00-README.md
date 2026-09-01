# Evidence Library update continuity

Follow the repository working agreement in `AGENTS.md` and the project guides
in both repositories.

## Problem

The deployment controller replaces one Docker Compose application in place.
It stops the running containers before starting the replacement. The public
router therefore has no web server during every setup retry, configuration
publish, domain change, and software update. Readiness runs after this gap and
cannot prevent it.

## Fixed decisions

1. A running library keeps serving its last active web revision while the
   replacement Compose application starts. The replacement receives a trial
   route only after its runtime and configuration checks pass; the old web
   remains its fallback until the public-page and admin-page checks pass.
2. The host runtime verifier also owns one temporary continuity guard. It
   clones only the current `web` container. Workers, PostgreSQL, Meilisearch,
   Redis, and volumes are never duplicated.
3. Traefik's existing watched file-provider directory owns the temporary
   route. The route has a generic maintenance fallback. Users never receive
   the proxy's raw "no available server" response.
4. Setup uses the maintenance route because no previous web revision exists.
   Updates use the continuity guard. A failed update leaves the guard and old
   revision routed until retry or teardown.
5. Finalization removes the temporary file-provider route so the deployment
   router owns the new `web` container, then removes the guard. A failed public
   check restores the old guard route.
   The host writes routing files atomically.
6. The existing application remains the only full runtime and data owner. This
   phase does not promise uninterrupted search or AI calls while their private
   dependencies restart. It guarantees that the public host keeps answering
   with the old site or the maintenance page instead of losing its server.

## Reuse

- `new-el` runtime verifier Docker inspection and fixed HTTP server
- `new-el` atomic file replacement helper
- the deployed Traefik file-provider directory already used by the library
  shield
- OpenScholar's saved application UUID, runtime commit and image, revision,
  platform address, custom-domain list, deployment polling, and readiness
  checks
- the existing configuration operation for retries and failure reporting

## Cross-repository contract

`new-el` adds authenticated, retry-safe runtime-verifier operations:

- prepare maintenance routing for first setup;
- protect a running application by starting or adopting its exact web guard;
- activate a trial route to the checked replacement with the guard as fallback;
- return traffic to the deployment router and remove the guard;
- remove routing and any guard during teardown.

Every request is limited to one validated application UUID and complete host
list. The verifier derives container identity, image, networks, and current
configuration from Docker. It never accepts a container name, image, command,
mount path, upstream URL, route rule, or filesystem path from the caller.

OpenScholar calls prepare or protect before starting a deployment, checks the
replacement services, activates the trial route, checks the public and admin
pages, then finalizes. A failed public check restores protection. Teardown
calls remove before deleting the application. Retries adopt the deterministic
guard and route for the same application.

## Data and cleanup

No Convex or tenant database migration is needed. Guard identity and route file
names derive from the application UUID. The host keeps the copied active
configuration beside the guard and deletes both only after traffic switches or
the library is torn down.

The runtime-verifier deployment gains two writable host directories: the
existing Traefik dynamic directory and a dedicated guard-state directory. Its
Docker socket proxy permits only the container write calls required to create,
start, inspect, stop, and delete the guard. The public API remains bearer-token
authenticated and accepts fixed JSON shapes.

## Checks

- New EL unit boundary: prepare serves maintenance, protect clones only the
  verified web container, repeated protect adopts it, activation retains the
  guard as fallback, finalization writes the new upstream before deleting the
  guard, and a failed candidate leaves the guard.
- OpenScholar action boundary: deployment never starts if protection fails;
  setup prepares maintenance; readiness success activates the new upstream;
  failure does not remove protection; teardown removes it.
- Existing Compose verifier and OpenScholar deployment tests stay green.
- Final CI must pass on the exact PR heads in both repositories.
- Development live gate: repeatedly request one library page during a real
  software update. Every response must be the old page, the new page, or the
  maintenance page. No response may be the proxy's missing-server answer.

## Completion

The change is complete after both PRs merge, the runtime verifier and
OpenScholar development services deploy, one existing development library is
updated through the real flow, continuous request evidence shows no missing
server response, failed-update recovery is checked, and the changed decision is
recorded in the shared product documents.
