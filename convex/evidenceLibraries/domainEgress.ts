/**
 * The gate every request to a customer's domain goes through.
 *
 * A custom domain's records belong to its owner, who can repoint them at any
 * moment. This module resolves the name, refuses anything that is not a
 * public internet address reached through our own CNAME target, and hands
 * back the exact addresses that passed. The Node half
 * (`domainEgressNode.ts`) then connects only to those addresses, so the name
 * cannot resolve to something else between the check and the request.
 */

import {
  classifyTarget,
  DnsLookupError,
  readsAsApex,
  isPublicInternetAddress,
  lookupHost,
  readAgreedAnswer,
  type DnsAnswer,
  type DnsRecordType,
} from "./dnsClient";
import {
  readCustomDomainApexIpv4,
  readCustomDomainTarget,
} from "./domainConfig";

/** The domain answered something we will not connect to. A real answer. */
export class DomainEgressRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainEgressRefused";
  }
}

/** The domain could not be read at all. Not an answer about the domain. */
export class DomainEgressUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainEgressUnavailable";
  }
}

/** The addresses of one family, as both resolvers agree on them. */
async function readFamily(
  fetchImpl: typeof fetch,
  host: string,
  type: Extract<DnsRecordType, "A" | "AAAA">,
): Promise<{ answers: DnsAnswer[]; addresses: string[] }> {
  const answers = await lookupHost(fetchImpl, host, type);
  const addresses = readAgreedAnswer(answers, (answer) =>
    answer.addresses.slice().sort().join(","),
  )
    .split(",")
    .filter(Boolean);
  return { answers, addresses };
}

/**
 * The addresses we will connect to for this host, or a refusal.
 *
 * Each address family is compared against the target's own answer for the
 * same family: a flattened apex on a dual-stack target answers IPv4 with the
 * target's IPv4 and IPv6 with its IPv6, never a mixture.
 */
export async function readSafeDomainAddresses(input: {
  host: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const target = readCustomDomainTarget();
  let a: { answers: DnsAnswer[]; addresses: string[] };
  let aaaa: { answers: DnsAnswer[]; addresses: string[] };
  let targetA: string[];
  let targetAaaa: string[];
  let isApex: boolean;
  try {
    const soa = lookupHost(fetchImpl, input.host, "SOA");
    [a, aaaa, targetA, targetAaaa, isApex] = await Promise.all([
      readFamily(fetchImpl, input.host, "A"),
      readFamily(fetchImpl, input.host, "AAAA"),
      readFamily(fetchImpl, target, "A").then((read) => read.addresses),
      readFamily(fetchImpl, target, "AAAA").then((read) => read.addresses),
      soa.then((answers) => readsAsApex(answers, input.host)),
    ]);
  } catch (error) {
    if (error instanceof DnsLookupError) {
      throw new DomainEgressUnavailable("That domain could not be read");
    }
    throw error;
  }

  // Every family that answers at all has to reach us. A correct address
  // record beside an unrelated one in the other family would otherwise put
  // that unrelated address on the list we connect to.
  const families = [
    { answers: a.answers, addresses: a.addresses, targetAddresses: targetA },
    {
      answers: aaaa.answers,
      addresses: aaaa.addresses,
      targetAddresses: targetAaaa,
    },
  ].filter((family) => family.addresses.length > 0);
  if (families.length === 0) {
    throw new DomainEgressRefused("That domain answers no address");
  }
  for (const family of families) {
    const reading = readAgreedAnswer(family.answers, (answer) =>
      classifyTarget(answer, {
        target,
        targetAddresses: family.targetAddresses,
        isApex,
        apexAddresses: isApex ? [readCustomDomainApexIpv4()] : [],
      }),
    );
    if (reading !== "pointing") {
      throw new DomainEgressRefused("That domain no longer points at us");
    }
  }

  const addresses = families.flatMap((family) => family.addresses);
  for (const address of addresses) {
    if (!isPublicInternetAddress(address)) {
      throw new DomainEgressRefused(
        "That domain answers an address that is not on the public internet",
      );
    }
  }
  return addresses;
}
