// Clerk's Backend API for OAuth applications and the instance's domain, kept
// in memory. Every other request goes to the fetch it wraps.

export type FakeClerkApplication = {
  id: string;
  name: string;
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  discovery_url: string;
};

const CLERK_PREFIX = "https://api.clerk.com/v1/oauth_applications";
const DOMAINS_URL = "https://api.clerk.com/v1/domains";
const DISCOVERY_URL = "https://clerk.example.test/.well-known/openid-configuration";
export const FAKE_CLERK_ISSUER = "https://clerk.example.test";
export const FAKE_CLERK_ACCOUNT_URL = "https://accounts.example.test/user";

export function createFakeClerkOAuth() {
  const applications = new Map<string, FakeClerkApplication>();
  const writes: { method: string; path: string }[] = [];
  let sequence = 0;
  /** Answers the next matching request instead of the fake, once. */
  let interrupt: ((method: string, path: string) => Response | null) | null = null;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const notFound = () =>
    json(404, { errors: [{ code: "resource_not_found", message: "not found" }], clerk_trace_id: "trace-404" });
  const publicShape = ({ client_secret: _secret, ...application }: FakeClerkApplication) => application;

  async function answer(url: URL, method: string, body: unknown): Promise<Response> {
    const path = url.pathname.replace("/v1/oauth_applications", "");
    if (method !== "GET") writes.push({ method, path: path || "/" });
    if (interrupt) {
      const response = interrupt(method, path);
      if (response) {
        interrupt = null;
        return response;
      }
    }
    const [, id, action] = path.split("/");
    if (method === "GET" && !id) {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 10);
      const all = [...applications.values()];
      return json(200, { data: all.slice(offset, offset + limit).map(publicShape), total_count: all.length });
    }
    if (method === "POST" && !id) {
      const input = body as { name: string; redirect_uris: string[] };
      sequence += 1;
      const application = {
        id: `oa_${sequence}`,
        name: input.name,
        client_id: `client_${sequence}`,
        client_secret: `fake_clerk_secret_${sequence}_0`,
        redirect_uris: input.redirect_uris,
        discovery_url: DISCOVERY_URL,
      };
      applications.set(application.id, application);
      return json(200, application);
    }
    const application = id ? applications.get(id) : undefined;
    if (!application) return notFound();
    if (method === "GET" && !action) return json(200, publicShape(application));
    if (method === "POST" && action === "rotate_secret") {
      sequence += 1;
      application.client_secret = `fake_clerk_secret_${application.id}_${sequence}`;
      return json(200, application);
    }
    if (method === "PATCH") {
      application.redirect_uris = (body as { redirect_uris: string[] }).redirect_uris;
      return json(200, publicShape(application));
    }
    if (method === "DELETE") {
      applications.delete(application.id);
      return json(200, { id: application.id, deleted: true });
    }
    return notFound();
  }

  return {
    applications,
    writes,
    interruptNext(handler: (method: string, path: string) => Response | null) {
      interrupt = handler;
    },
    wrap(fetchImpl: typeof fetch): typeof fetch {
      return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.href === DOMAINS_URL) {
          return json(200, {
            data: [
              {
                is_satellite: false,
                frontend_api_url: FAKE_CLERK_ISSUER,
                accounts_portal_url: new URL(FAKE_CLERK_ACCOUNT_URL).origin,
              },
            ],
          });
        }
        if (!url.href.startsWith(CLERK_PREFIX)) return fetchImpl(input, init);
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        return answer(url, method, body);
      }) as typeof fetch;
    },
  };
}
