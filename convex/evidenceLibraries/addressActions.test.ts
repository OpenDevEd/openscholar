/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { isFreeHostSignal } from "./addressActions";

const modules = import.meta.glob("/convex/**/*.ts");

const PLATFORM_DOMAIN = "libraries.example.test";
const CLIMATE_HOST = `climate-evidence-lib.${PLATFORM_DOMAIN}`;
const CLIMATE_ADDRESS = `https://${CLIMATE_HOST}`;
const SECOND_CLIMATE_ADDRESS = `https://climate-evidence-2-lib.${PLATFORM_DOMAIN}`;

type FakeWorld = {
  // Hosts Coolify already serves.
  coolifyHosts: string[];
  // Hosts that answer an HTTP request themselves.
  servedHosts: string[];
  coolifyFails?: boolean;
  probeFails?: boolean;
  // Counted by the fake so a test can prove the list was reused.
  coolifyRequests?: number;
};

function createFetch(world: FakeWorld): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "coolify.example.test") {
      world.coolifyRequests = (world.coolifyRequests ?? 0) + 1;
      if (world.coolifyFails) throw new Error("coolify offline");
      if (url.pathname === "/api/v1/applications") {
        return Response.json(
          world.coolifyHosts.map((host) => ({ fqdn: `https://${host}` })),
        );
      }
      if (url.pathname === "/api/v1/services") return Response.json([]);
      throw new Error(`unexpected Coolify path ${url.pathname}`);
    }
    if (world.probeFails) throw new Error("host unreachable");
    if (world.servedHosts.includes(url.hostname)) {
      return new Response("<html>a website</html>", { status: 200 });
    }
    return new Response("no available server\n", { status: 503 });
  }) as unknown as typeof fetch;
}

async function seedOwner(
  t: ReturnType<typeof convexTest>,
  suffix: string,
) {
  await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId: `org_${suffix}`,
      name: `Team ${suffix}`,
      slug: `team-${suffix}`,
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      clerkMembershipId: `orgmem_${suffix}`,
      clerkUserId: `user_${suffix}`,
      role: "org:admin",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  return t.withIdentity({
    subject: `user_${suffix}`,
    o: { id: `org_${suffix}`, rol: "org:admin" },
  });
}

async function createWorld(world: FakeWorld) {
  vi.stubGlobal("fetch", createFetch(world));
  const t = convexTest(schema, modules);
  return { t, world, owner: await seedOwner(t, "address") };
}

describe("free host signal", () => {
  it("only reads our proxy's own 503 as a free host", () => {
    expect(isFreeHostSignal(503, "no available server\n")).toBe(true);
    expect(isFreeHostSignal(503, "  No available server")).toBe(true);
    expect(isFreeHostSignal(503, "service temporarily unavailable")).toBe(false);
    expect(isFreeHostSignal(200, "no available server")).toBe(false);
    expect(isFreeHostSignal(307, "")).toBe(false);
    expect(isFreeHostSignal(404, "")).toBe(false);
  });
});

describe("Evidence Library address reservation", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", PLATFORM_DOMAIN);
    vi.stubEnv("EL_COOLIFY_URL", "https://coolify.example.test");
    vi.stubEnv("EL_COOLIFY_TOKEN", "coolify-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("gives a free name the address that matches it", async () => {
    const { owner } = await createWorld({ coolifyHosts: [], servedHosts: [] });

    await expect(
      owner.action(api.evidenceLibraries.addressActions.checkAddress, {
        name: "Climate Evidence",
      }),
    ).resolves.toEqual({
      status: "available",
      name: "Climate Evidence",
      shortName: "Climate Evidence",
      slug: "climate-evidence",
      publicAddress: CLIMATE_ADDRESS,
    });

    const reserved = await owner.action(
      api.evidenceLibraries.addressActions.reserveAddress,
      { name: "Climate Evidence" },
    );
    expect(reserved).toMatchObject({
      status: "reserved",
      name: "Climate Evidence",
      publicAddress: CLIMATE_ADDRESS,
      slug: "climate-evidence",
    });
  });

  it("refuses a second library with the same name and points at the first", async () => {
    const { t, owner } = await createWorld({
      coolifyHosts: [],
      servedHosts: [],
    });
    const first = await owner.action(
      api.evidenceLibraries.addressActions.reserveAddress,
      { name: "Climate Evidence" },
    );
    if (first.status !== "reserved") throw new Error("first not reserved");

    await expect(
      owner.action(api.evidenceLibraries.addressActions.checkAddress, {
        name: " Climate   Evidence ",
      }),
    ).resolves.toEqual({
      status: "name-taken",
      libraryId: first.libraryId,
    });
    await expect(
      owner.action(api.evidenceLibraries.addressActions.reserveAddress, {
        name: "Climate Evidence",
      }),
    ).resolves.toEqual({ status: "name-taken", libraryId: first.libraryId });
    expect(
      await t.run((ctx) => ctx.db.query("evidenceLibraries").collect()),
    ).toHaveLength(1);
  });

  it("numbers the address when our database already holds it", async () => {
    const { t, owner } = await createWorld({
      coolifyHosts: [],
      servedHosts: [],
    });
    const otherOwner = await seedOwner(t, "address_other");
    await otherOwner.action(
      api.evidenceLibraries.addressActions.reserveAddress,
      { name: "Climate Evidence" },
    );

    await expect(
      owner.action(api.evidenceLibraries.addressActions.checkAddress, {
        name: "Climate Evidence",
      }),
    ).resolves.toMatchObject({
      status: "available",
      slug: "climate-evidence-2",
      publicAddress: SECOND_CLIMATE_ADDRESS,
    });
  });

  it("numbers the address when Coolify already serves the host", async () => {
    const { owner } = await createWorld({
      coolifyHosts: [CLIMATE_HOST],
      servedHosts: [],
    });

    await expect(
      owner.action(api.evidenceLibraries.addressActions.checkAddress, {
        name: "Climate Evidence",
      }),
    ).resolves.toMatchObject({
      status: "available",
      publicAddress: SECOND_CLIMATE_ADDRESS,
    });
  });

  it("numbers the address when something answers on the host", async () => {
    const { owner } = await createWorld({
      coolifyHosts: [],
      servedHosts: [CLIMATE_HOST],
    });

    await expect(
      owner.action(api.evidenceLibraries.addressActions.checkAddress, {
        name: "Climate Evidence",
      }),
    ).resolves.toMatchObject({
      status: "available",
      publicAddress: SECOND_CLIMATE_ADDRESS,
    });
  });

  it("reserves nothing when Coolify cannot be asked", async () => {
    const { t, owner } = await createWorld({
      coolifyHosts: [],
      servedHosts: [],
      coolifyFails: true,
    });

    await expect(
      owner.action(api.evidenceLibraries.addressActions.checkAddress, {
        name: "Climate Evidence",
      }),
    ).resolves.toEqual({ status: "unavailable", reason: "check-failed" });
    await expect(
      owner.action(api.evidenceLibraries.addressActions.reserveAddress, {
        name: "Climate Evidence",
      }),
    ).resolves.toEqual({ status: "unavailable", reason: "check-failed" });
    expect(
      await t.run((ctx) => ctx.db.query("evidenceLibraries").collect()),
    ).toHaveLength(0);
  });

  it("reserves nothing when the host cannot be reached", async () => {
    const { t, owner } = await createWorld({
      coolifyHosts: [],
      servedHosts: [],
      probeFails: true,
    });

    await expect(
      owner.action(api.evidenceLibraries.addressActions.reserveAddress, {
        name: "Climate Evidence",
      }),
    ).resolves.toEqual({ status: "unavailable", reason: "check-failed" });
    expect(
      await t.run((ctx) => ctx.db.query("evidenceLibraries").collect()),
    ).toHaveLength(0);
  });

  it("refuses a name that is too long", async () => {
    const { owner } = await createWorld({ coolifyHosts: [], servedHosts: [] });

    await expect(
      owner.action(api.evidenceLibraries.addressActions.checkAddress, {
        name: "a".repeat(101),
      }),
    ).rejects.toThrow(/VALIDATION_ERROR/);
  });

  it("only an owner of the organisation may check or reserve", async () => {
    const { t } = await createWorld({ coolifyHosts: [], servedHosts: [] });
    await t.run(async (ctx) => {
      const organization = await ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", "org_address"),
        )
        .unique();
      if (!organization) throw new Error("missing organization");
      await ctx.db.insert("organizationMemberships", {
        organizationId: organization._id,
        clerkMembershipId: "orgmem_address_member",
        clerkUserId: "user_address_member",
        role: "org:member",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const member = t.withIdentity({
      subject: "user_address_member",
      o: { id: "org_address", rol: "org:member" },
    });

    await expect(
      member.action(api.evidenceLibraries.addressActions.checkAddress, {
        name: "Climate Evidence",
      }),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      member.action(api.evidenceLibraries.addressActions.reserveAddress, {
        name: "Climate Evidence",
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });


  it("asks Coolify once for a burst of checks and the reservation that follows", async () => {
    const { owner, world } = await createWorld({
      coolifyHosts: [],
      servedHosts: [],
    });

    await owner.action(api.evidenceLibraries.addressActions.checkAddress, {
      name: "Climate Evidence",
    });
    await owner.action(api.evidenceLibraries.addressActions.checkAddress, {
      name: "Climate Evidenc",
    });
    await owner.action(api.evidenceLibraries.addressActions.reserveAddress, {
      name: "Climate Evidence",
    });

    // Two reads for one listing: applications and services.
    expect(world.coolifyRequests).toBe(2);
  });

  it("refuses to reserve when the served hosts are stale and Coolify is silent", async () => {
    const { t, owner } = await createWorld({
      coolifyHosts: [],
      servedHosts: [],
    });
    await owner.action(api.evidenceLibraries.addressActions.checkAddress, {
      name: "Climate Evidence",
    });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("evidenceLibraryServedHosts").unique();
      if (!row) throw new Error("no served hosts were kept");
      await ctx.db.patch("evidenceLibraryServedHosts", row._id, {
        fetchedAt: Date.now() - 61_000,
      });
    });
    vi.stubGlobal(
      "fetch",
      createFetch({ coolifyHosts: [], servedHosts: [], coolifyFails: true }),
    );

    await expect(
      owner.action(api.evidenceLibraries.addressActions.reserveAddress, {
        name: "Climate Evidence",
      }),
    ).resolves.toEqual({ status: "unavailable", reason: "check-failed" });
    expect(
      await t.run((ctx) => ctx.db.query("evidenceLibraries").collect()),
    ).toHaveLength(0);
  });

  it("says so when the address was taken between the check and the write", async () => {
    const { t, owner } = await createWorld({
      coolifyHosts: [],
      servedHosts: [],
    });
    const otherOwner = await seedOwner(t, "address_racer");
    await otherOwner.mutation(
      internal.evidenceLibraries.mutations.reserveAddress,
      {
        name: "Coastal Evidence",
        publicAddress: CLIMATE_ADDRESS,
        slug: "climate-evidence",
      },
    );
    // The check ran before that write, so it still offers the first address.
    await expect(
      owner.mutation(internal.evidenceLibraries.mutations.reserveAddress, {
        name: "Climate Evidence",
        publicAddress: CLIMATE_ADDRESS,
        slug: "climate-evidence",
      }),
    ).resolves.toEqual({ status: "address-taken" });
    expect(
      await t.run((ctx) => ctx.db.query("evidenceLibraries").collect()),
    ).toHaveLength(1);
  });

});
