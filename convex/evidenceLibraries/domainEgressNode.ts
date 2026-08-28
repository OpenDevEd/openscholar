"use node";

/**
 * Connects to a customer's domain, and only to the addresses that were just
 * checked.
 *
 * Resolving the name and then calling `fetch` leaves a window: the socket
 * resolves the name again and may reach a different address. This client
 * closes it. Node's connector takes a `lookup` function, so the addresses
 * that passed the check are the only ones it can reach, while the hostname
 * is still what TLS and the `Host` header carry. The address the socket
 * actually connected to is checked again once the connection is open.
 */

import { Agent, request as httpsRequest } from "node:https";
import type { LookupAddress } from "node:dns";
import { isPublicInternetAddress } from "./dnsClient";
import { DomainEgressRefused, readSafeDomainAddresses } from "./domainEgress";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 256 * 1024;

function familyOf(address: string): 4 | 6 {
  return address.includes(":") ? 6 : 4;
}

/**
 * A `fetch` that reaches only these addresses. Anything else — a redirect to
 * another host, a socket that opened somewhere unexpected — is refused.
 */
export function createPinnedFetch(input: {
  host: string;
  addresses: readonly string[];
}): typeof fetch {
  const allowed = new Set(input.addresses);
  const agent = new Agent({
    keepAlive: false,
    lookup: (hostname, options, callback) => {
      // Only the checked addresses exist as far as this client is concerned.
      const matches = [...allowed].map<LookupAddress>((address) => ({
        address,
        family: familyOf(address),
      }));
      const wanted =
        options.family === 4 || options.family === 6
          ? matches.filter((entry) => entry.family === options.family)
          : matches;
      if (hostname !== input.host || wanted.length === 0) {
        callback(
          new DomainEgressRefused(`Refusing to resolve ${hostname}`),
          "",
          4,
        );
        return;
      }
      if (options.all) {
        (callback as unknown as (
          error: NodeJS.ErrnoException | null,
          addresses: LookupAddress[],
        ) => void)(null, wanted);
        return;
      }
      const first = wanted[0]!;
      callback(null, first.address, first.family);
    },
  });

  return (async (
    resource: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(resource));
    if (url.protocol !== "https:" || url.hostname !== input.host) {
      throw new DomainEgressRefused("Refusing to fetch another address");
    }
    return await new Promise<Response>((resolve, reject) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      const clientRequest = httpsRequest(
        {
          agent,
          host: input.host,
          // TLS is offered the real name, so the certificate still has to be
          // the customer's.
          servername: input.host,
          headers: { ...headers, host: input.host },
          method: init?.method ?? "GET",
          path: `${url.pathname}${url.search}`,
          port: url.port ? Number(url.port) : 443,
          timeout: REQUEST_TIMEOUT_MS,
        },
        (response) => {
          const remote = response.socket.remoteAddress ?? "";
          // The connection is open: check where it actually went.
          if (!allowed.has(remote) || !isPublicInternetAddress(remote)) {
            response.destroy();
            reject(
              new DomainEgressRefused(
                "That domain answered from an address we did not check",
              ),
            );
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes > MAX_BODY_BYTES) {
              response.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode ?? 0,
                headers: Object.entries(response.headers).flatMap(
                  ([key, value]) =>
                    value === undefined
                      ? []
                      : [[key, Array.isArray(value) ? value.join(", ") : value] as [
                          string,
                          string,
                        ]],
                ),
              }),
            );
          });
          response.on("error", reject);
        },
      );
      clientRequest.on("timeout", () => {
        clientRequest.destroy(new Error("timeout"));
      });
      clientRequest.on("error", reject);
      if (init?.body) clientRequest.write(init.body);
      clientRequest.end();
    });
  }) as typeof fetch;
}

/**
 * Checks the domain and returns a client that can only reach what passed.
 * Every request the platform makes to a customer's domain goes through one
 * of these.
 */
export async function openPinnedDomainClient(input: {
  host: string;
  fetchImpl?: typeof fetch;
}): Promise<typeof fetch> {
  const addresses = await readSafeDomainAddresses(input);
  return createPinnedFetch({ host: input.host, addresses });
}
