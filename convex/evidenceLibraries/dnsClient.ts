/**
 * DNS reading for custom domains, over DNS-over-HTTPS.
 *
 * Plan 11 banned DNS lookups for deciding whether a platform address is free,
 * because every name in our own wildcard zone resolves the same way. A
 * customer's own zone is the opposite case: the record the owner adds is
 * exactly the signal, so here DNS is the proof. See plan 16, decision 5.
 *
 * Two independent public resolvers are asked and must read the same thing. A
 * lookup that could not run throws `DnsLookupError`; nothing ever advances or
 * fails a domain on a single resolver's word.
 */

const RESOLVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
] as const;

const RECORD_TYPES = { A: 1, CNAME: 5, TXT: 16, CAA: 257 } as const;

export type DnsRecordType = keyof typeof RECORD_TYPES;

const LOOKUP_TIMEOUT_MS = 8_000;
const MAX_ANSWER_RECORDS = 64;
const MAX_ANSWER_BYTES = 64 * 1024;
const MAX_HOST_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
// A hostname label as the DNS "preferred name syntax" allows it: letters,
// digits and hyphens, never starting or ending with a hyphen. Underscores are
// legal in some record names but never in a name a browser can reach, so they
// are refused here.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
// The ending is a letter word, or the punycode form of an international one.
const TOP_LABEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/u;

/** Raised when a lookup could not run or the two resolvers disagreed. */
export class DnsLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DnsLookupError";
  }
}

/** What one resolver said about one name and record type. */
export type DnsAnswer = {
  /** False only for NXDOMAIN: the name itself is not in the zone. */
  exists: boolean;
  /** CNAME targets in the chain, lower-cased with the trailing dot removed. */
  cnames: string[];
  /** IPv4 and IPv6 addresses the chain ends in. */
  addresses: string[];
  /** TXT values with their quotes removed and their parts joined. */
  texts: string[];
  /** Lower-cased `issue` values from CAA records. */
  caaIssuers: string[];
};

/**
 * The name as DNS holds it: lower case, no trailing dot, ASCII only. An
 * international domain must be given in its punycode form, which every DNS
 * host shows.
 */
export function normaliseDomainHost(value: string): string {
  const host = value.trim().toLowerCase().replace(/\.$/u, "");
  if (!host || host.length > MAX_HOST_LENGTH) {
    throw new DnsLookupError("That does not look like a domain");
  }
  const labels = host.split(".");
  if (labels.length < 2) {
    throw new DnsLookupError("That does not look like a domain");
  }
  for (const label of labels) {
    if (label.length > MAX_LABEL_LENGTH || !LABEL.test(label)) {
      throw new DnsLookupError("That does not look like a domain");
    }
    // `ab--cd` is reserved; only `xn--` carries a punycode name.
    if (label.length > 3 && label[2] === "-" && label[3] === "-" && !label.startsWith("xn--")) {
      throw new DnsLookupError("That does not look like a domain");
    }
  }
  if (!TOP_LABEL.test(labels[labels.length - 1]!)) {
    throw new DnsLookupError("That does not look like a domain");
  }
  return host;
}

function normaliseRecordName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one resolver's JSON answer. Google returns names with a trailing dot
 * and Cloudflare does not, so every name is normalised before use.
 */
export function parseDohAnswer(payload: unknown): DnsAnswer {
  if (!isRecord(payload) || typeof payload.Status !== "number") {
    throw new DnsLookupError("The domain could not be checked");
  }
  // 3 is NXDOMAIN. Any other non-zero status is a resolver problem, not an
  // answer, so it never decides anything.
  if (payload.Status === 3) {
    return { exists: false, cnames: [], addresses: [], texts: [], caaIssuers: [] };
  }
  if (payload.Status !== 0) {
    throw new DnsLookupError("The domain could not be checked");
  }
  const records = payload.Answer;
  if (records !== undefined && !Array.isArray(records)) {
    throw new DnsLookupError("The domain could not be checked");
  }
  const answer: DnsAnswer = {
    exists: true,
    cnames: [],
    addresses: [],
    texts: [],
    caaIssuers: [],
  };
  if (!records) return answer;
  if (records.length > MAX_ANSWER_RECORDS) {
    throw new DnsLookupError("The domain could not be checked");
  }
  for (const record of records) {
    if (!isRecord(record) || typeof record.type !== "number") {
      throw new DnsLookupError("The domain could not be checked");
    }
    const data = record.data;
    if (typeof data !== "string") {
      throw new DnsLookupError("The domain could not be checked");
    }
    if (record.type === RECORD_TYPES.CNAME) {
      answer.cnames.push(normaliseRecordName(data));
    } else if (record.type === RECORD_TYPES.A || record.type === 28) {
      answer.addresses.push(data.trim().toLowerCase());
    } else if (record.type === RECORD_TYPES.TXT) {
      answer.texts.push(readTxtValue(data));
    } else if (record.type === RECORD_TYPES.CAA) {
      // An empty value is kept: `issue ";"` means nobody may issue.
      const issuer = readCaaIssuer(data);
      if (issuer !== null) answer.caaIssuers.push(issuer);
    }
  }
  return answer;
}

/** A TXT value arrives quoted and may be split into several parts. */
function readTxtValue(data: string): string {
  const parts = data.match(/"(?:[^"\\]|\\.)*"/gu);
  if (!parts) return data.trim();
  return parts.map((part) => part.slice(1, -1)).join("");
}

/**
 * CAA arrives as one string: flag, tag, then a quoted value. Only `issue`
 * decides whether a normal certificate can be issued; `issuewild` covers
 * wildcards, which we never ask for, and `iodef` is a contact address.
 */
function readCaaIssuer(data: string): string | null {
  const match = /^\s*\d+\s+([a-z]+)\s+"?([^";]*)/iu.exec(data);
  if (!match || match[1]!.toLowerCase() !== "issue") return null;
  return match[2]!.trim().toLowerCase();
}

/** How a host's address answer reads against our CNAME target. */
export type TargetReading =
  | "pointing"
  // The name itself is not in the zone (NXDOMAIN).
  | "no-name"
  // The name is there but carries no address record (NODATA).
  | "no-records"
  | "wrong-target";

/**
 * Two ways to pass. A visible CNAME to our target is the normal case for a
 * subdomain. An apex cannot carry a CNAME, so a host that resolves to an
 * address our target also answers with (CNAME flattening, ALIAS, ANAME)
 * passes too.
 */
export function classifyTarget(
  answer: DnsAnswer,
  input: { target: string; targetAddresses: readonly string[] },
): TargetReading {
  const target = normaliseRecordName(input.target);
  if (answer.cnames.includes(target)) return "pointing";
  if (!answer.exists) return "no-name";
  if (answer.addresses.length === 0) return "no-records";
  // A flattened apex has to answer with the target's whole address set. One
  // address in common proves nothing: a shared proxy hands the same anycast
  // addresses to everybody on it.
  const ours = new Set(input.targetAddresses.map((value) => value.toLowerCase()));
  const theirs = new Set(answer.addresses);
  if (
    ours.size > 0 &&
    ours.size === theirs.size &&
    [...theirs].every((address) => ours.has(address))
  ) {
    return "pointing";
  }
  return "wrong-target";
}

/** How the ownership record reads. */
export type TokenReading = "match" | "mismatch" | "missing";

export function classifyToken(answer: DnsAnswer, expected: string): TokenReading {
  if (!answer.exists || answer.texts.length === 0) return "missing";
  return answer.texts.includes(expected) ? "match" : "mismatch";
}

/**
 * The certificate authorities that may issue for a custom domain. Cloudflare
 * issues custom hostname certificates from Google Trust Services, Let's
 * Encrypt, SSL.com or Sectigo, and falls back between them, so any one of
 * these being permitted is enough.
 * https://developers.cloudflare.com/ssl/edge-certificates/caa-records/
 */
export const PERMITTED_CERTIFICATE_ISSUERS = [
  "pki.goog",
  "letsencrypt.org",
  "ssl.com",
  "sectigo.com",
  "digicert.com",
] as const;

/**
 * RFC 8659: the CAA record set is the one on the closest name that has any.
 * An empty set anywhere in the chain permits everyone, so only the first
 * name with issuers decides.
 */
export function classifyCaaChain(
  chain: readonly (readonly string[])[],
): "ok" | "blocked" {
  for (const issuers of chain) {
    if (issuers.length === 0) continue;
    const permitted = new Set<string>(PERMITTED_CERTIFICATE_ISSUERS);
    // An empty issuer value permits nobody, so it can never match.
    return issuers.some((issuer) => permitted.has(issuer)) ? "ok" : "blocked";
  }
  return "ok";
}

/**
 * Turns two resolver answers into one reading. A disagreement is not a
 * failure of the domain: it means we could not tell, so nothing moves.
 */
export function readAgreedAnswer<T, R>(
  answers: readonly T[],
  read: (answer: T) => R,
): R {
  const readings = answers.map(read);
  const first = readings[0];
  if (first === undefined || readings.some((reading) => reading !== first)) {
    throw new DnsLookupError("The domain could not be checked");
  }
  return first;
}

async function readResolver(
  fetchImpl: typeof fetch,
  resolver: string,
  host: string,
  type: DnsRecordType,
): Promise<DnsAnswer> {
  const url = new URL(resolver);
  url.searchParams.set("name", host);
  url.searchParams.set("type", type);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/dns-json" },
        signal: controller.signal,
      });
    } catch {
      throw new DnsLookupError("The domain could not be checked");
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new DnsLookupError("The domain could not be checked");
    }
    const body = await response.text();
    if (body.length > MAX_ANSWER_BYTES) {
      throw new DnsLookupError("The domain could not be checked");
    }
    try {
      return parseDohAnswer(JSON.parse(body));
    } catch (error) {
      if (error instanceof DnsLookupError) throw error;
      throw new DnsLookupError("The domain could not be checked");
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** One answer per resolver. Both must have answered before anything is read. */
export async function lookupHost(
  fetchImpl: typeof fetch,
  host: string,
  type: DnsRecordType,
): Promise<DnsAnswer[]> {
  return await Promise.all(
    RESOLVERS.map((resolver) => readResolver(fetchImpl, resolver, host, type)),
  );
}

/**
 * True when the host is one of the platform's own names, or sits beneath one.
 * Those names are ours to serve; nobody may claim them as a custom domain.
 */
export function isReservedPlatformHost(
  host: string,
  reservedSuffixes: readonly string[],
): boolean {
  return reservedSuffixes.some((suffix) => {
    const reserved = normaliseRecordName(suffix);
    return reserved !== "" && (host === reserved || host.endsWith(`.${reserved}`));
  });
}

/** Every name from the host up to its last two labels, closest first. */
export function caaScanNames(host: string): string[] {
  const labels = host.split(".");
  const names: string[] = [];
  for (let index = 0; index <= labels.length - 2; index += 1) {
    names.push(labels.slice(index).join("."));
  }
  return names;
}
