import { describe, expect, it, vi } from "vitest";
import {
  classifyCaaChain,
  isPublicInternetAddress,
  classifyTarget,
  classifyToken,
  DnsLookupError,
  lookupHost,
  normaliseDomainHost,
  parseDohAnswer,
  readAgreedAnswer,
} from "./dnsClient";

function dohResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/dns-json" },
    ...init,
  });
}

describe("normaliseDomainHost", () => {
  it("lowercases the name and drops a trailing dot", () => {
    expect(normaliseDomainHost(" Evidence.Example.ORG. ")).toBe(
      "evidence.example.org",
    );
  });

  it("refuses a name that is not a domain", () => {
    for (const value of [
      "",
      "example",
      "https://evidence.example.org",
      "evidence.example.org/library",
      "evidence..example.org",
      "-bad.example.org",
      "bad-.example.org",
      "evidence.example.org:8443",
      "biblioteca.ejemplo.españa",
      "*.example.org",
      // Underscores are legal in some record names but never in a hostname
      // a browser can reach.
      "_acme.example.org",
      "under_score.example.org",
      "192.0.2.10",
      `${"a".repeat(64)}.example.org`,
    ]) {
      expect(() => normaliseDomainHost(value)).toThrow(DnsLookupError);
    }
  });

  it("accepts the punycode form of an international domain and of its ending", () => {
    expect(normaliseDomainHost("xn--bcher-kva.example.org")).toBe(
      "xn--bcher-kva.example.org",
    );
    expect(normaliseDomainHost("evidence.example.xn--p1ai")).toBe(
      "evidence.example.xn--p1ai",
    );
  });
});

describe("parseDohAnswer", () => {
  it("reads the whole chain from one A answer", () => {
    const answer = parseDohAnswer({
      Status: 0,
      Answer: [
        { name: "evidence.example.org", type: 5, data: "cname.opendev.space." },
        { name: "cname.opendev.space", type: 1, data: "188.114.96.6" },
      ],
    });
    expect(answer.exists).toBe(true);
    expect(answer.cnames).toEqual(["cname.opendev.space"]);
    expect(answer.addresses).toEqual(["188.114.96.6"]);
  });

  it("tells a missing name apart from a missing record", () => {
    expect(parseDohAnswer({ Status: 3 })).toMatchObject({
      exists: false,
      addresses: [],
    });
    expect(parseDohAnswer({ Status: 0 })).toMatchObject({
      exists: true,
      addresses: [],
    });
  });

  it("strips the quotes and joins the parts of a TXT value", () => {
    const answer = parseDohAnswer({
      Status: 0,
      Answer: [
        { name: "_openscholar.evidence.example.org.", type: 16, data: '"os-verify=abc123"' },
        { name: "_openscholar.evidence.example.org.", type: 16, data: '"part-one" "part-two"' },
      ],
    });
    expect(answer.texts).toEqual(["os-verify=abc123", "part-onepart-two"]);
  });

  it("keeps an issue record that permits nobody", () => {
    const answer = parseDohAnswer({
      Status: 0,
      Answer: [{ name: "example.org", type: 257, data: '0 issue ";"' }],
    });
    expect(answer.caaIssuers).toEqual([""]);
  });

  it("reads the issuers out of CAA records and ignores other tags", () => {
    const answer = parseDohAnswer({
      Status: 0,
      Answer: [
        { name: "example.org", type: 257, data: '0 issue "digicert.com"' },
        { name: "example.org", type: 257, data: '0 issue "letsencrypt.org"' },
        { name: "example.org", type: 257, data: '0 iodef "mailto:a@example.org"' },
        { name: "example.org", type: 257, data: '0 issuewild "pki.goog"' },
      ],
    });
    expect(answer.caaIssuers).toEqual(["digicert.com", "letsencrypt.org"]);
  });

  it("refuses an answer that is not a DNS answer", () => {
    for (const payload of [null, "no", { Answer: [] }, { Status: 0, Answer: {} }]) {
      expect(() => parseDohAnswer(payload)).toThrow(DnsLookupError);
    }
  });
});

describe("classifyTarget", () => {
  const target = "cname.opendev.space";
  const targetAddresses = ["188.114.96.6", "188.114.97.6"];

  it("passes a CNAME chain that reaches the target", () => {
    expect(
      classifyTarget(
        { exists: true, cnames: ["cname.opendev.space"], addresses: ["188.114.96.6"], texts: [], caaIssuers: [] },
        { target, targetAddresses },
      ),
    ).toBe("pointing");
  });

  it("passes a flattened apex that answers with the target's whole address set", () => {
    expect(
      classifyTarget(
        {
          exists: true,
          cnames: [],
          addresses: ["188.114.97.6", "188.114.96.6"],
          texts: [],
          caaIssuers: [],
        },
        { target, targetAddresses },
      ),
    ).toBe("pointing");
  });

  it("refuses an apex that shares only one address with the target", () => {
    expect(
      classifyTarget(
        { exists: true, cnames: [], addresses: ["188.114.97.6"], texts: [], caaIssuers: [] },
        { target, targetAddresses },
      ),
    ).toBe("wrong-target");
  });

  it("tells a name that does not exist apart from one with no address", () => {
    expect(
      classifyTarget(
        { exists: false, cnames: [], addresses: [], texts: [], caaIssuers: [] },
        { target, targetAddresses },
      ),
    ).toBe("no-name");
  });

  it("reports a name with no address at all", () => {
    expect(
      classifyTarget(
        { exists: true, cnames: [], addresses: [], texts: [], caaIssuers: [] },
        { target, targetAddresses },
      ),
    ).toBe("no-records");
  });

  it("reports a name pointing somewhere else", () => {
    expect(
      classifyTarget(
        { exists: true, cnames: ["cname.other.example"], addresses: ["203.0.113.9"], texts: [], caaIssuers: [] },
        { target, targetAddresses },
      ),
    ).toBe("wrong-target");
  });
});

describe("classifyToken", () => {
  const answer = (texts: string[], exists = true) => ({
    exists,
    cnames: [],
    addresses: [],
    texts,
    caaIssuers: [],
  });

  it("matches the exact token", () => {
    expect(classifyToken(answer(["os-verify=abc123"]), "os-verify=abc123")).toBe("match");
  });

  it("reports a missing record and a wrong token apart", () => {
    expect(classifyToken(answer([], false), "os-verify=abc123")).toBe("missing");
    expect(classifyToken(answer([]), "os-verify=abc123")).toBe("missing");
    expect(classifyToken(answer(["os-verify=other"]), "os-verify=abc123")).toBe("mismatch");
  });
});

describe("classifyCaaChain", () => {
  it("passes when no name in the chain sets an issuer", () => {
    expect(classifyCaaChain([[], [], []])).toBe("ok");
  });

  it("passes when the closest name with issuers permits one of ours", () => {
    expect(classifyCaaChain([[], ["letsencrypt.org", "digicert.com"], []])).toBe("ok");
  });

  it("fails when the closest name with issuers permits none of ours", () => {
    expect(classifyCaaChain([[], ["amazon.com"], ["letsencrypt.org"]])).toBe("blocked");
  });

  it("fails when the domain permits nobody at all", () => {
    expect(classifyCaaChain([[""]])).toBe("blocked");
  });

  it("only reads the closest name that has issuers", () => {
    expect(classifyCaaChain([["ssl.com"], ["amazon.com"]])).toBe("ok");
  });
});

describe("isPublicInternetAddress", () => {
  it("accepts an ordinary public address", () => {
    for (const address of ["188.114.96.6", "8.8.8.8", "2606:4700::6810:85e5"]) {
      expect(isPublicInternetAddress(address)).toBe(true);
    }
  });

  it("refuses an address inside our own network", () => {
    for (const address of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.5.4",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "192.0.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "not-an-address",
    ]) {
      expect(isPublicInternetAddress(address)).toBe(false);
    }
  });
});

describe("lookupHost", () => {
  it("asks both resolvers and returns the agreed answer", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      seen.push(url.hostname);
      return dohResponse({
        Status: 0,
        Answer: [{ name: "evidence.example.org", type: 5, data: "cname.opendev.space." }],
      });
    }) as unknown as typeof fetch;
    const answers = await lookupHost(fetchImpl, "evidence.example.org", "A");
    expect(seen.sort()).toEqual(["cloudflare-dns.com", "dns.google"]);
    expect(answers).toHaveLength(2);
  });

  it("refuses to answer when a resolver fails", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("dns.google")) throw new Error("offline");
      return dohResponse({ Status: 0 });
    }) as unknown as typeof fetch;
    await expect(lookupHost(fetchImpl, "evidence.example.org", "A")).rejects.toThrow(
      DnsLookupError,
    );
  });

  it("refuses to answer when a resolver returns an error status", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("nope", { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(lookupHost(fetchImpl, "evidence.example.org", "A")).rejects.toThrow(
      DnsLookupError,
    );
  });
});

describe("readAgreedAnswer", () => {
  it("returns the reading when both resolvers read the same thing", () => {
    expect(readAgreedAnswer([1, 2], (value) => (value > 0 ? "yes" : "no"))).toBe("yes");
  });

  it("refuses when the two resolvers disagree", () => {
    expect(() => readAgreedAnswer([1, -1], (value) => (value > 0 ? "yes" : "no"))).toThrow(
      DnsLookupError,
    );
  });
});
