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

const RECORD_TYPES = {
  A: 1,
  AAAA: 28,
  CNAME: 5,
  SOA: 6,
  TXT: 16,
  CAA: 257,
} as const;

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
  /** Names that answered with a start-of-authority record, lower-cased. */
  soaOwners: string[];
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
    return {
      exists: false,
      cnames: [],
      addresses: [],
      texts: [],
      caaIssuers: [],
      soaOwners: [],
    };
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
    soaOwners: [],
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
    const name =
      typeof record.name === "string" ? record.name : "";
    if (typeof data !== "string") {
      throw new DnsLookupError("The domain could not be checked");
    }
    if (record.type === RECORD_TYPES.CNAME) {
      answer.cnames.push(normaliseRecordName(data));
    } else if (
      record.type === RECORD_TYPES.A ||
      record.type === RECORD_TYPES.AAAA
    ) {
      answer.addresses.push(data.trim().toLowerCase());
    } else if (record.type === RECORD_TYPES.TXT) {
      answer.texts.push(readTxtValue(data));
    } else if (record.type === RECORD_TYPES.SOA) {
      // A resolver often answers with the SOA of a *parent* zone when the
      // name itself has none. Only the owner tells the two apart.
      answer.soaOwners.push(normaliseRecordName(name));
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
  input: {
    target: string;
    targetAddresses: readonly string[];
    /** Explicit public load-balancer addresses shown in apex instructions. */
    apexAddresses?: readonly string[];
    /**
     * Whether the name is the top of its own zone. Only such a name may
     * pass on matching addresses alone: it cannot carry the alias we ask
     * for. Anywhere else the alias is the proof, and matching addresses
     * would let a plain subdomain skip it.
     */
    isApex?: boolean;
  },
): TargetReading {
  const target = normaliseRecordName(input.target);
  if (answer.cnames.includes(target)) return "pointing";
  if (!answer.exists) return "no-name";
  if (answer.addresses.length === 0) return "no-records";
  // Only the top of a zone may pass on addresses alone.
  if (input.isApex !== true) return "wrong-target";
  const theirs = new Set(answer.addresses);
  // The apex may use the explicit public load-balancer address we show, or
  // flatten our CNAME target. Either way the whole answer set must match;
  // one shared address proves nothing.
  for (const expected of [
    input.apexAddresses ?? [],
    input.targetAddresses,
  ]) {
    const ours = new Set(expected.map((value) => value.toLowerCase()));
    if (
      ours.size > 0 &&
      ours.size === theirs.size &&
      [...theirs].every((address) => ours.has(address))
    ) {
      return "pointing";
    }
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
 * Traefik's configured resolver uses Let's Encrypt, so an existing CAA set
 * must permit that authority. An empty CAA set still permits every issuer.
 */
export const PERMITTED_CERTIFICATE_ISSUERS = ["letsencrypt.org"] as const;

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
 * The certificate issuers both resolvers agree on. Kept as an array: joining
 * them into one string loses an issuer that permits nobody, which is written
 * as an empty value and has to block issuance.
 */
export function readAgreedIssuers(answers: readonly DnsAnswer[]): string[] {
  const readings = answers.map((answer) => answer.caaIssuers.slice().sort());
  const first = readings[0];
  if (
    !first ||
    readings.some(
      (reading) =>
        reading.length !== first.length ||
        reading.some((issuer, index) => issuer !== first[index]),
    )
  ) {
    throw new DnsLookupError("The domain could not be checked");
  }
  return first;
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

function readIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

/**
 * True only for an address on the public internet.
 *
 * A custom domain's records belong to its owner, who can repoint them at any
 * moment. Without this check an owner could verify a domain, point it at an
 * address inside our own network, and have the platform fetch it for them.
 * Everything private, reserved or local is refused.
 */
export function isPublicInternetAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (!value) return false;
  if (!value.includes(":")) return isPublicIpv4(value);

  if (!/^[0-9a-f:.]+$/u.test(value)) return false;
  const groups = expandIpv6(value);
  if (!groups) return false;
  // An IPv4 address carried inside IPv6 is judged as IPv4, however it is
  // written: dotted (`::ffff:127.0.0.1`), hexadecimal (`::ffff:7f00:1`), or
  // through the NAT64 prefix (`64:ff9b::7f00:1`).
  const mappedIpv4 = readEmbeddedIpv4(groups);
  if (mappedIpv4) return isPublicIpv4(mappedIpv4);
  if (groups.every((group) => group === 0)) return false; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return false; // ::1
  }
  const first = groups[0]!;
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (first === 0x0064 && groups[1] === 0xff9b) return false; // 64:ff9b::/96
  if (first === 0x2002) return false; // 6to4, carries an embedded IPv4
  if (first === 0x0100 && groups[1] === 0) return false; // 100::/64 discard
  return true;
}

function isPublicIpv4(value: string): boolean {
  const bytes = readIpv4(value);
  if (!bytes) return false;
  const [a, b] = bytes as [number, number, number, number];
  if (a === 0 || a === 127 || a >= 224) return false; // this host, loopback, multicast and beyond
  if (a === 10) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false; // link local, including metadata
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 192 && b === 0) return false; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  return true;
}

/** The eight groups of an IPv6 address, or null when it is not one. */
function expandIpv6(value: string): number[] | null {
  let text = value;
  // A trailing dotted quad becomes two groups.
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(text);
  if (dotted) {
    const bytes = readIpv4(dotted[1]!);
    if (!bytes) return null;
    const high = (bytes[0]! << 8) | bytes[1]!;
    const low = (bytes[2]! << 8) | bytes[3]!;
    text = `${text.slice(0, dotted.index)}${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const read = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const piece of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/u.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
    return groups;
  };
  const head = read(halves[0]!);
  const tail = halves.length === 2 ? read(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

/** The IPv4 address an IPv6 address carries, if it carries one. */
function readEmbeddedIpv4(groups: number[]): string | null {
  const toDotted = (high: number, low: number) =>
    `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  const leading = groups.slice(0, 5).every((group) => group === 0);
  // ::ffff:a.b.c.d and ::a.b.c.d
  if (leading && (groups[5] === 0xffff || groups[5] === 0)) {
    if (groups[6] === 0 && groups[7] === 0) return null;
    return toDotted(groups[6]!, groups[7]!);
  }
  // 64:ff9b::a.b.c.d
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) {
    return toDotted(groups[6]!, groups[7]!);
  }
  // 2002:a.b.c.d::
  if (groups[0] === 0x2002) return toDotted(groups[1]!, groups[2]!);
  return null;
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

/**
 * True when the name is a zone of its own, which is what "a bare domain"
 * means: a zone's own name carries its SOA record. Asking DNS is right where
 * counting labels is not — `example.co.uk` is a bare domain and
 * `library.example.org` is not, and no list of endings can say so.
 */
export function readsAsApex(
  answers: readonly DnsAnswer[],
  host: string,
): boolean {
  const owned = normaliseRecordName(host);
  return readAgreedAnswer(answers, (answer) =>
    answer.soaOwners.includes(owned),
  );
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
