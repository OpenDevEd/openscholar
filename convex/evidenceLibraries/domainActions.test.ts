/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

// The pinned client opens a real socket, which a test cannot answer. The
// address check it wraps still runs for real; only the connector is stubbed,
// so a refused domain still fails here exactly as it would in production.
vi.mock("./domainEgressNode", async () => {
  const egress = await import("./domainEgress");
  return {
    createPinnedFetch: () => globalThis.fetch,
    openPinnedDomainClient: async (input: { host: string }) => {
      await egress.readSafeDomainAddresses(input);
      return globalThis.fetch;
    },
  };
});

const TARGET = "cname.openscholar.test";
const TARGET_ADDRESSES = ["188.114.96.6", "188.114.97.6"];
const CUSTOM_HOST = "evidence.example.org";
const PLATFORM_HOST = "climate-evidence-lib.libraries.example.test";

type Fixture = Awaited<ReturnType<typeof createReadySetupFixture>>;

type World = {
  /** What the customer's zone answers for the A query. */
  cname?: string;
  addresses?: string[];
  missing?: boolean;
  /** What the ownership record holds, if anything. */
  token?: string;
  caaIssuers?: string[];
  /** Hosts Coolify already serves for something else. */
  coolifyHosts?: string[];
  /** The health answer the custom domain gives. */
  health?: { revision: string } | "none" | "other";
  certificate?: { status: string; ssl: string };
  cloudflareFails?: boolean;
  resolverDisagrees?: boolean;
  dnsOffline?: boolean;
  coolifyConflict?: boolean;
  coolifyOffline?: boolean;
  /** The host owns its zone, so it can carry no alias. */
  apex?: boolean;
  /** Answer the health probe for every host, not just the custom one. */
  anyHost?: boolean;
  /** What the proxy already serves for this library. */
  serving?: string[];
};

function dnsAnswer(world: World, name: string, type: string, google: boolean) {
  const dot = google ? "." : "";
  if (type === "SOA") {
    return {
      Status: 0,
      Answer: world.apex
        ? [{ name: `${name}${dot}`, type: 6, data: "ns1. hostmaster. 1 2 3 4 5" }]
        : [],
    };
  }
  if (type === "CAA") {
    return {
      Status: 0,
      Answer: (world.caaIssuers ?? []).map((issuer) => ({
        name: `${name}${dot}`,
        type: 257,
        data: `0 issue "${issuer}"`,
      })),
    };
  }
  if (type === "TXT") {
    if (!world.token) return { Status: 0 };
    return {
      Status: 0,
      Answer: [
        { name: `${name}${dot}`, type: 16, data: `"${world.token}"` },
      ],
    };
  }
  if (name === TARGET) {
    return {
      Status: 0,
      Answer: TARGET_ADDRESSES.map((address) => ({
        name: `${name}${dot}`,
        type: 1,
        data: address,
      })),
    };
  }
  if (world.missing) return { Status: 3 };
  const answer: unknown[] = [];
  if (world.cname) {
    answer.push({ name: `${name}${dot}`, type: 5, data: `${world.cname}${dot}` });
  }
  // A real resolver returns the whole chain: the alias and the addresses it
  // ends in.
  const addresses =
    world.addresses ?? (world.cname === TARGET ? TARGET_ADDRESSES : []);
  for (const address of addresses) {
    answer.push({ name: `${name}${dot}`, type: 1, data: address });
  }
  // Google is made to read something different when the test asks for it.
  if (google && world.resolverDisagrees) {
    return { Status: 0, Answer: [] };
  }
  return answer.length > 0 ? { Status: 0, Answer: answer } : { Status: 0 };
}

function createWorld(world: World, tag = "openscholar-library-placeholder") {
  const coolifyPatches: unknown[] = [];
  const coolifyCalls: { method: string; url: string }[] = [];
  const cloudflareCalls: { method: string; url: string; body: unknown }[] = [];
  const probedHosts: string[] = [];
  let composeDomains = [
    `https://${PLATFORM_HOST}`,
    ...(world.serving ?? []),
  ].join(",");

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (url.hostname === "cloudflare-dns.com" || url.hostname === "dns.google") {
      if (world.dnsOffline) throw new Error("dns offline");
      return Response.json(
        dnsAnswer(
          world,
          url.searchParams.get("name")!,
          url.searchParams.get("type")!,
          url.hostname === "dns.google",
        ),
      );
    }

    if (url.hostname === "api.cloudflare.com") {
      cloudflareCalls.push({ method, url: url.pathname + url.search, body });
      if (world.cloudflareFails) {
        return Response.json({ success: false, errors: [] }, { status: 400 });
      }
      const certificate = world.certificate ?? {
        status: "pending",
        ssl: "pending_validation",
      };
      const hostname = {
        id: "custom-hostname-1",
        hostname: CUSTOM_HOST,
        status: certificate.status,
        ssl: { status: certificate.ssl },
      };
      if (method === "GET") {
        // The service answers about whatever hostname was asked for.
        const asked = url.searchParams.get("hostname");
        return Response.json({
          success: true,
          result: world.certificate
            ? [{ ...hostname, hostname: asked ?? hostname.hostname }]
            : [],
        });
      }
      return Response.json({ success: true, result: hostname });
    }

    if (url.hostname === "coolify.example.test") {
      coolifyCalls.push({ method, url: url.pathname });
      if (world.coolifyOffline) throw new Error("coolify offline");
      if (url.pathname === "/api/v1/applications" && method === "GET") {
        return Response.json(
          (world.coolifyHosts ?? []).map((host) => ({
            fqdn: `https://${host}`,
          })),
        );
      }
      if (url.pathname === "/api/v1/services") return Response.json([]);
      if (method === "PATCH") {
        if (world.coolifyConflict) {
          return Response.json({ message: "taken" }, { status: 409 });
        }
        coolifyPatches.push(body);
        const patched = body as { docker_compose_domains?: { domain: string }[] };
        if (patched.docker_compose_domains?.[0]) {
          composeDomains = patched.docker_compose_domains[0].domain;
        }
        return Response.json({ uuid: "coolify-domains" });
      }
      if (url.pathname.endsWith("/tags")) {
        return Response.json([{ uuid: "tag00000000000000000001", name: tag }]);
      }
      return Response.json(coolifyApplication(composeDomains, tag));
    }

    if (
      url.hostname === CUSTOM_HOST ||
      url.hostname === "example.org" ||
      world.anyHost
    ) {
      probedHosts.push(url.hostname);
      if (world.health === "other" ) {
        return new Response("<html>someone else</html>", { status: 200 });
      }
      if (!world.health || world.health === "none") {
        return new Response("no available server\n", { status: 503 });
      }
      return Response.json({
        state: "active",
        rejected: null,
        active: { revision: world.health.revision },
      });
    }

    throw new Error(`unexpected request ${url.href}`);
  }) as unknown as typeof fetch;

  return { fetchImpl, coolifyPatches, coolifyCalls, cloudflareCalls, probedHosts };
}

function coolifyApplication(composeDomains: string, tag: string) {
  return {
    uuid: "coolify-domains",
    name: tag,
    config_hash: "1".repeat(64),
    git_repository: "OpenDevEd/new-el",
    git_branch: "main",
    git_commit_sha: "a".repeat(40),
    build_pack: "dockercompose",
    ports_exposes: "80",
    fqdn: null,
    docker_compose_location: "/docker/compose.library.yaml",
    docker_compose_domains: JSON.stringify({ web: { domain: composeDomains } }),
    source_type: "App\\Models\\GithubApp",
    source_id: 7,
    environment: { name: "development", project: { uuid: "project-1" } },
    destination: { server: { uuid: "server-1" } },
    settings: {
      is_auto_deploy_enabled: false,
      is_preview_deployments_enabled: false,
      connect_to_docker_network: false,
      inject_build_args_to_dockerfile: false,
      include_source_commit_in_build: false,
      is_container_label_escape_enabled: false,
    },
  };
}

/** Points the fixture's binding at the Coolify application the fake serves. */
async function bindApplication(fixture: Fixture) {
  await fixture.t.run(async (ctx) => {
    const binding = await ctx.db
      .query("evidenceLibraryRuntimeBindings")
      .withIndex("by_libraryId", (query) =>
        query.eq("libraryId", fixture.created.libraryId),
      )
      .unique();
    if (binding) {
      await ctx.db.patch(binding._id, { targetRuntimeId: "coolify-domains" });
    }
  });
  return `openscholar-library-${fixture.created.libraryId}`;
}

/** Moves a row straight to verified, the way two passing checks would. */
async function markVerified(
  fixture: Fixture,
  domainId: Id<"evidenceLibraryDomains">,
) {
  await fixture.t.run(async (ctx) => {
    await ctx.db.patch(domainId, { state: "verified", updatedAt: Date.now() });
  });
}

async function addDomain(fixture: Fixture, host = CUSTOM_HOST) {
  return await fixture.admin.action(
    api.evidenceLibraries.domainActions.addDomain,
    { libraryId: fixture.created.libraryId, host },
  );
}

async function readRow(fixture: Fixture, domainId: Id<"evidenceLibraryDomains">) {
  return await fixture.t.run(async (ctx) => await ctx.db.get(domainId));
}


/** The arguments the deployment pipeline passes itself for one operation. */
async function deploymentArgs(
  fixture: Fixture,
  operationId: Id<"evidenceLibraryConfigOperations">,
) {
  const operation = await fixture.t.run(async (ctx) => ctx.db.get(operationId));
  return {
    libraryId: fixture.created.libraryId,
    operationId,
    attemptToken: operation?.configurationAttemptToken ?? "",
    attemptCount: operation?.attemptCount ?? 1,
  };
}

/**
 * Finishes a deployment through the pipeline's own completion mutation, so
 * the work that follows a domain change runs through its real hook.
 */
async function runDeploymentCompletion(
  fixture: Fixture,
  operationId: Id<"evidenceLibraryConfigOperations">,
) {
  const receipt = await fixture.t.run(async (ctx) => {
    const operation = await ctx.db.get(operationId);
    if (!operation) return null;
    const library = await ctx.db.get(fixture.created.libraryId);
    const binding = library?.runtimeBindingId
      ? await ctx.db.get(library.runtimeBindingId)
      : null;
    const revision = library?.activeRevisionId
      ? await ctx.db.get(library.activeRevisionId)
      : null;
    if (!binding || !revision) return null;
    // The deployment action saves this before it runs; the test stands in
    // for that one step so the real completion mutation can run.
    const target = operation.configurationDeploymentTarget ?? {
      applicationId: "coolify-domains",
      aiProviderKey: { present: false as const },
      runtimeBindingId: binding._id,
      targetBaseUrl: binding.targetBaseUrl,
      customDomains: [],
      revisionKey: revision.revisionKey,
      defaultLocale: "en-GB",
      runtimeCommit: "a".repeat(40),
      encryptedRuntimeConfig: "encrypted",
      runtimeConfigSha256: "e".repeat(64),
      savedAt: Date.now(),
    };
    await ctx.db.patch(operationId, {
      configurationDeploymentTarget: target,
      stage: "activating",
      receipt: {
        revisionKey: target.revisionKey,
        targetConfigSha256: target.runtimeConfigSha256,
        runtimeCommit: target.runtimeCommit,
        runtimeReceiptId: "deployment-1",
        coolifyConfigHash: "d".repeat(64),
      },
      updatedAt: Date.now(),
    });
    return {
      attemptToken: operation?.configurationAttemptToken ?? "",
      attemptCount: operation?.attemptCount ?? 1,
    };
  });
  if (!receipt) throw new Error("the deployment has no saved target");
  await fixture.t.mutation(
    internal.evidenceLibraries.configurationDeployment
      .completeConfigurationDeployment,
    {
      libraryId: fixture.created.libraryId,
      operationId,
      attemptToken: receipt.attemptToken,
      attemptCount: receipt.attemptCount,
      checkedAt: Date.now(),
    },
  );
}

/** The deployment a domain is waiting on. */
async function readPendingOperationId(
  fixture: Fixture,
  domainId: Id<"evidenceLibraryDomains">,
) {
  const row = await readRow(fixture, domainId);
  const operationId = row?.pendingDeployment?.operationId;
  if (!operationId) throw new Error("no deployment is owed");
  return operationId;
}

async function readOperations(fixture: Fixture) {
  return await fixture.t.run(async (ctx) =>
    await ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_createdAt", (query) =>
        query.eq("libraryId", fixture.created.libraryId),
      )
      .collect(),
  );
}

async function readLiveRevisionKey(fixture: Fixture) {
  return await fixture.t.run(async (ctx) => {
    const library = await ctx.db.get(fixture.created.libraryId);
    const revision = library?.activeRevisionId
      ? await ctx.db.get(library.activeRevisionId)
      : null;
    return revision?.revisionKey ?? "";
  });
}

/** The address the live revision tells the runtime to call its own. */
async function readIdentityBaseUrl(fixture: Fixture) {
  return await fixture.t.run(async (ctx) => {
    const library = await ctx.db.get(fixture.created.libraryId);
    if (!library?.activeRevisionId) return null;
    const row = await ctx.db
      .query("evidenceLibraryConfigSections")
      .withIndex("by_revisionId_and_sectionKey", (query) =>
        query
          .eq("revisionId", library.activeRevisionId!)
          .eq("sectionKey", "identity"),
      )
      .unique();
    return (row?.payload as { baseUrl?: string } | null)?.baseUrl ?? null;
  });
}

/** Marks the running publish finished so the next one may start. */
async function finishDeployment(fixture: Fixture) {
  await fixture.t.run(async (ctx) => {
    const operations = await ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_createdAt", (query) =>
        query.eq("libraryId", fixture.created.libraryId),
      )
      .collect();
    for (const operation of operations) {
      if (operation.status === "queued" || operation.status === "running") {
        await ctx.db.patch(operation._id, {
          status: "succeeded",
          stage: "completed",
          configurationAttemptToken: undefined,
          configurationLeaseExpiresAt: undefined,
          completedAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
  });
}

describe("custom domains", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_CUSTOM_DOMAIN_TARGET", TARGET);
    vi.stubEnv("EL_CLOUDFLARE_API_TOKEN", "cf-token");
    vi.stubEnv("EL_CLOUDFLARE_ZONE_ID", "zone-1");
    vi.stubEnv("EL_COOLIFY_URL", "https://coolify.example.test");
    vi.stubEnv("EL_COOLIFY_TOKEN", "coolify-token");
    vi.stubEnv("EL_ALLOW_DEVELOPMENT_TEARDOWN", "true");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
    vi.stubEnv("EL_COOLIFY_PROJECT_UUID", "project-1");
    vi.stubEnv("EL_COOLIFY_SERVER_UUID", "server-1");
    vi.stubEnv("EL_STORAGE_URL", "https://storage.example.test");
    vi.stubEnv("EL_STORAGE_SERVICE_KEY", "storage-key");
    vi.stubEnv("EL_DATABASE_PROVISIONER_URL", "https://database.example.test");
    vi.stubEnv("EL_DATABASE_PROVISIONER_TOKEN", "database-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("says custom domains are not set up when the platform has no certificate account", async () => {
    const fixture = await createReadySetupFixture("domain-off");
    vi.stubEnv("EL_CLOUDFLARE_API_TOKEN", "");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);

    await expect(addDomain(fixture)).resolves.toEqual({
      status: "refused",
      reason: "not-set-up",
    });
    const listed = await fixture.admin.query(
      api.evidenceLibraries.domains.listDomains,
      { libraryId: fixture.created.libraryId },
    );
    expect(listed.platformReady).toBe(false);
    expect(listed.domains).toEqual([]);
  });

  it("refuses a name that is not a domain and one of our own names", async () => {
    const fixture = await createReadySetupFixture("domain-bad");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);

    await expect(addDomain(fixture, "not a domain")).resolves.toEqual({
      status: "refused",
      reason: "invalid",
    });
    await expect(addDomain(fixture, PLATFORM_HOST)).resolves.toEqual({
      status: "refused",
      reason: "platform-host",
    });
    await expect(addDomain(fixture, TARGET)).resolves.toEqual({
      status: "refused",
      reason: "platform-host",
    });
  });

  it("refuses a host our own servers already serve", async () => {
    const fixture = await createReadySetupFixture("domain-served");
    vi.stubGlobal("fetch", createWorld({ coolifyHosts: [CUSTOM_HOST] }).fetchImpl);

    await expect(addDomain(fixture)).resolves.toEqual({
      status: "refused",
      reason: "host-taken",
    });
  });

  it("refuses a host that is already claimed, inside the mutation", async () => {
    const fixture = await createReadySetupFixture("domain-claimed");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    await expect(addDomain(fixture)).resolves.toMatchObject({ status: "added" });

    // The action checked a moment ago; this is the transaction that decides.
    const claimed = await fixture.admin.mutation(
      internal.evidenceLibraries.domains.claimDomainHost,
      { libraryId: fixture.created.libraryId, host: CUSTOM_HOST },
    );
    expect(claimed).toEqual({ status: "host-taken" });
    await expect(addDomain(fixture)).resolves.toEqual({
      status: "refused",
      reason: "host-taken",
    });
  });

  it("shows the two records the owner has to add", async () => {
    const fixture = await createReadySetupFixture("domain-records");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    await addDomain(fixture);

    const listed = await fixture.admin.query(
      api.evidenceLibraries.domains.listDomains,
      { libraryId: fixture.created.libraryId },
    );
    expect(listed.target).toBe(TARGET);
    expect(listed.domains[0]).toMatchObject({
      host: CUSTOM_HOST,
      state: "added",
      attached: false,
      recordName: `_openscholar.${CUSTOM_HOST}`,
    });
    expect(listed.domains[0]!.recordValue).toMatch(/^os-verify=[0-9a-f]{32}$/);
  });

  it("reads the records and reports each failure by name", async () => {
    const fixture = await createReadySetupFixture("domain-gates");
    const world = createWorld({});
    vi.stubGlobal("fetch", world.fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    const token = (await readRow(fixture, domainId))!.verificationToken;

    async function check(next: Partial<World>) {
      Object.assign(world, {});
      const replaced = createWorld({ ...next });
      vi.stubGlobal("fetch", replaced.fetchImpl);
      return await fixture.admin.action(
        api.evidenceLibraries.domainActions.checkDomain,
        { libraryId: fixture.created.libraryId, domainId },
      );
    }

    await expect(check({ missing: true })).resolves.toMatchObject({
      state: "failed",
      failure: "no-name",
    });
    await expect(check({ addresses: ["203.0.113.9"] })).resolves.toMatchObject({
      state: "failed",
      failure: "wrong-target",
    });
    await expect(check({ cname: TARGET })).resolves.toMatchObject({
      state: "pointing",
    });
    await expect(
      check({ cname: TARGET, token: "os-verify=wrong" }),
    ).resolves.toMatchObject({ state: "failed", failure: "token-mismatch" });
    await expect(
      check({ cname: TARGET, token: `os-verify=${token}`, caaIssuers: ["amazon.com"] }),
    ).resolves.toMatchObject({ state: "failed", failure: "caa-blocked" });
    await expect(
      check({
        cname: TARGET,
        token: `os-verify=${token}`,
        caaIssuers: ["letsencrypt.org"],
      }),
    ).resolves.toMatchObject({ state: "verified" });
  });

  it("passes the top of a zone that answers with the target's own addresses", async () => {
    const fixture = await createReadySetupFixture("domain-apex");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const added = await addDomain(fixture, "example.org");
    if (added.status !== "added") throw new Error("not added");
    const token = (await readRow(fixture, added.domainId))!.verificationToken;

    vi.stubGlobal(
      "fetch",
      createWorld({
        addresses: [...TARGET_ADDRESSES],
        token: `os-verify=${token}`,
        apex: true,
      }).fetchImpl,
    );
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
        libraryId: fixture.created.libraryId,
        domainId: added.domainId,
      }),
    ).resolves.toMatchObject({ state: "verified" });
  });

  it("leaves the domain exactly as it was when the check could not run", async () => {
    const fixture = await createReadySetupFixture("domain-offline");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    const token = (await readRow(fixture, domainId))!.verificationToken;

    // One check that did run, so the row holds a real answer.
    vi.stubGlobal(
      "fetch",
      createWorld({ cname: TARGET, token: `os-verify=${token}` }).fetchImpl,
    );
    await fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
      libraryId: fixture.created.libraryId,
      domainId,
    });
    const before = await readRow(fixture, domainId);
    expect(before?.state).toBe("verified");

    for (const broken of [{ dnsOffline: true }, { resolverDisagrees: true, cname: TARGET }]) {
      vi.stubGlobal("fetch", createWorld(broken).fetchImpl);
      await expect(
        fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
          libraryId: fixture.created.libraryId,
          domainId,
        }),
      ).resolves.toEqual({ status: "check-failed" });
      const after = await readRow(fixture, domainId);
      expect(after?.state).toBe("verified");
      expect(after?.failure).toBeUndefined();
      expect(after?.checkedAt).toBe(before?.checkedAt);
    }
  });

  it("runs one check at a time for a domain", async () => {
    const fixture = await createReadySetupFixture("domain-lock");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");

    // Another check already holds the domain.
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(added.domainId, {
        transition: {
          kind: "remove",
          token: "someone-else",
          expiresAt: Date.now() + 60_000,
        },
        updatedAt: Date.now(),
      });
    });
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
        libraryId: fixture.created.libraryId,
        domainId: added.domainId,
      }),
    ).resolves.toEqual({ status: "busy" });
  });

  it("stops checking one domain over and over", async () => {
    const fixture = await createReadySetupFixture("domain-limit");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");

    let refused = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await fixture.admin.action(
          api.evidenceLibraries.domainActions.checkDomain,
          { libraryId: fixture.created.libraryId, domainId: added.domainId },
        );
      } catch {
        refused += 1;
      }
    }
    expect(refused).toBeGreaterThan(0);
  });

  it("attaches a verified domain with the platform address first, then publishes", async () => {
    const fixture = await createReadySetupFixture("domain-attach");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    await markVerified(fixture, added.domainId);

    const world = createWorld({}, tag);
    vi.stubGlobal("fetch", world.fetchImpl);
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
        libraryId: fixture.created.libraryId,
        domainId: added.domainId,
      }),
    ).resolves.toMatchObject({ state: "verified", certificateState: "pending" });

    expect(world.coolifyPatches).toEqual([
      {
        docker_compose_domains: [
          {
            name: "web",
            domain: `https://${PLATFORM_HOST},https://${CUSTOM_HOST}`,
          },
        ],
        instant_deploy: false,
      },
    ]);
    expect(world.cloudflareCalls.some((call) => call.method === "POST")).toBe(true);
    expect(
      world.cloudflareCalls.find((call) => call.method === "POST")?.body,
    ).toMatchObject({
      hostname: CUSTOM_HOST,
      custom_origin_server: PLATFORM_HOST,
    });
    const row = await readRow(fixture, added.domainId);
    expect(row?.attachedAt).toBeTypeOf("number");
    expect(row?.certificateHostnameId).toBe("custom-hostname-1");
    // The proxy only learns about a domain through a deployment.
    const operations = await fixture.t.run(async (ctx) =>
      await ctx.db
        .query("evidenceLibraryConfigOperations")
        .withIndex("by_libraryId_and_createdAt", (query) =>
          query.eq("libraryId", fixture.created.libraryId),
        )
        .collect(),
    );
    expect(
      operations.some((operation) => operation.domainChange?.reason === "attach"),
    ).toBe(true);
  });

  it("says the domain is taken when another site already serves it in the proxy", async () => {
    const fixture = await createReadySetupFixture("domain-conflict");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    await markVerified(fixture, added.domainId);

    vi.stubGlobal("fetch", createWorld({ coolifyConflict: true }, tag).fetchImpl);
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
        libraryId: fixture.created.libraryId,
        domainId: added.domainId,
      }),
    ).resolves.toMatchObject({ state: "failed", failure: "host-taken" });
  });

  it("goes live only once our library answers on the domain with its own version", async () => {
    const fixture = await createReadySetupFixture("domain-live");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "verified",
        attachedAt: Date.now(),
        certificateHostnameId: "custom-hostname-1",
        updatedAt: Date.now(),
      });
    });
    const revisionKey = await readLiveRevisionKey(fixture);

    async function check(next: World) {
      vi.stubGlobal("fetch", createWorld({ cname: TARGET, ...next }, tag).fetchImpl);
      return await fixture.admin.action(
        api.evidenceLibraries.domainActions.checkDomain,
        { libraryId: fixture.created.libraryId, domainId },
      );
    }

    // Nothing answers yet. That is not an answer about the domain, so the
    // check writes nothing rather than pushing the row back.
    await expect(
      check({
        cname: TARGET,
        certificate: { status: "active", ssl: "active" },
      }),
    ).resolves.toEqual({ status: "check-failed" });
    // The certificate is not there yet, but the site answers, so the domain
    // is verified and waiting.
    await expect(
      check({
        health: { revision: revisionKey },
        certificate: { status: "pending", ssl: "pending_validation" },
      }),
    ).resolves.toMatchObject({ state: "verified", certificateState: "pending" });
    // Someone else's site answers.
    await expect(
      check({ health: "other", certificate: { status: "active", ssl: "active" } }),
    ).resolves.toMatchObject({ state: "failed", failure: "host-taken" });
    // Everything is in place.
    await expect(
      check({
        health: { revision: revisionKey },
        certificate: { status: "active", ssl: "active" },
      }),
    ).resolves.toMatchObject({ state: "active", certificateState: "active" });
    const row = await readRow(fixture, domainId);
    expect(row?.activatedAt).toBeTypeOf("number");
  });

  it("never asks a domain that has been repointed inside our own network", async () => {
    const fixture = await createReadySetupFixture("domain-rebind");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        attachedAt: Date.now(),
        certificateHostnameId: "custom-hostname-1",
        certificateState: "active",
        updatedAt: Date.now(),
      });
    });
    const revisionKey = await readLiveRevisionKey(fixture);

    // The owner has repointed the domain at a private address since it was
    // verified. That is a real answer about the domain, so it stops being
    // active, and nothing is fetched.
    const world = createWorld(
      {
        addresses: ["127.0.0.1"],
        health: { revision: revisionKey },
        certificate: { status: "active", ssl: "active" },
      },
      tag,
    );
    vi.stubGlobal("fetch", world.fetchImpl);
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
        libraryId: fixture.created.libraryId,
        domainId,
      }),
    ).resolves.toMatchObject({ state: "failed", failure: "wrong-target" });
    expect(world.probedHosts).toEqual([]);
    expect((await readRow(fixture, domainId))?.state).toBe("failed");
  });

  it("takes the domain out of the proxy first and only removes it once the site is live", async () => {
    const fixture = await createReadySetupFixture("domain-remove");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        attachedAt: Date.now(),
        certificateHostnameId: "custom-hostname-1",
        updatedAt: Date.now(),
      });
    });

    const world = createWorld(
      {
        certificate: { status: "active", ssl: "active" },
        serving: [`https://${CUSTOM_HOST}`],
      },
      tag,
    );
    vi.stubGlobal("fetch", world.fetchImpl);
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.removeDomain, {
        libraryId: fixture.created.libraryId,
        domainId,
      }),
    ).resolves.toEqual({ status: "removing" });

    expect(world.coolifyPatches).toEqual([
      {
        docker_compose_domains: [
          { name: "web", domain: `https://${PLATFORM_HOST}` },
        ],
        instant_deploy: false,
      },
    ]);
    // The certificate and the row survive until the site stops serving the
    // host. Deleting them now would break the domain while it is still live.
    expect(world.cloudflareCalls.some((call) => call.method === "DELETE")).toBe(
      false,
    );
    const removing = await readRow(fixture, domainId);
    expect(removing?.removingAt).toBeTypeOf("number");
    expect(removing?.attachedAt).toBeUndefined();

    // The deployment that applies the removal finishes, through the real
    // completion mutation, which settles the row and schedules the cleanup.
    const operationId = await readPendingOperationId(fixture, domainId);
    await runDeploymentCompletion(fixture, operationId);
    await fixture.t.action(
      internal.evidenceLibraries.domainActions.completeDomainChange,
      {
        libraryId: fixture.created.libraryId,
        domainId,
        operationId,
        reason: "detach",
      },
    );
    expect(world.cloudflareCalls.some((call) => call.method === "DELETE")).toBe(
      true,
    );
    expect(await readRow(fixture, domainId)).toBeNull();
  });

  it("removes a domain the proxy never had without redeploying", async () => {
    const fixture = await createReadySetupFixture("domain-remove-early");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");

    const world = createWorld({}, tag);
    vi.stubGlobal("fetch", world.fetchImpl);
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.removeDomain, {
        libraryId: fixture.created.libraryId,
        domainId: added.domainId,
      }),
    ).resolves.toEqual({ status: "removed" });
    expect(world.coolifyPatches).toEqual([]);
    expect(await readRow(fixture, added.domainId)).toBeNull();
  });

  it("finishes a removal that stopped when the proxy could not be reached", async () => {
    const fixture = await createReadySetupFixture("domain-remove-resume");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        attachedAt: Date.now(),
        certificateHostnameId: "custom-hostname-1",
        updatedAt: Date.now(),
      });
    });

    // The first attempt reaches nothing and leaves the domain marked for
    // removal.
    vi.stubGlobal("fetch", createWorld({ coolifyOffline: true }, tag).fetchImpl);
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.removeDomain, {
        libraryId: fixture.created.libraryId,
        domainId,
      }),
    ).rejects.toThrow();
    expect((await readRow(fixture, domainId))?.removingAt).toBeTypeOf("number");

    // Pressing again finishes it: the lease was given back, so the second
    // attempt can take it.
    const world = createWorld({ serving: [`https://${CUSTOM_HOST}`] }, tag);
    vi.stubGlobal("fetch", world.fetchImpl);
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.removeDomain, {
        libraryId: fixture.created.libraryId,
        domainId,
      }),
    ).resolves.toEqual({ status: "removing" });
    expect(world.coolifyPatches).toHaveLength(1);
  });

  it("keeps every receipt when the proxy cannot be reached during a removal", async () => {
    const fixture = await createReadySetupFixture("domain-remove-offline");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        attachedAt: Date.now(),
        certificateHostnameId: "custom-hostname-1",
        updatedAt: Date.now(),
      });
    });

    const world = createWorld({ coolifyOffline: true }, tag);
    vi.stubGlobal("fetch", world.fetchImpl);
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.removeDomain, {
        libraryId: fixture.created.libraryId,
        domainId,
      }),
    ).rejects.toThrow();
    // Nothing was thrown away, so a retry finishes the removal.
    const row = await readRow(fixture, domainId);
    expect(row?.attachedAt).toBeTypeOf("number");
    expect(row?.certificateHostnameId).toBe("custom-hostname-1");
    expect(world.cloudflareCalls.some((call) => call.method === "DELETE")).toBe(
      false,
    );
  });

  it("refuses to remove the domain the library calls its own, before touching anything", async () => {
    const fixture = await createReadySetupFixture("domain-primary");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    // Attached and live: taking it out of the proxy would take the library
    // offline, so the refusal has to come first.
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        role: "primary",
        attachedAt: Date.now(),
        certificateHostnameId: "custom-hostname-1",
        updatedAt: Date.now(),
      });
    });

    const world = createWorld({ serving: [`https://${CUSTOM_HOST}`] }, tag);
    vi.stubGlobal("fetch", world.fetchImpl);
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.removeDomain, {
        libraryId: fixture.created.libraryId,
        domainId,
      }),
    ).rejects.toThrow(
      /Send the platform address back to itself before removing this domain/,
    );
    expect(world.coolifyCalls).toEqual([]);
    expect(world.cloudflareCalls).toEqual([]);
    const row = await readRow(fixture, domainId);
    expect(row?.attachedAt).toBeTypeOf("number");
    expect(row?.removingAt).toBeUndefined();
  });

  it("writes the library's new address only once the deployment carrying it is live", async () => {
    const fixture = await createReadySetupFixture("domain-toggle");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        attachedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const on = await fixture.admin.mutation(
      api.evidenceLibraries.versions.setDomainPrimary,
      { libraryId: fixture.created.libraryId, domainId, primary: true },
    );
    expect(on.address).toBe(`https://${CUSTOM_HOST}`);

    // The deployment has not finished, so nothing has moved yet. A failed
    // deployment must not leave OpenScholar claiming an address the site
    // does not answer on.
    let listed = await fixture.admin.query(
      api.evidenceLibraries.domains.listDomains,
      { libraryId: fixture.created.libraryId },
    );
    expect(listed.canonicalAddress).toBe(`https://${PLATFORM_HOST}`);
    expect(listed.domains[0]!.role).toBe("redirect");
    expect(await readIdentityBaseUrl(fixture)).toBe(`https://${PLATFORM_HOST}`);

    // The deployment carries the new address even though nothing stored has
    // changed, so the site starts answering on it.
    const prepared = await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .prepareConfigurationDeployment,
      await deploymentArgs(fixture, on.operationId),
    );
    if (prepared.state !== "new") throw new Error("not a new deployment");
    const identity = prepared.sections.find(
      (row: { sectionKey: string }) => row.sectionKey === "identity",
    );
    expect((identity?.payload as { baseUrl?: string }).baseUrl).toBe(
      `https://${CUSTOM_HOST}`,
    );

    // The real hook: finishing the deployment schedules the last step.
    await runDeploymentCompletion(fixture, on.operationId);
    listed = await fixture.admin.query(
      api.evidenceLibraries.domains.listDomains,
      { libraryId: fixture.created.libraryId },
    );
    // The platform address is never released: it keeps redirecting.
    expect(listed.platformAddress).toBe(`https://${PLATFORM_HOST}`);
    expect(listed.canonicalAddress).toBe(`https://${CUSTOM_HOST}`);
    expect(listed.domains[0]!.role).toBe("primary");
    expect(await readIdentityBaseUrl(fixture)).toBe(`https://${CUSTOM_HOST}`);
  });

  it("leaves the library's address alone when the deployment never finishes", async () => {
    const fixture = await createReadySetupFixture("domain-toggle-failed");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        attachedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const on = await fixture.admin.mutation(
      api.evidenceLibraries.versions.setDomainPrimary,
      { libraryId: fixture.created.libraryId, domainId, primary: true },
    );
    // Readiness never passed, so the operation failed.
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(on.operationId, {
        status: "failed",
        error: { code: "TEST", message: "readiness failed", stage: "publishing" },
        completedAt: Date.now(),
        configurationAttemptToken: undefined,
        configurationLeaseExpiresAt: undefined,
        updatedAt: Date.now(),
      });
    });

    const listed = await fixture.admin.query(
      api.evidenceLibraries.domains.listDomains,
      { libraryId: fixture.created.libraryId },
    );
    expect(listed.canonicalAddress).toBe(`https://${PLATFORM_HOST}`);
    expect(listed.domains[0]!.role).toBe("redirect");
    expect(await readIdentityBaseUrl(fixture)).toBe(`https://${PLATFORM_HOST}`);
  });

  it("refuses to send the platform address to a domain that is not working yet", async () => {
    const fixture = await createReadySetupFixture("domain-toggle-early");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");

    await expect(
      fixture.admin.mutation(api.evidenceLibraries.versions.setDomainPrimary, {
        libraryId: fixture.created.libraryId,
        domainId: added.domainId,
        primary: true,
      }),
    ).rejects.toThrow(/has to be working before it can become the address/);
  });

  it("stops showing a domain as working when its records point somewhere else", async () => {
    const fixture = await createReadySetupFixture("domain-sweep-repointed");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        attachedAt: Date.now(),
        certificateHostnameId: "custom-hostname-1",
        certificateState: "active",
        checkedAt: 1,
        updatedAt: Date.now(),
      });
    });

    // Repointed at a private address. A sweep must not leave it active.
    vi.stubGlobal(
      "fetch",
      createWorld({ addresses: ["10.0.0.5"], anyHost: true }, tag).fetchImpl,
    );
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.domainActions.sweepWorkingDomains,
        {},
      ),
    ).resolves.toMatchObject({ checked: 1, failed: 1 });
    const swept = await readRow(fixture, domainId);
    expect(swept?.state).toBe("failed");
    expect(swept?.failure).toBe("wrong-target");
  });

  it("stops showing a domain as working once its records go away", async () => {
    const fixture = await createReadySetupFixture("domain-sweep");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        attachedAt: Date.now(),
        certificateHostnameId: "custom-hostname-1",
        certificateState: "active",
        activatedAt: Date.now(),
        checkedAt: 1,
        updatedAt: Date.now(),
      });
    });
    const revisionKey = await readLiveRevisionKey(fixture);

    // The library still answers, and the check time moves forward so the
    // next page starts after it.
    vi.stubGlobal(
      "fetch",
      createWorld(
        {
          cname: TARGET,
          health: { revision: revisionKey },
          certificate: { status: "active", ssl: "active" },
        },
        tag,
      ).fetchImpl,
    );
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.domainActions.sweepWorkingDomains,
        {},
      ),
    ).resolves.toEqual({ checked: 1, failed: 0, more: false });
    const swept = await readRow(fixture, domainId);
    expect(swept?.state).toBe("active");
    expect(swept?.checkedAt).toBeGreaterThan(1);

    // Someone else answers now.
    vi.stubGlobal(
      "fetch",
      createWorld(
        {
          cname: TARGET,
          health: "other",
          certificate: { status: "active", ssl: "active" },
        },
        tag,
      ).fetchImpl,
    );
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.domainActions.sweepWorkingDomains,
        {},
      ),
    ).resolves.toEqual({ checked: 1, failed: 1, more: false });
    const failed = await readRow(fixture, domainId);
    expect(failed?.state).toBe("failed");
    expect(failed?.failure).toBe("host-taken");
    // The row keeps its history.
    expect(failed?.activatedAt).toBeTypeOf("number");
  });

  it("walks a long list of working domains to the end, once each", async () => {
    const fixture = await createReadySetupFixture("domain-sweep-page");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const revisionKey = await readLiveRevisionKey(fixture);
    // More domains than one page, every one of them checked at the same
    // moment, so the cursor has nothing but the row order to go on.
    const total = 25;
    await fixture.t.run(async (ctx) => {
      for (let index = 0; index < total; index += 1) {
        await ctx.db.insert("evidenceLibraryDomains", {
          libraryId: fixture.created.libraryId,
          host: `page-${index}.example.org`,
          verificationToken: "token",
          role: "redirect",
          state: "active",
          attachedAt: Date.now(),
          checkedAt: 1,
          createdByClerkUserId: fixture.clerkUserId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });

    vi.stubGlobal(
      "fetch",
      createWorld(
        {
          cname: TARGET,
          health: { revision: revisionKey },
          certificate: { status: "active", ssl: "active" },
          anyHost: true,
        },
        tag,
      ).fetchImpl,
    );

    // Run the sweep the way the scheduler would: page after page, following
    // the cursor it hands on.
    let cursor: Record<string, unknown> = {};
    let seen = 0;
    let pages = 0;
    for (; pages < 10; pages += 1) {
      const result: {
        checked: number;
        more: boolean;
        next?: Record<string, unknown>;
      } = await fixture.t.action(
        internal.evidenceLibraries.domainActions.sweepWorkingDomains,
        cursor as never,
      );
      seen += result.checked;
      if (!result.more || !result.next) break;
      cursor = result.next;
    }
    // Every domain was checked once, and the sweep ended rather than looping.
    expect(seen).toBe(total);
    expect(pages).toBeLessThan(10);
  });

  it("reaches the domains behind a page of ones that cannot answer", async () => {
    const fixture = await createReadySetupFixture("domain-sweep-unavailable");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const revisionKey = await readLiveRevisionKey(fixture);
    // More rows that cannot answer than one page holds, then one that can.
    await fixture.t.run(async (ctx) => {
      for (let index = 0; index < 55; index += 1) {
        await ctx.db.insert("evidenceLibraryDomains", {
          libraryId: fixture.created.libraryId,
          host: `quiet-${index}.example.org`,
          verificationToken: "token",
          role: "redirect",
          state: "active",
          attachedAt: Date.now(),
          checkedAt: 1,
          createdByClerkUserId: fixture.clerkUserId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      await ctx.db.insert("evidenceLibraryDomains", {
        libraryId: fixture.created.libraryId,
        host: CUSTOM_HOST,
        verificationToken: "token",
        role: "redirect",
        state: "active",
        attachedAt: Date.now(),
        checkedAt: 1,
        createdByClerkUserId: fixture.clerkUserId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Only the last one answers; the rest have no certificate, so they can
    // never be judged.
    vi.stubGlobal(
      "fetch",
      createWorld(
        {
          cname: TARGET,
          health: { revision: revisionKey },
          certificate: { status: "active", ssl: "active" },
        },
        tag,
      ).fetchImpl,
    );

    let cursor: Record<string, unknown> = {};
    let checked = 0;
    for (let page = 0; page < 10; page += 1) {
      const result: {
        checked: number;
        more: boolean;
        next?: Record<string, unknown>;
      } = await fixture.t.action(
        internal.evidenceLibraries.domainActions.sweepWorkingDomains,
        cursor as never,
      );
      checked += result.checked;
      if (!result.more || !result.next) break;
      cursor = result.next;
    }
    // The one that could answer was reached, behind fifty-five that could not.
    expect(checked).toBe(1);
  });

  it("never gives one sweep the same domain twice", async () => {
    const fixture = await createReadySetupFixture("domain-sweep-cutoff");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const cutoff = Date.now();
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("evidenceLibraryDomains", {
        libraryId: fixture.created.libraryId,
        host: "swept.example.org",
        verificationToken: "token",
        role: "redirect",
        state: "active",
        attachedAt: Date.now(),
        // Checked after the sweep started: this sweep has already done it.
        checkedAt: cutoff + 1_000,
        createdByClerkUserId: fixture.clerkUserId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await expect(
      fixture.t
        .query(internal.evidenceLibraries.domains.listWorkingDomains, {
          limit: 20,
          cutoff,
        })
        .then((page) => page.rows),
    ).resolves.toEqual([]);
  });

  it("deletes the library's domains with the library", async () => {
    const fixture = await createReadySetupFixture("domain_teardown");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");

    const requested = await fixture.admin.mutation(
      api.evidenceLibraries.teardown.requestDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        confirmationName: "Climate Evidence",
      },
    );
    // The teardown action needs services this test does not stand up, so the
    // record cleanup it drives is run directly, under a real claim.
    const attemptToken = "test-attempt";
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(requested.operationId, {
        status: "running",
        teardownLeaseExpiresAt: Date.now() + 60_000,
        teardownAttemptToken: attemptToken,
      });
    });
    let complete = false;
    for (let batch = 0; batch < 20 && !complete; batch += 1) {
      ({ complete } = await fixture.t.mutation(
        internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch,
        {
          libraryId: fixture.created.libraryId,
          operationId: requested.operationId,
          attemptToken,
        },
      ));
    }
    expect(complete).toBe(true);
    // A deleted library keeps no name reserved.
    await expect(readRow(fixture, added.domainId)).resolves.toBeNull();
  });

  it("hands the teardown every certificate it has to delete", async () => {
    const fixture = await createReadySetupFixture("domain_teardown_receipt");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(added.domainId, {
        state: "active",
        attachedAt: Date.now(),
        certificateHostnameId: "custom-hostname-1",
        updatedAt: Date.now(),
      });
    });
    const requested = await fixture.admin.mutation(
      api.evidenceLibraries.teardown.requestDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        confirmationName: "Climate Evidence",
      },
    );
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(requested.operationId, {
        status: "queued",
        teardownLeaseExpiresAt: undefined,
      });
    });
    const prepared = await fixture.t.mutation(
      internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        operationId: requested.operationId,
      },
    );
    if (!prepared.claimed) throw new Error("not claimed");
    // Both ways of finding the hostname travel to the action, so one whose
    // id was never written down is still deleted.
    expect(prepared.certificateHostnameIds).toEqual(["custom-hostname-1"]);
    expect(prepared.customDomainHosts).toEqual([CUSTOM_HOST]);
    expect(prepared.customDomains).toEqual([`https://${CUSTOM_HOST}`]);
  });

  it("refuses a teardown write from an attempt that no longer holds it", async () => {
    const fixture = await createReadySetupFixture("domain_teardown_fence");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const requested = await fixture.admin.mutation(
      api.evidenceLibraries.teardown.requestDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        confirmationName: "Climate Evidence",
      },
    );
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(requested.operationId, {
        status: "running",
        teardownLeaseExpiresAt: Date.now() + 60_000,
        teardownAttemptToken: "the-holder",
      });
    });
    // A worker that lost the teardown cannot delete its records.
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch,
        {
          libraryId: fixture.created.libraryId,
          operationId: requested.operationId,
          attemptToken: "the-replaced-one",
        },
      ),
    ).rejects.toThrow(/Another attempt is running/);
  });

  it("picks a teardown up again when the attempt that held it died", async () => {
    const fixture = await createReadySetupFixture("domain_teardown_lease");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const requested = await fixture.admin.mutation(
      api.evidenceLibraries.teardown.requestDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        confirmationName: "Climate Evidence",
      },
    );
    const first = await fixture.t.mutation(
      internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
      { libraryId: fixture.created.libraryId, operationId: requested.operationId },
    );
    expect(first.claimed).toBe(true);
    // A second attempt while the first still holds it walks away.
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
        { libraryId: fixture.created.libraryId, operationId: requested.operationId },
      ),
    ).resolves.toEqual({ claimed: false });
    // Once the claim has expired, the teardown can be finished by another.
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(requested.operationId, {
        teardownLeaseExpiresAt: Date.now() - 1,
      });
    });
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
        { libraryId: fixture.created.libraryId, operationId: requested.operationId },
      ),
    ).resolves.toMatchObject({ claimed: true });
  });
  it("keeps holding the domain while the deployment it started runs", async () => {
    const fixture = await createReadySetupFixture("domain-lease-held");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({ cname: TARGET }, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await markVerified(fixture, domainId);
    await fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
      libraryId: fixture.created.libraryId,
      domainId,
    });

    // The deployment holds the domain now, and it outlives the action that
    // started it: the lease clock is not the only thing that says "busy".
    const row = await readRow(fixture, domainId);
    expect(row?.transition).toBeDefined();
    expect(row?.pendingDeployment).toBeDefined();
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        transition: { ...row!.transition!, expiresAt: Date.now() - 1 },
      });
    });
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
        libraryId: fixture.created.libraryId,
        domainId,
      }),
    ).resolves.toEqual({ status: "busy" });
  });

  it("gives the domain back when its deployment fails", async () => {
    const fixture = await createReadySetupFixture("domain-lease-failed");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({ cname: TARGET }, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await markVerified(fixture, domainId);
    await fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
      libraryId: fixture.created.libraryId,
      domainId,
    });
    const operationId = await readPendingOperationId(fixture, domainId);
    const operation = await fixture.t.run(async (ctx) => ctx.db.get(operationId));

    await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .failConfigurationDeployment,
      {
        libraryId: fixture.created.libraryId,
        operationId,
        attemptToken: operation?.configurationAttemptToken ?? "",
        attemptCount: operation?.attemptCount ?? 1,
        error: { code: "TEST", message: "the deployment failed" },
      },
    );
    const row = await readRow(fixture, domainId);
    // Free again, so the owner can try instead of waiting a lease out, and
    // the change it still owes is remembered.
    expect(row?.transition).toBeUndefined();
    expect(row?.pendingDeployment).toBeDefined();
  });

  it("refuses to settle a deployment for a change that was overtaken", async () => {
    const fixture = await createReadySetupFixture("domain-lease-overtaken");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({ cname: TARGET }, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await markVerified(fixture, domainId);
    await fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
      libraryId: fixture.created.libraryId,
      domainId,
    });
    const operationId = await readPendingOperationId(fixture, domainId);

    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        transition: {
          kind: "remove",
          token: "someone-else",
          expiresAt: Date.now() + 60_000,
        },
      });
    });
    // Reporting success would leave the row claiming a change that never
    // landed, so the completion fails instead of passing over it.
    await expect(runDeploymentCompletion(fixture, operationId)).rejects.toThrow(
      /took that domain/,
    );
  });

  it("will not make a domain the library's address while it is being removed", async () => {
    const fixture = await createReadySetupFixture("domain-primary-removing");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(added.domainId, {
        state: "active",
        attachedAt: Date.now(),
        removingAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await expect(
      fixture.admin.mutation(api.evidenceLibraries.versions.setDomainPrimary, {
        libraryId: fixture.created.libraryId,
        domainId: added.domainId,
        primary: true,
      }),
    ).rejects.toThrow(/being removed/);
  });

  it("keeps the row when the certificate service cannot confirm the deletion", async () => {
    const fixture = await createReadySetupFixture("domain-remove-nocf");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(added.domainId, {
        certificateHostnameId: "custom-hostname-1",
        updatedAt: Date.now(),
      });
    });

    // The row is the only note that the hostname exists, so it stays until
    // the certificate service can say it is gone.
    vi.stubEnv("EL_CLOUDFLARE_API_TOKEN", "");
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.removeDomain, {
        libraryId: fixture.created.libraryId,
        domainId: added.domainId,
      }),
    ).rejects.toThrow();
    expect(await readRow(fixture, added.domainId)).not.toBeNull();
  });

  it("says nothing about a domain that changed under the sweep", async () => {
    const fixture = await createReadySetupFixture("domain-sweep-fenced");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        attachedAt: Date.now(),
        generation: 7,
        checkedAt: 1,
        updatedAt: Date.now(),
      });
    });

    // The sweep read one version of the domain; by the time it writes, the
    // domain has moved on, so its answer is out of date.
    await expect(
      fixture.t.mutation(internal.evidenceLibraries.domains.writeSweptDomain, {
        domainId,
        expectedGeneration: 6,
        state: "failed",
        failure: "host-taken",
      }),
    ).resolves.toEqual({ written: false });
    expect((await readRow(fixture, domainId))?.state).toBe("active");

    // The same answer about the domain it actually read does land.
    await expect(
      fixture.t.mutation(internal.evidenceLibraries.domains.writeSweptDomain, {
        domainId,
        expectedGeneration: 7,
        state: "failed",
        failure: "host-taken",
      }),
    ).resolves.toEqual({ written: true });
    expect((await readRow(fixture, domainId))?.state).toBe("failed");
  });

  it("leaves a domain alone while something else is changing it", async () => {
    const fixture = await createReadySetupFixture("domain-sweep-busy");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(added.domainId, {
        state: "active",
        attachedAt: Date.now(),
        checkedAt: 1,
        removingAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    vi.stubGlobal(
      "fetch",
      createWorld({ cname: TARGET, health: "other", anyHost: true }, tag).fetchImpl,
    );
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.domainActions.sweepWorkingDomains,
        {},
      ),
    ).resolves.toMatchObject({ checked: 0 });
    expect((await readRow(fixture, added.domainId))?.state).toBe("active");
  });
  it("holds a canonical change for as long as its deployment runs", async () => {
    const fixture = await createReadySetupFixture("domain-canonical-lease");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        attachedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await fixture.admin.mutation(
      api.evidenceLibraries.versions.setDomainPrimary,
      { libraryId: fixture.created.libraryId, domainId, primary: true },
    );
    // The deployment is recorded on the domain, exactly as attaching is, so
    // the two-minute lease is not what holds it.
    const row = await readRow(fixture, domainId);
    expect(row?.pendingDeployment?.phase).toBe("canonical");
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        transition: { ...row!.transition!, expiresAt: Date.now() - 1 },
      });
    });
    await expect(
      fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
        libraryId: fixture.created.libraryId,
        domainId,
      }),
    ).resolves.toEqual({ status: "busy" });
  });

  it("stops a worker that lost the domain before it writes anywhere else", async () => {
    const fixture = await createReadySetupFixture("domain-hold-lost");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(added.domainId, {
        transition: {
          kind: "check",
          token: "the-holder",
          expiresAt: Date.now() + 60_000,
        },
      });
    });
    // The proof every outside write is preceded by.
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.domains.holdDomainTransition,
        { domainId: added.domainId, token: "the-replaced-one" },
      ),
    ).rejects.toThrow(/Another change/);
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.domains.holdDomainTransition,
        { domainId: added.domainId, token: "the-holder" },
      ),
    ).resolves.toBeNull();
  });

  it("lets the sweep look at a domain whose worker died", async () => {
    const fixture = await createReadySetupFixture("domain-sweep-expired");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    const revisionKey = await readLiveRevisionKey(fixture);
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, {
        state: "active",
        attachedAt: Date.now(),
        checkedAt: 1,
        // A check whose worker died. Its lease has run out.
        transition: {
          kind: "check",
          token: "gone",
          expiresAt: Date.now() - 1,
        },
        updatedAt: Date.now(),
      });
    });

    vi.stubGlobal(
      "fetch",
      createWorld(
        {
          cname: TARGET,
          health: { revision: revisionKey },
          certificate: { status: "active", ssl: "active" },
        },
        tag,
      ).fetchImpl,
    );
    await expect(
      fixture.t.action(
        internal.evidenceLibraries.domainActions.sweepWorkingDomains,
        {},
      ),
    ).resolves.toMatchObject({ checked: 1 });
  });

  it("lets the library be taken back from a domain that stopped working", async () => {
    const fixture = await createReadySetupFixture("domain-primary-off");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    // The library's address, and it has stopped working.
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(added.domainId, {
        state: "failed",
        failure: "wrong-target",
        role: "primary",
        attachedAt: Date.now(),
        updatedAt: Date.now(),
      });
      const library = await ctx.db.get(fixture.created.libraryId);
      if (library?.runtimeBindingId) {
        await ctx.db.patch(library.runtimeBindingId, {
          canonicalBaseUrl: `https://${CUSTOM_HOST}`,
        });
      }
    });

    // Switching it off is exactly what an owner needs here, so it is allowed.
    await expect(
      fixture.admin.mutation(api.evidenceLibraries.versions.setDomainPrimary, {
        libraryId: fixture.created.libraryId,
        domainId: added.domainId,
        primary: false,
      }),
    ).resolves.toMatchObject({ address: `https://${PLATFORM_HOST}` });
  });

  it("marks a publish failed when its worker stops answering", async () => {
    const fixture = await createReadySetupFixture("domain-watchdog");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({ cname: TARGET }, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await markVerified(fixture, domainId);
    await fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
      libraryId: fixture.created.libraryId,
      domainId,
    });
    const operationId = await readPendingOperationId(fixture, domainId);
    const operation = await fixture.t.run(async (ctx) => ctx.db.get(operationId));

    // The worker died, so its lease ran out with nothing to show for it.
    const leaseExpiresAt = Date.now() - 1;
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(operationId, {
        configurationLeaseExpiresAt: leaseExpiresAt,
      });
    });
    // A watchdog booked for a deadline the work has since moved past does
    // nothing: only the last renewal's watchdog can act.
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.configurationDeployment
          .failExpiredConfigurationDeployment,
        {
          operationId,
          attemptToken: operation?.configurationAttemptToken ?? "",
          leaseExpiresAt: leaseExpiresAt - 1_000,
        },
      ),
    ).resolves.toBe("ignored");
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.configurationDeployment
          .failExpiredConfigurationDeployment,
        {
          operationId,
          attemptToken: operation?.configurationAttemptToken ?? "",
          leaseExpiresAt,
        },
      ),
    ).resolves.toBe("failed");
    // The owner can try again, and the domain is free.
    expect((await readRow(fixture, domainId))?.transition).toBeUndefined();
  });
  it("finishes a domain change that failed and was tried again", async () => {
    const fixture = await createReadySetupFixture("domain-retry-success");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({ cname: TARGET }, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await markVerified(fixture, domainId);
    await fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
      libraryId: fixture.created.libraryId,
      domainId,
    });
    const operationId = await readPendingOperationId(fixture, domainId);
    const first = await fixture.t.run(async (ctx) => ctx.db.get(operationId));

    // The publish fails, which gives the domain back.
    await fixture.t.mutation(
      internal.evidenceLibraries.configurationDeployment
        .failConfigurationDeployment,
      {
        libraryId: fixture.created.libraryId,
        operationId,
        attemptToken: first?.configurationAttemptToken ?? "",
        attemptCount: first?.attemptCount ?? 1,
        error: { code: "TEST", message: "the deployment failed" },
      },
    );
    expect((await readRow(fixture, domainId))?.transition).toBeUndefined();

    // Trying again takes the domain afresh and writes the new lease on the
    // operation, so the completion that follows is allowed to finish.
    await fixture.admin.mutation(
      api.evidenceLibraries.configurationDeployment.retryConfigurationDeployment,
      { libraryId: fixture.created.libraryId, operationId },
    );
    const retried = await fixture.t.run(async (ctx) => ctx.db.get(operationId));
    const row = await readRow(fixture, domainId);
    expect(retried?.domainChange?.token).toBe(row?.transition?.token);
    expect(row?.pendingDeployment?.operationId).toBe(operationId);

    await runDeploymentCompletion(fixture, operationId);
    // The change landed and the domain is free again.
    const settled = await readRow(fixture, domainId);
    expect(settled?.transition).toBeUndefined();
    expect(settled?.pendingDeployment).toBeUndefined();
  });

  it("refuses a completion for a domain that no longer knows about it", async () => {
    const fixture = await createReadySetupFixture("domain-settle-orphan");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({ cname: TARGET }, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    const domainId = added.domainId;
    await markVerified(fixture, domainId);
    await fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
      libraryId: fixture.created.libraryId,
      domainId,
    });
    const operationId = await readPendingOperationId(fixture, domainId);

    // The domain has forgotten this deployment. Passing over that would let
    // a stale worker change the library's address anyway.
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(domainId, { pendingDeployment: undefined });
    });
    await expect(runDeploymentCompletion(fixture, operationId)).rejects.toThrow(
      /took that domain/,
    );
  });

  it("notes that the proxy was asked before it answers", async () => {
    const fixture = await createReadySetupFixture("domain-attach-intent");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({ cname: TARGET }, tag).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    await markVerified(fixture, added.domainId);
    await fixture.admin.action(api.evidenceLibraries.domainActions.checkDomain, {
      libraryId: fixture.created.libraryId,
      domainId: added.domainId,
    });
    // A crash between the proxy accepting the host and the receipt being
    // saved is still visible here.
    expect((await readRow(fixture, added.domainId))?.attachIntentAt).toEqual(
      expect.any(Number),
    );
  });

  it("will not clean up a domain that is no longer being removed", async () => {
    const fixture = await createReadySetupFixture("domain-cleanup-stale");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    // The removal was called off, so nothing may delete its certificate.
    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.domains.claimDomainCleanup,
        { domainId: added.domainId },
      ),
    ).resolves.toBeNull();

    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(added.domainId, { removingAt: Date.now() });
    });
    const claimed = await fixture.t.mutation(
      internal.evidenceLibraries.domains.claimDomainCleanup,
      { domainId: added.domainId },
    );
    // It holds the domain from the moment it decides to act.
    expect(claimed?.token).toEqual(expect.any(String));
    expect((await readRow(fixture, added.domainId))?.transition?.token).toBe(
      claimed?.token,
    );
  });
});
