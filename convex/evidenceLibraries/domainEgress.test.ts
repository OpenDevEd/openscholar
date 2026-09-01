import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DomainEgressRefused,
  DomainEgressUnavailable,
  readSafeDomainAddresses,
} from "./domainEgress";

const TARGET = "cname.openscholar.test";
const TARGET_ADDRESSES = ["188.114.96.6", "188.114.97.6"];
const TARGET_V6 = ["2606:4700::6810:85e5"];
const HOST = "evidence.example.org";

type World = {
  cname?: string;
  a?: string[];
  aaaa?: string[];
  targetV6?: string[];
  /** The host owns its zone, so it can carry no alias. */
  apex?: boolean;
  offline?: boolean;
};

function createFetch(world: World): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (world.offline) throw new Error("offline");
    const url = new URL(String(input));
    const name = url.searchParams.get("name")!;
    const type = url.searchParams.get("type")!;
    if (name === TARGET) {
      const family = type === "A" ? TARGET_ADDRESSES : (world.targetV6 ?? []);
      return Response.json({
        Status: 0,
        Answer: family.map((data) => ({
          name,
          type: type === "A" ? 1 : 28,
          data,
        })),
      });
    }
    if (type === "SOA") {
      return Response.json({
        Status: 0,
        Answer: world.apex
          ? [{ name, type: 6, data: "ns1.example.org. hostmaster. 1 2 3 4 5" }]
          : [],
      });
    }
    const answer: unknown[] = [];
    if (type === "A") {
      if (world.cname) {
        answer.push({ name, type: 5, data: `${world.cname}.` });
      }
      for (const data of world.a ?? []) answer.push({ name, type: 1, data });
    } else {
      for (const data of world.aaaa ?? []) answer.push({ name, type: 28, data });
    }
    return Response.json(
      answer.length > 0 ? { Status: 0, Answer: answer } : { Status: 0 },
    );
  }) as unknown as typeof fetch;
}

describe("readSafeDomainAddresses", () => {
  beforeEach(() => {
    vi.stubEnv("EL_CUSTOM_DOMAIN_TARGET", TARGET);
    vi.stubEnv("EL_CUSTOM_DOMAIN_APEX_IPV4", "203.0.113.80");
  });

  it("returns the addresses a domain that reaches us answers with", async () => {
    await expect(
      readSafeDomainAddresses({
        host: HOST,
        fetchImpl: createFetch({ cname: TARGET, a: TARGET_ADDRESSES }),
      }),
    ).resolves.toEqual(TARGET_ADDRESSES);
  });

  it("compares each address family against the target's own family", async () => {
    // A flattened apex on a target that answers both families: IPv4 matches
    // the target's IPv4 and IPv6 matches its IPv6, never a mixture.
    await expect(
      readSafeDomainAddresses({
        host: HOST,
        fetchImpl: createFetch({
          a: TARGET_ADDRESSES,
          aaaa: TARGET_V6,
          targetV6: TARGET_V6,
          apex: true,
        }),
      }),
    ).resolves.toEqual([...TARGET_ADDRESSES, ...TARGET_V6]);
  });

  it("accepts the configured load-balancer address for an apex", async () => {
    await expect(
      readSafeDomainAddresses({
        host: HOST,
        fetchImpl: createFetch({ a: ["203.0.113.80"], apex: true }),
      }),
    ).resolves.toEqual(["203.0.113.80"]);
  });

  it("refuses a domain that answers an address inside our own network", async () => {
    await expect(
      readSafeDomainAddresses({
        host: HOST,
        fetchImpl: createFetch({ cname: TARGET, a: ["127.0.0.1"] }),
      }),
    ).rejects.toBeInstanceOf(DomainEgressRefused);
  });

  it("refuses an unrelated address in the second family", async () => {
    // A correct IPv4 record beside an IPv6 record pointing somewhere else
    // must not put that other address on the list we connect to.
    await expect(
      readSafeDomainAddresses({
        host: HOST,
        fetchImpl: createFetch({
          cname: TARGET,
          a: TARGET_ADDRESSES,
          aaaa: ["2001:db8::1"],
          targetV6: TARGET_V6,
        }),
      }),
    ).rejects.toBeInstanceOf(DomainEgressRefused);
  });

  it("refuses a private address hidden in the second address family", async () => {
    await expect(
      readSafeDomainAddresses({
        host: HOST,
        fetchImpl: createFetch({
          cname: TARGET,
          a: TARGET_ADDRESSES,
          // A loopback address written in hexadecimal inside IPv6.
          aaaa: ["::ffff:7f00:1"],
        }),
      }),
    ).rejects.toBeInstanceOf(DomainEgressRefused);
  });

  it("refuses a domain that no longer points at us", async () => {
    await expect(
      readSafeDomainAddresses({
        host: HOST,
        fetchImpl: createFetch({ a: ["203.0.113.9"] }),
      }),
    ).rejects.toBeInstanceOf(DomainEgressRefused);
  });

  it("says nothing about a domain it could not read at all", async () => {
    // A resolver that is down is not an answer about the domain, so it must
    // not read as "that domain is wrong".
    await expect(
      readSafeDomainAddresses({ host: HOST, fetchImpl: createFetch({ offline: true }) }),
    ).rejects.toBeInstanceOf(DomainEgressUnavailable);
  });
});
