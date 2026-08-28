import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainEgressRefused, requirePublicDomainTarget } from "./domainEgress";

const TARGET = "cname.openscholar.test";
const TARGET_ADDRESSES = ["188.114.96.6", "188.114.97.6"];
const HOST = "evidence.example.org";

type World = {
  cname?: string;
  a?: string[];
  aaaa?: string[];
  offline?: boolean;
};

function createFetch(world: World): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (world.offline) throw new Error("offline");
    const url = new URL(String(input));
    const name = url.searchParams.get("name")!;
    const type = url.searchParams.get("type")!;
    if (name === TARGET) {
      return Response.json({
        Status: 0,
        Answer:
          type === "A"
            ? TARGET_ADDRESSES.map((data) => ({ name, type: 1, data }))
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

describe("requirePublicDomainTarget", () => {
  beforeEach(() => {
    vi.stubEnv("EL_CUSTOM_DOMAIN_TARGET", TARGET);
  });

  it("allows a domain that reaches us and answers public addresses", async () => {
    await expect(
      requirePublicDomainTarget({
        host: HOST,
        fetchImpl: createFetch({ cname: TARGET, a: TARGET_ADDRESSES }),
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a domain that answers an address inside our own network", async () => {
    await expect(
      requirePublicDomainTarget({
        host: HOST,
        fetchImpl: createFetch({ cname: TARGET, a: ["127.0.0.1"] }),
      }),
    ).rejects.toBeInstanceOf(DomainEgressRefused);
  });

  it("refuses a private address hidden in the second address family", async () => {
    await expect(
      requirePublicDomainTarget({
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
      requirePublicDomainTarget({
        host: HOST,
        fetchImpl: createFetch({ a: ["203.0.113.9"] }),
      }),
    ).rejects.toBeInstanceOf(DomainEgressRefused);
  });

  it("refuses when the domain could not be resolved at all", async () => {
    await expect(
      requirePublicDomainTarget({ host: HOST, fetchImpl: createFetch({ offline: true }) }),
    ).rejects.toBeInstanceOf(DomainEgressRefused);
  });
});
