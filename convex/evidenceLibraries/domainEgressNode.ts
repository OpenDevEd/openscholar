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
 * opened on is checked before the request is written, not after the answer
 * comes back.
 *
 * It reaches one host and nothing else. Requests to the platform's own
 * names — the runtime verifier, a library's platform address — use ordinary
 * `fetch`: they are ours, and no customer can repoint them.
 */

import { Agent, request as httpsRequest } from "node:https";
import type { LookupAddress } from "node:dns";
import type { TLSSocket } from "node:tls";
import { DomainEgressRefused, readSafeDomainAddresses } from "./domainEgress";

const REQUEST_DEADLINE_MS = 15_000;
const MAX_BODY_BYTES = 256 * 1024;

function familyOf(address: string): 4 | 6 {
  return address.includes(":") ? 6 : 4;
}

/**
 * A `fetch` that reaches only these addresses, on only this host.
 */
export function createPinnedFetch(input: {
  host: string;
  addresses: readonly string[];
  /** Extra TLS options. Tests use it to trust a local certificate. */
  tlsOptions?: { ca?: string | string[] };
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
        callback(new DomainEgressRefused(`Refusing to resolve ${hostname}`), "", 4);
        return;
      }
      if (options.all) {
        (
          callback as unknown as (
            error: NodeJS.ErrnoException | null,
            addresses: LookupAddress[],
          ) => void
        )(null, wanted);
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
      let settled = false;
      const finish = (
        outcome: { ok: true; response: Response } | { ok: false; error: unknown },
      ) => {
        // Exactly once, whatever ends first: the answer, the deadline, the
        // caller giving up, or a socket that opened somewhere unexpected.
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        init?.signal?.removeEventListener("abort", onAbort);
        if (outcome.ok) resolve(outcome.response);
        else reject(outcome.error);
      };
      const onAbort = () => {
        clientRequest.destroy();
        finish({ ok: false, error: new Error("aborted") });
      };
      const deadline = setTimeout(() => {
        clientRequest.destroy();
        finish({ ok: false, error: new Error("timeout") });
      }, REQUEST_DEADLINE_MS);

      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      const clientRequest = httpsRequest({
        agent,
        host: input.host,
        // TLS is offered the real name, so the certificate still has to be
        // the customer's.
        servername: input.host,
        ...(input.tlsOptions ?? {}),
        headers: { ...headers, host: input.host },
        method: init?.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        port: url.port ? Number(url.port) : 443,
      });

      // Checked the moment the socket is up, before a single byte of the
      // request is written.
      clientRequest.on("socket", (socket) => {
        const check = () => {
          // Only the addresses handed to this client. Whether they are
          // fit to talk to at all was settled when the list was built, by
          // `readSafeDomainAddresses`.
          const remote = (socket as TLSSocket).remoteAddress ?? "";
          if (!allowed.has(remote)) {
            clientRequest.destroy();
            finish({
              ok: false,
              error: new DomainEgressRefused(
                "That domain opened on an address we did not check",
              ),
            });
          }
        };
        if ((socket as TLSSocket).connecting) socket.once("connect", check);
        else check();
      });

      clientRequest.on("response", (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > MAX_BODY_BYTES) {
            response.destroy();
            clientRequest.destroy();
            finish({
              ok: false,
              error: new DomainEgressRefused("That domain answered too much"),
            });
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          finish({
            ok: true,
            response: new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 0,
              headers: Object.entries(response.headers).flatMap(([key, value]) =>
                value === undefined
                  ? []
                  : [
                      [key, Array.isArray(value) ? value.join(", ") : value] as [
                        string,
                        string,
                      ],
                    ],
              ),
            }),
          });
        });
        response.on("error", (error) => finish({ ok: false, error }));
        response.on("close", () => {
          finish({ ok: false, error: new Error("the answer stopped early") });
        });
      });
      clientRequest.on("error", (error) => finish({ ok: false, error }));

      if (init?.signal) {
        if (init.signal.aborted) {
          onAbort();
          return;
        }
        init.signal.addEventListener("abort", onAbort, { once: true });
      }
      if (init?.body) clientRequest.write(init.body);
      clientRequest.end();
    });
  }) as typeof fetch;
}

/**
 * Checks the domain and returns a client that can only reach what passed.
 * Every request the platform makes to a customer's domain goes through one.
 */
export async function openPinnedDomainClient(input: {
  host: string;
  fetchImpl?: typeof fetch;
}): Promise<typeof fetch> {
  const addresses = await readSafeDomainAddresses(input);
  return createPinnedFetch({ host: input.host, addresses });
}
