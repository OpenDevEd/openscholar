/**
 * SSRF-safe PDF URL fetcher.
 *
 * Hardens outbound fetches against user-supplied URLs that target internal
 * infrastructure (cloud metadata endpoints, RFC1918, loopback, link-local),
 * protocol smuggling (http/file/gopher/data/ftp), and response-size
 * exhaustion.
 *
 * Residual risk: DNS rebinding. We reject literal private IPs in URL
 * hostnames and public DNS names that look suspicious (no dot, "localhost"),
 * but a public hostname that resolves to an internal IP at connect time
 * cannot be blocked here without a custom DNS resolver. For that, fronting
 * the fetch with an egress proxy that pins to public IPs is the belt-and-
 * suspenders fix.
 */

import { MAX_PDF_BYTES } from "../files/limits";

export const MAX_PDF_URL_LENGTH = 2048;
export const MAX_REDIRECTS = 5;
export const DEFAULT_TIMEOUT_MS = 30_000;

export class UnsafeUrlError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsafeUrlError";
  }
}

export interface SafeFetchPdfOptions {
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Propagated to the initial request and each redirect hop. */
  referer?: string;
}

export interface SafeFetchPdfResult {
  response: Response;
  body: Blob;
  finalUrl: string;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((s) => Number(s));
  if (
    parts.length !== 4 ||
    parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 — unspecified
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (includes 169.254.169.254 IMDS)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 reserved
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique-local
  if (lower.startsWith("ff")) return true; // multicast
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  // WHATWG URL parser normalises ::ffff:127.0.0.1 to ::ffff:7f00:1 (hex words).
  // Detect any mapped form where the final 32 bits decode to a private IPv4.
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
      const a = (hi >> 8) & 0xff;
      const b = hi & 0xff;
      const c = (lo >> 8) & 0xff;
      const d = lo & 0xff;
      return isPrivateIPv4(`${a}.${b}.${c}.${d}`);
    }
  }
  return false;
}

export function validatePdfUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new UnsafeUrlError("Empty URL");
  }
  if (raw.length > MAX_PDF_URL_LENGTH) {
    throw new UnsafeUrlError("URL exceeds maximum length");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new UnsafeUrlError("Only https URLs are permitted");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new UnsafeUrlError("URL credentials are not permitted");
  }
  const rawHost = parsed.hostname;
  const bare =
    rawHost.startsWith("[") && rawHost.endsWith("]")
      ? rawHost.slice(1, -1)
      : rawHost;
  if (bare.length === 0) {
    throw new UnsafeUrlError("URL host is empty");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bare)) {
    if (isPrivateIPv4(bare)) {
      throw new UnsafeUrlError("URL targets a private or reserved IP");
    }
  } else if (bare.includes(":")) {
    if (isPrivateIPv6(bare)) {
      throw new UnsafeUrlError("URL targets a private or reserved IPv6 address");
    }
  } else {
    if (bare === "localhost" || !bare.includes(".")) {
      throw new UnsafeUrlError("URL hostname is not a public DNS name");
    }
  }
  return parsed;
}

async function readCappedBody(
  response: Response,
  maxBytes: number,
): Promise<Blob> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new UnsafeUrlError(`Response body exceeds ${maxBytes} byte cap`);
    }
  }
  if (!response.body) {
    return new Blob([], {
      type: response.headers.get("content-type") ?? undefined,
    });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* best effort */
      }
      throw new UnsafeUrlError(`Response body exceeds ${maxBytes} byte cap`);
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], {
    type: response.headers.get("content-type") ?? undefined,
  });
}

/**
 * Fetch a PDF (or any document leading to one) from an untrusted URL with
 * SSRF protection, manual redirect validation, and a response-body size cap.
 * Does NOT retry; wrap in your own retry loop if needed.
 */
export async function safeFetchPdf(
  rawUrl: string,
  options: SafeFetchPdfOptions = {},
): Promise<SafeFetchPdfResult> {
  const maxBytes = options.maxBytes ?? MAX_PDF_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let currentUrl = validatePdfUrl(rawUrl).toString();
  const baseHeaders: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.referer) baseHeaders["Referer"] = options.referer;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetch(currentUrl, {
        method: "GET",
        headers: baseHeaders,
        redirect: "manual",
        signal: controller.signal,
      });

      if (
        response.status === 301 ||
        response.status === 302 ||
        response.status === 303 ||
        response.status === 307 ||
        response.status === 308
      ) {
        if (hop === MAX_REDIRECTS) {
          throw new UnsafeUrlError("Too many redirects");
        }
        const location = response.headers.get("location");
        if (!location) throw new UnsafeUrlError("Redirect without Location");
        const resolved = new URL(location, currentUrl).toString();
        currentUrl = validatePdfUrl(resolved).toString();
        continue;
      }

      if (!response.ok) {
        return { response, body: new Blob(), finalUrl: currentUrl };
      }
      const body = await readCappedBody(response, maxBytes);
      return { response, body, finalUrl: currentUrl };
    }
    throw new UnsafeUrlError("Too many redirects");
  } finally {
    clearTimeout(timer);
  }
}
