/**
 * The one gate every request to a customer's domain goes through.
 *
 * A custom domain's records belong to its owner, who can repoint them at any
 * moment. Every outbound request the platform makes to one of those names —
 * the health probe, the readiness checks, the sweep — resolves the name
 * again first and refuses anything that is not a public internet address
 * reached through our own CNAME target.
 *
 * The window between this check and the request itself cannot be closed with
 * `fetch`, which resolves the name again and offers SNI for it. Repeating the
 * check immediately before each request is the mitigation that is available,
 * and it is applied everywhere rather than once at verification time.
 */

import {
  classifyTarget,
  DnsLookupError,
  isPublicInternetAddress,
  lookupHost,
  readAgreedAnswer,
  type DnsAnswer,
} from "./dnsClient";
import { readCustomDomainTarget } from "./domainConfig";

/** Raised when a request to a customer's domain must not be made. */
export class DomainEgressRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainEgressRefused";
  }
}

function addressesOf(answers: readonly DnsAnswer[]): string[] {
  return answers.flatMap((answer) => answer.addresses);
}

/** Both address families of our CNAME target, as both resolvers see them. */
async function readTargetAddresses(
  fetchImpl: typeof fetch,
  target: string,
): Promise<string[]> {
  const [a, aaaa] = await Promise.all([
    lookupHost(fetchImpl, target, "A"),
    lookupHost(fetchImpl, target, "AAAA"),
  ]);
  return [
    ...readAgreedAnswer(a, (answer) => answer.addresses.slice().sort().join(",")),
    ...readAgreedAnswer(aaaa, (answer) => answer.addresses.slice().sort().join(",")),
  ]
    .join(",")
    .split(",")
    .filter(Boolean);
}

/**
 * Refuses unless the host still reaches our target and every address it
 * answers with, in both families, is on the public internet.
 */
export async function requirePublicDomainTarget(input: {
  host: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const target = readCustomDomainTarget();
  let addresses: string[];
  try {
    const targetAddresses = await readTargetAddresses(fetchImpl, target);
    const [a, aaaa] = await Promise.all([
      lookupHost(fetchImpl, input.host, "A"),
      lookupHost(fetchImpl, input.host, "AAAA"),
    ]);
    const reading = readAgreedAnswer(a, (answer) =>
      classifyTarget(answer, { target, targetAddresses }),
    );
    if (reading !== "pointing") {
      throw new DomainEgressRefused("That domain no longer points at us");
    }
    addresses = [...addressesOf(a), ...addressesOf(aaaa)];
  } catch (error) {
    if (error instanceof DomainEgressRefused) throw error;
    if (error instanceof DnsLookupError) {
      throw new DomainEgressRefused("That domain could not be resolved");
    }
    throw error;
  }
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
}

/**
 * The same gate, applied only to a name outside the platform's own domains.
 * A platform address is ours and is never repointed by a customer.
 */
export async function requireSafeRuntimeTarget(input: {
  targetBaseUrl: string;
  platformBaseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (input.targetBaseUrl === input.platformBaseUrl) return;
  await requirePublicDomainTarget({
    host: new URL(input.targetBaseUrl).hostname,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
}
