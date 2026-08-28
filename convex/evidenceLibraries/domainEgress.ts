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
  isPublicInternetAddress,
  lookupHost,
  readAgreedAnswer,
  type DnsAnswer,
  type DnsRecordType,
} from "./dnsClient";
import { readCustomDomainTarget } from "./domainConfig";

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
  try {
    [a, aaaa, targetA, targetAaaa] = await Promise.all([
      readFamily(fetchImpl, input.host, "A"),
      readFamily(fetchImpl, input.host, "AAAA"),
      readFamily(fetchImpl, target, "A").then((read) => read.addresses),
      readFamily(fetchImpl, target, "AAAA").then((read) => read.addresses),
    ]);
  } catch (error) {
    if (error instanceof DnsLookupError) {
      throw new DomainEgressUnavailable("That domain could not be read");
    }
    throw error;
  }

  // The name still has to reach us. Either family may carry the proof.
  const reachesUs =
    readAgreedAnswer(a.answers, (answer) =>
      classifyTarget(answer, { target, targetAddresses: targetA }),
    ) === "pointing" ||
    (aaaa.addresses.length > 0 &&
      readAgreedAnswer(aaaa.answers, (answer) =>
        classifyTarget(answer, { target, targetAddresses: targetAaaa }),
      ) === "pointing");
  if (!reachesUs) {
    throw new DomainEgressRefused("That domain no longer points at us");
  }

  const addresses = [...a.addresses, ...aaaa.addresses];
  if (addresses.length === 0) {
    throw new DomainEgressRefused("That domain answers no address");
  }
  for (const address of addresses) {
    if (!isPublicInternetAddress(address)) {
      throw new DomainEgressRefused(
        "That domain answers an address that is not on the public internet",
      );
    }
  }
  return addresses;
}
