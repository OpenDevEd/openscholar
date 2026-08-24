# Coolify status research for issue #26

Checked on 2026-08-24 against the user's development Coolify instance, the matching Coolify `v4.3.10` source tag, and upstream commit `2b5fd8e2ec0a8ed5afbbfb1d74529b309869da46` from the same day.

## Answer

No. Coolify 4.3.10 has no supported REST API endpoint that returns every container in a Git-backed Docker Compose application with its Compose service name, runtime state, and Docker health state.

The supported API returns two useful but separate summaries:

- one deployment job status;
- one aggregate application status.

That is not enough to satisfy Evidence Library issue [#50](https://github.com/OpenDevEd/new-el/issues/50). Issue #50 requires the caller to prove that all six expected services exist, identify any missing or failed service, check health where defined, and check that the two source workers are running.

## What Coolify exposes

| Endpoint                                           | Fields needed by #26                                                                                                                                                         | What it proves                                                                                                                                  | What it does not prove                                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/deployments/{deployment_uuid}`        | `deployment_uuid`, `status`, `commit`, `created_at`, `updated_at`, `finished_at`, `application_id`, `application_name`, `server_id`, `server_name`, `destination_id`, `logs` | Whether the requested Coolify deployment job is queued, running, finished, failed, or cancelled.                                                | It has no container or Compose service list. A `finished` job is not current container evidence.                          |
| `GET /api/v1/applications/{application_uuid}`      | `uuid`, `name`, `status`, `build_pack`, `git_repository`, `git_branch`, `git_commit_sha`, `docker_compose_location`, `docker_compose_domains`                                | The application configuration and one aggregate runtime status such as `running:healthy`, `running:unknown`, `degraded:unhealthy`, or `exited`. | It does not return the observed service names or each container's state and health.                                       |
| `GET /api/v1/applications/{application_uuid}/logs` | `logs`                                                                                                                                                                       | Recent logs from one selected container.                                                                                                        | On 4.3.10 it picks the first matching application container. It has no service selector and returns no structured status. |

Coolify documents the application `status` field in its [application response](https://coolify.io/docs/api-reference/api/applications/get-application-by-uuid) and the deployment `status` field in its [deployment response](https://coolify.io/docs/api-reference/api/deployments/get-deployment-by-uuid). The deployment status values in 4.3.10 are `queued`, `in_progress`, `finished`, `failed`, and `cancelled-by-user` in the [source enum](https://github.com/coollabsio/coolify/blob/v4.3.10/app/Enums/ApplicationDeploymentStatus.php#L5-L12).

The absence of a container endpoint is official, not a guess. The current [public OpenAPI file](https://github.com/coollabsio/coolify-docs/blob/v4.x/config/openapi.json) has application, deployment, resource, server, and service routes, but no application-container route. The exact 4.3.10 API route table has the [deployment read routes](https://github.com/coollabsio/coolify/blob/v4.3.10/routes/api.php#L144-L149) and the [application get and log routes](https://github.com/coollabsio/coolify/blob/v4.3.10/routes/api.php#L230-L278), but no route that exposes Compose services or containers. The complete [upstream route table at `2b5fd8e2`](https://github.com/coollabsio/coolify/blob/2b5fd8e2ec0a8ed5afbbfb1d74529b309869da46/routes/api.php) still has no such route.

Coolify does collect each container's Compose service name and Docker state internally. It then writes one combined value to `applications.status`. See the internal [container collection and service-name mapping](https://github.com/coollabsio/coolify/blob/v4.3.10/app/Actions/Docker/GetContainersStatus.php#L101-L170) and [application status aggregation](https://github.com/coollabsio/coolify/blob/v4.3.10/app/Actions/Docker/GetContainersStatus.php#L453-L535). The [aggregator](https://github.com/coollabsio/coolify/blob/v4.3.10/app/Services/ContainerStatusAggregator.php#L205-L275) deliberately reduces all observed containers to one string.

The log endpoint does not provide a hidden substitute. Its 4.3.10 implementation loads the matching containers, selects the first one, and returns only a `logs` string. See [ApplicationsController](https://github.com/coollabsio/coolify/blob/v4.3.10/app/Http/Controllers/Api/ApplicationsController.php#L2444-L2482) and the [official log endpoint](https://coolify.io/docs/api-reference/api/applications/get-application-logs-by-uuid).

## Live development readback

Read-only calls to `https://coolify.opendeved.net` returned:

```json
{
  "coolifyVersion": "4.3.10",
  "application": {
    "uuid": "rzbo9als0hdnr4gegtx97qos",
    "name": "openscholar-e2e-compose",
    "build_pack": "dockercompose",
    "docker_compose_location": "/docker/compose.library.yaml",
    "status": "running:unknown"
  },
  "latestDeployment": {
    "deployment_uuid": "s1zleysaqoodb8gq4neth30q",
    "status": "finished",
    "commit": "ca013d23cdd0b1cd4b92d70e2a0fcb5901cba728"
  }
}
```

The application response had no `containers`, `services`, or per-service health field. The deployment response also had no such field.

`running:unknown` is expected for this Compose file. [`source-sync` and `source-writeback`](https://github.com/OpenDevEd/new-el/blob/7878a359e30525f84dca0209c0745cb608edb990/docker/compose.library.yaml#L73-L103) intentionally have no health check. Coolify's [status collector](https://github.com/coollabsio/coolify/blob/v4.3.10/app/Actions/Docker/GetContainersStatus.php#L101-L118) maps a running container without a Docker health value to `unknown`. Coolify's own [health-check guide](https://coolify.io/docs/knowledge-base/health-checks) confirms that Compose applications take health checks from each Dockerfile or Compose service. An aggregate `running:unknown` therefore cannot distinguish the two expected no-health workers from an incomplete service set.

## Existing Evidence Library method

Evidence Library issue #50 already uses the correct boundary. Its [operations guide](https://github.com/OpenDevEd/new-el/blob/7878a359e30525f84dca0209c0745cb608edb990/docs/evidence-library-operations.md#L263-L298) keeps three kinds of evidence separate:

1. Coolify deployment status.
2. Host-side `docker compose ps --all --format json` output for all six services.
3. HTTP checks for the requested configuration revision, public page, and `/admin`.

The repository has no existing live Coolify container-status client. [`verifyLibraryCompose.ts`](https://github.com/OpenDevEd/new-el/blob/7878a359e30525f84dca0209c0745cb608edb990/tools/verifyLibraryCompose.ts#L33-L212) checks the rendered Compose definition before deployment. It does not inspect a deployed application. [`runRuntimeAcceptance.ts`](https://github.com/OpenDevEd/new-el/blob/7878a359e30525f84dca0209c0745cb608edb990/tools/runRuntimeAcceptance.ts#L380-L434) checks real service state with local `docker compose ps`, but only for the disposable local acceptance environment.

## Boundary for issue #26

Issue #26 can use the supported Coolify API to create the application, start the deployment, and poll `GET /api/v1/deployments/{deployment_uuid}` until `status` is `finished` or `failed`. It may also read `GET /api/v1/applications/{application_uuid}` as a summary signal.

The readiness step still needs a read-only check on the deployment host. That check must return the exact expected service set plus each service's `State` and `Health`, using the Compose command already named in the Evidence Library operations guide or the equivalent Docker label query used by Coolify itself. After that, #26 must check `/api/library-config/health`, the public page, and `/admin`.

If the provisioning runner has only a Coolify API token and no approved host-side verifier, the readiness part of #26 is blocked. Parsing deployment logs, accepting `running:unknown`, or treating HTTP success from `web` as proof of all workers would weaken issue #50's contract.

The smallest supported bridge is one fixed read-only verifier. It accepts only a validated Coolify application UUID, selects containers with the `com.docker.compose.project=<applicationUuid>` label, and returns the Compose service label, container state, and Docker health state. It must require exactly one `web`, `search-indexer`, `source-sync`, `source-writeback`, `publication-worker`, and `meilisearch` container. It must not accept a shell command or act as a general remote runner.

The first implementation choice is a Node Convex action that uses deployment-specific SSH credentials. Test that outbound connection from the isolated Convex development lane before depending on it. If the lane cannot reach the host, use a small authenticated endpoint on the host that performs only this one query. Do not mount the Docker socket into OpenScholar or Convex.

The application flow also needs deterministic recovery. Tag each app `openscholar-library-<libraryId>`, search for that tag before creation, save the returned application UUID immediately, read back every updated environment value, save the deployment UUID before polling, and adopt an already-running deployment for the same app, commit, and configuration hash after an uncertain response. Coolify does not provide an idempotency header for deployment creation.

This last blocker is an inference from the verified API boundary. The missing public container endpoint itself is directly confirmed by the official API specification, the 4.3.10 source route table, and the live responses above.
