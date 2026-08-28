/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

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
  /** What the proxy already serves for this library. */
  serving?: string[];
};

function dnsAnswer(world: World, name: string, type: string, google: boolean) {
  const dot = google ? "." : "";
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
        return Response.json({
          success: true,
          result: world.certificate ? [hostname] : [],
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

    if (url.hostname === CUSTOM_HOST || url.hostname === "example.org") {
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

  it("passes a flattened apex that answers with the target's own addresses", async () => {
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
        checkLeaseUntil: Date.now() + 60_000,
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

    // Nothing answers yet: the deployment has not finished.
    await expect(
      check({ certificate: { status: "active", ssl: "active" } }),
    ).resolves.toMatchObject({ state: "verified" });
    // The certificate is not there yet.
    await expect(check({ health: { revision: revisionKey } })).resolves.toMatchObject({
      state: "verified",
      certificateState: "pending",
    });
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
    // verified. The platform must not fetch it.
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
    ).resolves.toEqual({ status: "check-failed" });
    expect(world.probedHosts).toEqual([]);
    expect((await readRow(fixture, domainId))?.state).toBe("active");
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

    // The deployment that applies the removal finishes.
    await fixture.t.action(
      internal.evidenceLibraries.domainActions.completeDomainChange,
      { libraryId: fixture.created.libraryId, domainId, reason: "detach" },
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

    await fixture.t.action(
      internal.evidenceLibraries.domainActions.completeDomainChange,
      {
        libraryId: fixture.created.libraryId,
        domainId,
        reason: "canonical",
        address: `https://${CUSTOM_HOST}`,
      },
    );
    listed = await fixture.admin.query(
      api.evidenceLibraries.domains.listDomains,
      { libraryId: fixture.created.libraryId },
    );
    // The platform address is never released: it keeps redirecting.
    expect(listed.platformAddress).toBe(`https://${PLATFORM_HOST}`);
    expect(listed.canonicalAddress).toBe(`https://${CUSTOM_HOST}`);
    expect(listed.domains[0]!.role).toBe("primary");
    expect(await readIdentityBaseUrl(fixture)).toBe(`https://${CUSTOM_HOST}`);

    await finishDeployment(fixture);
    const off = await fixture.admin.mutation(
      api.evidenceLibraries.versions.setDomainPrimary,
      { libraryId: fixture.created.libraryId, domainId, primary: false },
    );
    expect(off.address).toBe(`https://${PLATFORM_HOST}`);
    await fixture.t.action(
      internal.evidenceLibraries.domainActions.completeDomainChange,
      {
        libraryId: fixture.created.libraryId,
        domainId,
        reason: "canonical",
        address: `https://${PLATFORM_HOST}`,
      },
    );
    listed = await fixture.admin.query(
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
    const prepared = await fixture.t.mutation(
      internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        operationId: requested.operationId,
      },
    );
    expect(prepared.certificateHostnameIds).toEqual([]);
    let complete = false;
    for (let batch = 0; batch < 20 && !complete; batch += 1) {
      ({ complete } = await fixture.t.mutation(
        internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch,
        {
          libraryId: fixture.created.libraryId,
          operationId: requested.operationId,
        },
      ));
    }
    expect(complete).toBe(true);
    // A deleted library must not keep a name reserved.
    await expect(readRow(fixture, added.domainId)).resolves.toBeNull();
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

  it("walks a long list of working domains a page at a time", async () => {
    const fixture = await createReadySetupFixture("domain-sweep-page");
    const tag = await bindApplication(fixture);
    vi.stubGlobal("fetch", createWorld({}, tag).fetchImpl);
    // More working domains than one sweep checks.
    await fixture.t.run(async (ctx) => {
      for (let index = 0; index < 21; index += 1) {
        await ctx.db.insert("evidenceLibraryDomains", {
          libraryId: fixture.created.libraryId,
          host: `page-${index}.example.org`,
          verificationToken: "token",
          role: "redirect",
          state: "active",
          attachedAt: Date.now(),
          checkedAt: index + 1,
          createdByClerkUserId: fixture.clerkUserId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });

    // Every domain answers nothing, so each one is checked and fails.
    vi.stubGlobal("fetch", createWorld({ dnsOffline: true }, tag).fetchImpl);
    const first = await fixture.t.action(
      internal.evidenceLibraries.domainActions.sweepWorkingDomains,
      {},
    );
    // A page that is full hands the rest of the list to the next run rather
    // than checking the same rows for ever.
    expect(first.more).toBe(true);
  });

  it("deletes the library's domains with the library", async () => {
    const fixture = await createReadySetupFixture("domain_teardown");
    vi.stubGlobal("fetch", createWorld({}).fetchImpl);
    const added = await addDomain(fixture);
    if (added.status !== "added") throw new Error("not added");
    // A domain that reached the certificate service, so teardown has one to
    // remove.
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
    const prepared = await fixture.t.mutation(
      internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        operationId: requested.operationId,
      },
    );
    expect(prepared.certificateHostnameIds).toEqual(["custom-hostname-1"]);
    expect(prepared.customDomains).toEqual([`https://${CUSTOM_HOST}`]);
    let complete = false;
    for (let batch = 0; batch < 20 && !complete; batch += 1) {
      ({ complete } = await fixture.t.mutation(
        internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch,
        {
          libraryId: fixture.created.libraryId,
          operationId: requested.operationId,
        },
      ));
    }
    expect(complete).toBe(true);
    // A deleted library must not keep a name reserved.
    await expect(readRow(fixture, added.domainId)).resolves.toBeNull();
  });
});
