# Custom domains for Evidence Libraries — research for plan 16

Read-only research, 2026-08-28. Sources: a Coolify clone at `/tmp/coolify-src`
(`config/constants.php:5` pins `4.3.12`, the version we run), a Dokploy clone at
`/tmp/dokploy-src`, published Vercel / Cloudflare / Let's Encrypt / Traefik / Caddy docs,
open-source BYOD implementations cloned to `/tmp/byod-src` (Dub, Bear Blog, Mataroa,
Baserow, picosh/pico, Plausible, Cal.com), the RFCs, live DNS and HTTP measurements against
our own infrastructure, and our own two repositories.

**Read section D first if you only read one part.** Two findings change the shape of the
feature: a CNAME cannot hide our IP (C.2), and Cloudflare for SaaS — the thing that can —
is free up to 100 custom hostnames. That is a decision for the user, not for the plan.

---

## 0. What we do today (baseline, verified in this checkout)

Every library gets exactly one platform address, `https://<slug>-lib.opendev.space`.

- The host is built in `/Users/mcharrad/Documents/Github/openscholar/dev-self/lib/evidence-libraries/setup/naming.ts:87-104`
  (`createEvidenceLibraryPublicAddress` → `` `${slug}-lib.${platformDomain}` ``, hostname capped at 253),
  with `position` suffixes for collisions at `naming.ts:108-120`.
- The platform domain comes from one environment variable, read at
  `convex/evidenceLibraries/setupNaming.ts:64-70`.
- The chosen address is stored once, on the runtime binding, as `targetBaseUrl`
  (`convex/schema.ts:109-113`, unique-ish through the `by_targetBaseUrl` index).
- Coolify is told about it as a **compose domain**, never as `fqdn`. Write shape,
  `convex/evidenceLibraries/coolifyClient.ts:924-936`:

```ts
  if (
    !hasExpectedComposeDomain(application.composeDomains, desired.publicDomain)
  ) {
    patch.docker_compose_domains = [
      { name: "web", domain: desired.publicDomain },
    ];
    patch.force_domain_override = false;
  }
  ...
  patch.instant_deploy = false;
```

  and on create, `coolifyClient.ts:946-965`:

```ts
    path: "/api/v1/applications/private-github-app",
    body: {
      ...
      docker_compose_domains: [{ name: "web", domain: desired.publicDomain }],
      ...
      instant_deploy: false,
      force_domain_override: false,
      autogenerate_domain: false,
```

- **Read shape is different from write shape.** We send an *array* of
  `{name, domain}`; Coolify hands back a *JSON string* of an *object keyed by
  service name*. `parseComposeDomains` at `coolifyClient.ts:556-596` decodes it and
  already tolerates a `redirect` field of `"www" | "non-www" | "both"` — we never
  write one today.
- We currently assert **exactly one** domain on **exactly the `web` service**
  (`coolifyClient.ts:806-813`):

```ts
function hasExpectedComposeDomain(
  domains: Record<string, ComposeDomain> | null,
  publicDomain: string,
): boolean {
  return (
    domains !== null &&
    Object.keys(domains).length === 1 &&
    domains.web?.domain === publicDomain
  );
}
```

  This single equality is checked from five places (`hasExpectedApplication`
  `:841`, `hasExpectedBoundApplication` `:863`, `readExpectedBoundApplication`
  `:875-895`, `applicationPatch` `:924`, `setApplicationDomain` `:1776`). **Adding a
  second domain breaks all five** — this is the main surgery in plan 16.
- Domains must be a bare HTTPS origin: `requirePublicDomain`,
  `coolifyClient.ts:316-338` — `https:` only, path must be `/`, no query, hash,
  user or password.
- Moving a library to a new address: `setApplicationDomain`,
  `coolifyClient.ts:1761-1810` — PATCH `docker_compose_domains`, then re-read and
  re-assert. `instant_deploy: false` throughout; a separate deploy applies it.
- Address reservation (`convex/evidenceLibraries/addressActions.ts`) has a
  three-gate check we can reuse almost unchanged for customer domains:
  1. our database (`readAddressCandidates`, `convex/evidenceLibraries/queries.ts:229-262`);
  2. everything Coolify already serves — `listServedHosts()`,
     `coolifyClient.ts:1462-1481`, reading `GET /api/v1/applications` and
     `GET /api/v1/services`, and collecting both `fqdn` and
     `docker_compose_domains` (`collectResourceHosts`, `:520-538`), cached 60 s
     (`addressActions.ts:10-11`, `readServedHostsCache`, `queries.ts:268-283`);
  3. an HTTP probe of the host itself that only accepts our proxy's "nothing here"
     answer (`addressActions.ts:60-66`):

```ts
export function isFreeHostSignal(status: number, body: string): boolean {
  return (
    status === FREE_HOST_STATUS &&
    body.trimStart().toLowerCase().startsWith(FREE_HOST_BODY)
  );
}
```
     (`FREE_HOST_STATUS = 503`, `FREE_HOST_BODY = "no available server"`,
     `addressActions.ts:12-13`; 8 s timeout, `:9`.)
  A failed check never reserves: `AddressCheckError` → `{status:"unavailable",
  reason:"check-failed"}` (`addressActions.ts:52-57`, `:176-179`).
- Ownership/liveness after deploy: `probeEvidenceLibraryAddress` +
  `classifyEvidenceLibraryAddress`, `convex/evidenceLibraries/readinessClient.ts:219-292`.
  It fetches `/api/library-config/health` and returns
  `ours | not-ours | unreachable`; the same 503 + `no available server` string means
  "nothing serves this host yet" (`:227-233`). `requireActiveRevision`
  (`readinessClient.ts:339-370`) then demands `active.revision === revisionKey`.
  **This is already a real proof-of-control primitive** and works on any hostname.
- Runtime canonical host: `identity.baseUrl`, validated by
  `publicHttpsOriginSchema` (origin-only, https-only —
  `/Users/mcharrad/Documents/Github/new-el-optimize/src/config/library-config/primitives.ts:207-210`,
  used at `src/config/library-config/schema.ts:188`). The runtime **308-redirects any
  other host to it** on every request:
  `getCanonicalLibraryRedirect` (`src/lib/runtime-routing.ts:62-91`) called first
  thing in `src/proxy.ts:264-273`. It reads `x-forwarded-host` first, falls back to
  `host`, and exempts loopback.
- `identity.baseUrl` is owner-read-only: `FIELD_AUTHORITY_OVERRIDES` at
  `lib/evidence-libraries/configuration/section-registry.ts:255-257` marks
  `/identity/baseUrl` `platformProvisioned`, and `owner-rules.ts:56-69` rejects any
  owner value that differs from `expectedBaseUrl` with
  "The generated public address cannot be changed."
- Plan 11 already froze the rules we must not break
  (`plans/evidence-library-configuration-v2/11-address-reservation-and-recovery.md:31-48`):
  no DNS special-casing ("DNS lookups cannot tell a wildcard host from an explicit
  record on Cloudflare"), never reserve when a check could not run, and the platform
  moves a library by itself when its address is stolen.
- Plan 00 lists **Domain** as explicitly deferred
  (`plans/evidence-library-configuration-v2/00-README.md:24`). Plan 16 is where it lands.

---

## 0b. What I measured on our live setup today (2026-08-28)

These four measurements decide the design, so they are here before the source reading.

1. **Everything under `opendev.space` is orange-clouded.** `*.opendev.space`,
   `convex.opendev.space`, `convex-site.opendev.space` and
   `convex-dashboard.opendev.space` all resolve to `188.114.96.6` /
   `188.114.97.6` — Cloudflare anycast, not our server. Nameservers are
   `beau.ns.cloudflare.com` / `teresa.ns.cloudflare.com`. **We have no DNS-only
   hostname today.** The origin IP is currently not discoverable through DNS.

2. **The "free host" signal is HTTPS-only.**
   - `GET https://el-nonexistent-xyz-lib.opendev.space/` → `503`, body
     `no available server` (Traefik: router matched, service has no servers).
   - `GET http://el-nonexistent-xyz-lib.opendev.space/` → `404`, body
     `404 page not found` (Traefik: no router matched on the `web` entrypoint).
   So `isFreeHostSignal` only ever fires over TLS, and only for hosts Cloudflare
   already has a certificate for. That is fine for `*.opendev.space` and **will not
   work unchanged for a customer's domain** — see 4.

3. **Cloudflare's edge refuses TLS for hostnames it does not know.** Connecting to
   `188.114.96.6:443` with SNI `evidence-byod-probe.gnu.org` and
   `evidence-byod-probe.kernel.org`:
   `curl: (35) sslv3 alert handshake failure`. Nothing is served; there is no HTTP
   response to inspect.
   (Control: the same test with `evidence-byod-probe.example.org` *did* complete the
   handshake — because `example.org` happens to be a Cloudflare zone with a
   `*.example.org` certificate — and then returned `HTTP/2 530`, body
   `error code: 1016` (Origin DNS error). That confirms the failure is a
   *hostname-not-configured* failure, not a network failure.)

4. **Therefore: a customer CNAME pointing at an orange-clouded
   `*.opendev.space` host is dead on arrival.** The visitor's browser resolves the
   CNAME to Cloudflare's IPs, offers SNI `evidence.customer.org`, and Cloudflare
   drops the handshake because that hostname is in nobody's Cloudflare zone.
   Traefik never sees the request, Let's Encrypt never sees the request, and there is
   no HTTP status for our probe to classify. Only three ways out exist:
   (a) a **DNS-only (grey-cloud)** CNAME target that resolves straight to the origin;
   (b) **Cloudflare for SaaS** custom hostnames — which keeps the orange cloud, keeps the
   IP hidden, moves certificate issuance to Cloudflare, and is **free up to 100 hostnames**
   (C.2); or
   (c) a second entry point (another IP/proxy) outside Cloudflare.
   This is the single most important decision in plan 16 and it is covered in C.

---

## 0c. The Domain section is already designed and agreed (mock branch)

`git show origin/feat/library-interface-mock:components/evidence-libraries/mock/config/domain-section.tsx`.
The mock is binding for the real page (`00-README.md:26-28`), so plan 16's UI is
mostly settled. What it already decides:

- **Two records, not one.** A CNAME and a TXT:

```tsx
const VERIFY_TOKEN = "os-verify=7f3a9c1e5b2d4a8f";
...
  const records = [
    { type: "CNAME", name: custom, value: library.address },
    { type: "TXT", name: `_openscholar.${custom}`, value: VERIFY_TOKEN },
  ];
```

- **The CNAME target is the library's own platform address** (`library.address`,
  i.e. `<slug>-lib.opendev.space`), **not** a shared `cname.opendev.space`.
- Status enum `none | pending | checking | verified | failed`
  (`lib/evidence-libraries/mock/config.ts:221`), stored on the draft as
  `{ custom: string; status: DnsStatus; redirectPlatform: boolean }` (`:321-325`).
- Typing a new domain over a `verified`/`failed` one resets to `pending` **and turns
  the redirect toggle off** (`domain-section.tsx:44-55`). Clearing it resets to `none`.
- Verification is **manually triggered** ("Check DNS" button), not a background poll.
- A separate **"TLS: Active"** chip appears only when verified — so certificate state
  is shown apart from DNS state.
- The **redirect toggle** — "Send the platform address to the custom domain" /
  "Visitors to the platform address land on the custom domain" — is disabled until
  verified ("Verify the domain first.").
- `domain` is a draft section that takes part in Save/Activate
  (`config.ts:344`, `:353` under the "publishing" rail group, `:374`).
- Copy (`messages/en-GB.json`, `evidenceLibraryMock.config.domain`): description
  "Use your own web address for the library.", records hint "Add these two records
  where you manage the domain, then check again.", failure text "Records not found".

Two mismatches between the mock and this research to settle with the user:
1. The mock's CNAME value is the library's own address, which is **orange-clouded**
   and therefore cannot work (measurement 0b.3/0b.4). The *shape* survives; the
   *value* must change to a DNS-only host.
2. The user asked for states `added / pointing / verified / active / failed`. The mock
   shows five chips plus a TLS chip. Section C maps a richer server state onto the
   mock's chips without changing the mock.

---

## 0d. Two more facts that shape the design

**The canonical-host switch already exists.** `startAddressMove`
(`convex/evidenceLibraries/versions.ts:130-165`) takes the live revision, rewrites
`identity.baseUrl` to a new host, re-runs `validateOwnerSections` with the new
`expectedBaseUrl`, and queues an address-move operation — writing nothing until
Coolify actually serves the new host:

```ts
      payload:
        row.sectionKey === "identity"
          ? { ...(row.payload as Record<string, unknown>), baseUrl: movedTo }
          : row.payload,
    })),
    { expectedBaseUrl: movedTo, requireComplete: true, ... },
```

Attaching a custom domain is the same operation with a different `movedTo`. Plan 16
should extend this rather than invent a second path.

**Switching `identity.baseUrl` has a wide blast radius in the runtime.** It is not
only the canonical redirect. In `/Users/mcharrad/Documents/Github/new-el-optimize`:

| Use | File |
|---|---|
| canonical 308 redirect | `src/proxy.ts:264-273` |
| `robots.txt` sitemap URL | `src/app/robots.ts:22` |
| sitemap + sitemap index URLs | `src/app/sitemap.ts:53`, `src/app/sitemap-index.xml/route.ts:25` |
| page canonical / OG origin | `src/app/[locale]/lib/page.tsx:44`, `src/app/[locale]/lib/[key]/page.tsx:50` |
| **NextAuth origin** | `src/app/api/auth/[...nextauth]/config.ts:96,103` (`withConfiguredOrigin`), and `src/lib/auth-options.ts:34` refuses env overrides |
| share/citation URLs | `src/components/features/newlib/ItemPage.tsx:606,746`, `ItemHeader.tsx:89` |
| policy page host text | `src/lib/policy-documents.ts:230` |
| export files | `src/lib/library-exports.ts:148` |
| **DOI landing pages registered with Crossref and Zenodo** | `src/lib/publication/crossref-adapter.ts:117`, `zenodo-adapter.ts:181`, `zenodo-activation-service.ts:327`, `crossref-activation-service.ts:247` |

The DOI row is the dangerous one: a landing-page URL handed to Crossref/Zenodo is
meant to be permanent. Switching the canonical host after DOIs are minted leaves
registered URLs pointing at the old host. That host must keep redirecting **for
ever**, which is an argument for never releasing a platform address after a custom
domain is attached — see C.9.

## A. How Coolify 4.3.12 does it

All paths relative to `/tmp/coolify-src`. Version confirmed at `config/constants.php:5`.

**The one structural fact to hold on to:** `fqdn` and `docker_compose_domains` are plain
text columns with **no Eloquent cast and no mutator** (`app/Models/Application.php:249-263`
lists the casts; neither column is there). Every read is a manual `json_decode`.
Normalisation is done by callers — and the API normalises `domains` but **not**
`docker_compose_domains`.

### A.1 Storage and normalisation

`fqdn` is a `longText` holding a **comma-separated list of full URLs**. Its unique index
was **dropped** in `database/migrations/2024_10_10_081444_remove_constraint_from_service_applications_fqdn.php:14-19`.
`docker_compose_domains` is a nullable `text` column
(`database/migrations/2023_11_24_080341_add_docker_compose_location.php:23`), declared as
a string in the API schema (`app/Models/Application.php:97`).

The **stored** shape is a JSON object keyed by compose service name:

```json
{
  "web": { "domain": "https://example.com,https://www.example.com", "redirect": "www" },
  "api": { "domain": "https://api.example.com:3000" }
}
```

(`tests/Feature/ApplicationParserDockerComposeDomainsTest.php:293-297`,
`tests/Unit/ComposeServiceNameHelpersTest.php:179-181`.) This matches what
`parseComposeDomains` in our own client already expects (`coolifyClient.ts:556-596`).

Splitting and normalisation live in `app/Support/ValidationPatterns.php`:

```php
    public static function applicationDomainList(?string $value): array
    {
        if (blank($value)) { return []; }
        return str($value)
            ->replaceStart(',', '')->replaceEnd(',', '')->trim()->explode(',')
            ->map(fn (string $url) => trim($url))
            ->filter(fn (string $url) => filled($url))
            ->values()->all();
    }
```
(`ValidationPatterns.php:653-668`; `normalizeApplicationDomainUrl` at `:596-646` lowercases
**scheme and host only**, keeps port, path, query and fragment as typed.)

| Question | Answer | Evidence |
|---|---|---|
| Scheme added if missing? | **No** — a bare `example.com` is a 422 | `bootstrap/helpers/domains.php:31-35` |
| Lowercased? | Scheme and host only | `ValidationPatterns.php:612`, `:626` |
| Trailing slash stripped? | **Not on storage** — only inside conflict checks | `domains.php:94-100` |
| Path kept? | Yes → becomes `PathPrefix` + a stripprefix middleware | `docker.php:699`, `:709` |
| Port kept? | Yes → and for compose it is the **only** way to set the upstream port | `docker.php:658` |

There is also a legacy key-reconciliation layer (`domains.php:330-546`) because old
Coolify stored compose keys with `-`/`.` replaced by `_`. **Writing the exact compose
service name keeps that layer out of the way** — which is what we already do (`"web"`).

### A.2 Validation and uniqueness

URL validation (`ValidationPatterns.php:523-579` → `isValidDomainUrl`,
`domains.php:23-69`): `http`/`https` only, host required, and a shell-injection guard
`'/[`$;&|<>()\\\r\n]/'` (`ValidationPatterns.php:115`). **Wildcards are rejected**
(FILTER_VALIDATE_URL refuses `*` in the host), **bare IPs are accepted**, and
**underscores in hosts are silently accepted** and stored, because `isValidDomainUrl`
rewrites `_`→`-` only for its own probe (`domains.php:50`) — producing an unresolvable
`Host()` rule.

The uniqueness check the API actually runs is
`checkIfDomainIsAlreadyUsedViaAPI()` (`bootstrap/helpers/domains.php:206-328`). The
compose branch is the part that matters to us:

```php
        if ($app->build_pack === 'dockercompose' && ! empty($app->docker_compose_domains)) {
            $dockerComposeDomains = json_decode($app->docker_compose_domains, true);
            if (is_array($dockerComposeDomains)) {
                foreach ($dockerComposeDomains as $serviceName => $domainConfig) {
                    $domainValue = data_get($domainConfig, 'domain');
                    if (empty($domainValue)) { continue; }
                    $list_of_domains = collect(explode(',', $domainValue))->filter(fn ($fqdn) => $fqdn !== '');
                    foreach ($list_of_domains as $domain) {
                        if (str($domain)->endsWith('/')) { $domain = str($domain)->beforeLast('/'); }
                        $naked_domain = str($domain)->value();
                        if ($domains->contains($naked_domain)) {
                            $conflicts[] = [ /* ... */
                                'message' => "Domain $naked_domain is already in use by application '{$app->name}' (service: {$serviceName})",
                            ];
                        }
                    }
                }
            }
        }
```
(`domains.php:253-280`.)

**It is scoped to one team** (`Application::ownedByCurrentTeamAPI`,
`app/Models/Application.php:480-483`) and self-excludes by application UUID. So:
**two teams on the same Coolify can claim the same domain** and get two Traefik routers
with identical `Host()` rules. Previews and service databases are never checked. Since
the DB unique index is gone, uniqueness is **advisory only**, and
`force_domain_override=true` disables it entirely.

**DNS pre-check exists but the REST API never runs it.** `validateDNSEntry`
(`bootstrap/helpers/shared.php:2102-2143`) resolves A/AAAA over UDP/53 against
`instance_settings.custom_dns_servers` (default `1.1.1.1`), gated by
`is_dns_validation_enabled`, and **treats any Cloudflare IP as a pass**
(`shared.php:2127-2130`). The async version writes to `applications.domain_dns_statuses`
(`app/Actions/Shared/CheckDomainDns.php:19-50`), but that column is in `$hidden`
(`app/Models/Application.php:246`) so it is **not readable over the API**. Grepping
`app/Http/Controllers/Api/` for `validateDNSEntry|CheckDomainDns|is_dns_validation`
returns zero hits. **We must do our own DNS checking. This is expected, not a gap to work around.**

### A.3 Traefik labels for a compose service

`fqdnLabelsForTraefik()` (`bootstrap/helpers/docker.php:603-867`) is the generator. The
per-domain loop and the HTTPS branch, abridged to what matters:

```php
    foreach ($domains as $loop => $domain) {
        try {
            $url = Url::fromString($domain);
            $host = $url->getHost(); $path = $url->getPath();
            $schema = $url->getScheme(); $port = $url->getPort();
            $http_label  = "http-{$loop}-{$uuid}";
            $https_label = "https-{$loop}-{$uuid}";
            if ($service_name) {
                // Dots in service names split Traefik label paths; hash avoids api.test/api-test collisions.
                $safeServiceName = traefikSafeServiceNameSegment($service_name);
                $http_label  = "http-{$loop}-{$uuid}-{$safeServiceName}";
                $https_label = "https-{$loop}-{$uuid}-{$safeServiceName}";
            }
            ...
            if ($schema === 'https') {
                $labels->push("traefik.http.routers.{$https_label}.rule=Host(`{$host}`) && PathPrefix(`{$path}`)");
                $labels->push("traefik.http.routers.{$https_label}.entryPoints=https");
                if ($port) { /* .service + .loadbalancer.server.port */ }
                ...
                $labels->push("traefik.http.routers.{$https_label}.tls=true");
                $labels->push("traefik.http.routers.{$https_label}.tls.certresolver=letsencrypt");

                // Set labels for http (redirect to https)
                $labels->push("traefik.http.routers.{$http_label}.rule=Host(`{$host}`) && PathPrefix(`{$path}`)");
                $labels->push("traefik.http.routers.{$http_label}.entryPoints=http");
                if ($is_force_https_enabled) { $httpMiddlewares->push('redirect-to-https'); }
                ...
            }
        } catch (Throwable) {
            continue;
        }
    }
    return $labels->sort();
```

- **`{loop}` is the index in the comma-separated list.** A second domain simply gets
  routers at index 1. Adding a domain does not disturb the first one's router names.
- Router names for compose are `https-{loop}-{app-uuid}-{slug}-{md5(serviceName)[0:4]}`
  (`traefikSafeServiceNameSegment`, `docker.php:29-44`; `traefikServiceNameHash`, `:19-22`).
- **A malformed domain is dropped silently** — `catch (Throwable) { continue; }`
  (`docker.php:861-863`). No log, no deploy warning.
- The `gzip` and `redirect-to-https` middlewares are **not** UUID-scoped
  (`docker.php:608`, `:610`); everything else is.

**How a compose service gets there.** Deploy calls
`Application::parse()` (`app/Jobs/ApplicationDeploymentJob.php:699`) →
`applicationParser()` (`app/Models/Application.php:2088-2097`), which reads the map,
resolves this service's string, splits it, and calls the generator per service
(`bootstrap/helpers/parsers.php:1194-1206`, `:1255-1256`, `:1346-1379`):

```php
        $domains = collect(json_decode(data_get($resource, 'docker_compose_domains') ?: '[]', true) ?: []);
        $fqdns = getComposeServiceDomainString($domains, (string) $serviceName);
        ...
        if (filled($fqdns)) { $fqdns = str($fqdns)->explode(','); }
        ...
        $serviceLabels = $serviceLabels->merge(fqdnLabelsForTraefik(
            uuid: $labelUuid, domains: $fqdns, ..., service_name: $serviceName,
            redirect_direction: $redirectDirection
        ));
```

**Trap for compose apps:** `applicationParser` passes no `onlyPort` and hard-nulls
`$predefinedPort` (`parsers.php:729`), so **no `loadbalancer.server.port` label is emitted
unless the port is in the domain URL**. We get away with this today only because our `web`
service exposes exactly one port (`new-el-optimize/docker/compose.library.yaml`,
`expose: ["3000"]`), so Traefik auto-detects it. Adding a second exposed port to `web`
would break routing for every library.

### A.4 Redirect to primary / `www`

There is **no `redirect_direct` and no `redirect_enabled`** in 4.3.12. The mechanism is
`redirect_direction` ∈ `www | non-www | both`, per compose service
(`parsers.php:1358-1361`). Crucially, the middleware is attached **only to the router of
the host being redirected away from** (`docker.php:718-725`):

> `redirect: "non-www"` does nothing unless `https://www.example.com` is **itself in the
> domain list**. The Livewire UI auto-adds the counterpart
> (`app/Livewire/Project/Application/Domains.php:1644-1695`). **The API does not.**

This is why Coolify's redirect field is useless for "send the platform address to the
custom domain" — the two hosts are not a `www` pair. Our runtime does it instead (C.7).

### A.5 Certificates

The **entire** ACME configuration is three flags in
`generateDefaultProxyConfiguration()` (`bootstrap/helpers/proxy.php:276-320`):

```php
                        '--certificatesresolvers.letsencrypt.acme.httpchallenge=true',
                        '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=http',
                        '--certificatesresolvers.letsencrypt.acme.storage=/traefik/acme.json',
```

- Resolver name: the literal string `letsencrypt` (`docker.php:768`).
- **HTTP-01 only.** No TLS-ALPN, no DNS-01 → **no wildcard certificates**.
- **No `acme.email`** — Traefik registers an anonymous ACME account, so no expiry mail.
- **No `caServer`** — you cannot use Let's Encrypt staging without hand-editing.
- Storage resolves to `/data/coolify/proxy/acme.json` (`app/Models/Server.php:839-854`,
  `config/constants.php:11`).
- `extractCustomProxyCommands()` treats `--certificatesresolvers.` as Coolify-owned
  (`proxy.php:200`), so **any hand-added ACME flag is discarded** on the next regeneration.

**There is no per-domain certificate failure surface at all.** Grepping `app/`,
`resources/` and `lang/` for `certificate could not|unable to obtain|acme error|tls error`
returns zero hits. Nothing parses `acme.json` or the Traefik log.
`app/Actions/Proxy/CheckProxy.php` only checks container status and ports. The only view is
the raw proxy log tail (`resources/views/livewire/server/proxy/logs.blade.php:19`).

**Consequence for us: our post-deploy HTTPS health probe is the only certificate signal
that exists.** This is the strongest justification for gate 4b in C.5.

There is also **no way to upload a custom TLS certificate** for an application domain
through the API. `SslCertificate` / `SslHelper` are a self-signed internal CA used only
for database TLS. `ServerProxyController` (`:171`) only allows `redirect_enabled`,
`redirect_url`, `generate_exact_labels`, `proxy_type` — there is no API route for
dynamic Traefik configuration.

### A.6 The API

`PATCH /api/v1/applications/{uuid}` — `app/Http/Controllers/Api/ApplicationsController.php:2782`.
Validation rules (`:2805-2826`):

```php
            'docker_compose_domains' => 'array|nullable',
            'docker_compose_domains.*' => 'array:name,domain,redirect',
            'docker_compose_domains.*.name' => 'string|required',
            'docker_compose_domains.*.domain' => ValidationPatterns::applicationDomainRules(),
            'docker_compose_domains.*.redirect' => 'nullable|string|in:www,non-www,both',
```

**The request shape is an array of `{name, domain, redirect?}` — the stored shape is an
object keyed by name.** This asymmetry is exactly what our client already handles
(write `coolifyClient.ts:926-928`, read `:556-596`).

Multiple domains on one compose service go in **one comma-separated `domain` string**,
not two array entries:

```http
PATCH /api/v1/applications/{uuid}
Authorization: Bearer <token>
Content-Type: application/json

{
  "docker_compose_domains": [
    { "name": "web",
      "domain": "https://library.example.org,https://www.library.example.org",
      "redirect": "non-www" }
  ],
  "instant_deploy": true
}
```

stored as
`{"web":{"domain":"https://library.example.org,https://www.library.example.org","redirect":"non-www"}}`
(round-trip proven in `tests/Feature/ApplicationDomainsTest.php:992-1007`).

For compose apps, sending `domains` at all is a hard **422**
(`ApplicationsController.php:2916-2925`). Conflicts return **409** with a `conflicts`
array (`:3021-3027`), unless `force_domain_override=true`.

**Domain changes require a redeploy.** `ApplicationConfigurationSnapshot.php:196-205`
classifies `fqdn`, `docker_compose_domains`, `redirect` and `is_force_https_enabled` as
`'redeploy'`. Labels are baked into the container at creation, generated during
`applicationParser()` at deploy time. There is no shortcut.

The only domain-listing endpoint is `GET /api/v1/servers/{uuid}/domains`
(`routes/api.php:153`, `ServersController.php:299-360`) and **it only reads
`applications.fqdn`** — compose apps have `fqdn = null`, so their domains never appear.
That is why our `listServedHosts()` reads `/api/v1/applications` and `/api/v1/services`
and parses `docker_compose_domains` itself (`coolifyClient.ts:1462-1481`, `:520-538`).
Keep doing that. There is **no "validate this domain" endpoint**.

### A.7 The gotchas that will bite plan 16

1. **PATCH `docker_compose_domains` is destructive-partial.** The map is rebuilt from
   scratch out of the request array (`:3033-3045`) and the whole column overwritten
   (`:3119-3121`). **Always send the complete map**, including the platform address.
2. **You cannot clear all compose domains through the API.**
   `if ($dockerComposeDomainsJson->count() > 0)` at `:3119` means an empty array leaves
   the column untouched. Harmless for us — we always keep the platform address — but it
   means "remove the custom domain" is a PATCH that sends the platform address alone.
3. **A `name` that is not a service in `docker_compose_raw` is silently dropped**
   (`:3035`) with a `200`. A typo produces success and no domain.
4. **Compose domains are never normalised.** `normalizeApplicationDomains` is applied to
   `domains` (`:2939`) but **never** to `docker_compose_domains`. `HTTPS://App.Example.COM/`
   is stored verbatim and lands in the `Host()` rule. **Normalise on our side.**
5. **`docker_compose_raw` must already be loaded** or the PATCH is a 422 (`:2963-2970`).
6. **Reloading the compose file prunes domains.** `reconcileDockerComposeDomains()`
   (`app/Models/Application.php:2215-2238`) drops any key that no longer names a service.
   If the runtime repo ever renames the `web` service, every library silently loses every
   domain. Worth an assertion.
7. **The compose parser can write domains behind your back** if the file declares
   `SERVICE_FQDN_*` / `SERVICE_URL_*` (`parsers.php:521-550`, `:644-666`). Checked:
   `new-el-optimize/docker/compose.library.yaml` has none. Keep it that way.
8. **`instant_deploy` can return 200 with a message instead of a uuid**
   (`:3149-3153`). We send `instant_deploy: false` everywhere, so this is only a trap if
   that ever changes — and `parseUuidResponse` (`coolifyClient.ts:552-556`) would throw.

---

## B. Dokploy, Vercel, Dub and the Caddy on-demand family

### B.1 Dokploy (TypeScript, Traefik) — `/tmp/dokploy-src` @ `ab62080`

**Headline: Dokploy has no ownership proof and no host uniqueness.** Its DNS check
is one advisory button. Its data model, however, is the best of the three.

**The table** (`packages/server/src/db/schema/domain.ts:20-60`) — a first-class row, not
a string on the application:

```ts
export const domains = pgTable("domain", {
	domainId: text("domainId").notNull().primaryKey().$defaultFn(() => nanoid()),
	host: text("host").notNull(),
	https: boolean("https").notNull().default(false),
	port: integer("port").default(3000),
	path: text("path").default("/"),
	serviceName: text("serviceName"),
	domainType: domainType("domainType").default("application"),
	uniqueConfigKey: serial("uniqueConfigKey"),
	composeId: text("composeId").references(() => compose.composeId, { onDelete: "cascade" }),
	customCertResolver: text("customCertResolver"),
	applicationId: text("applicationId").references(() => applications.applicationId, { onDelete: "cascade" }),
	certificateType: certificateType("certificateType").notNull().default("none"),
	middlewares: text("middlewares").array().default(sql`ARRAY[]::text[]`),
	enabled: boolean("enabled").notNull().default(true),
});
```

- `certificateType` enum is `letsencrypt | none | custom`
  (`packages/server/src/db/schema/shared.ts:11-15`).
- **`uniqueConfigKey` is the idea worth stealing.** A stable serial on the row becomes
  the Traefik router name, so delete and rename are surgical rather than
  "regenerate everything": `removeDomain`,
  `packages/server/src/utils/traefik/domain.ts:77-124`, deletes
  `${appName}-router-${uniqueKey}`, `${appName}-router-websecure-${uniqueKey}` and
  `${appName}-service-${uniqueKey}` by key, then removes the whole file when the last
  router goes.
- **There is no `status`, no `verified`, no `lastCheckedAt`.** The only lifecycle
  flag is `enabled` (operator intent), guarded at one choke point
  (`traefik/domain.ts:23-29`: `if (!domain.enabled) { await removeDomain(...); return; }`).
- Compose link is a plain `serviceName` column, validated against the real compose
  file only at deploy time (`packages/server/src/utils/docker/domain.ts:253-262`).

**Validation** (`packages/server/src/db/validations/domain.ts:7-71`) is a zod object;
the hostname rule is the whole of `packages/server/src/utils/hostname-validation.ts:1-8`:

```ts
// Valid hostname per RFC 1123: labels of letters, digits and hyphens
// (no leading/trailing hyphen), optionally separated by dots. Underscores are rejected
// because Let's Encrypt refuses to issue certificates for them.
export const VALID_HOSTNAME_REGEX =
	/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
```

Ports, paths, wildcards and trailing dots are rejected as a side effect of the
character class. **Bare IPv4, `localhost` and single-label names all pass** — there is
no public-suffix or TLD check.

**Uniqueness: none.** `createDomain`
(`packages/server/src/services/domain.ts:17-44`) inserts blind; there is no unique
index on `host` in the DDL (`apps/dokploy/drizzle/0000_reflective_puck.sql:176-186`).
Two tenants can both claim `shop.acme.com`, producing two Traefik routers with the
same `Host()` rule. That is a tenant-to-tenant hijack primitive. Do not copy.

**DNS verification** — `validateDomain`,
`packages/server/src/services/domain.ts:153-212`:

```ts
const resolveDns = promisify(dns.resolve4);

export const validateDomain = async (domain: string, expectedIp?: string) => {
	try {
		const cleanDomain = domain.replace(/^https?:\/\//, "").split("/")[0];
		const ips = await resolveDns(cleanDomain || "");
		const resolvedIps = ips.map((ip) => ip.toString());
		const cdnProvider = ips.map((ip) => detectCDNProvider(ip)).find((p) => p !== null);
		// If behind a CDN, we consider it valid but inform the user
		if (cdnProvider) {
			return { isValid: true, resolvedIp: resolvedIps.join(", "),
				cdnProvider: cdnProvider.displayName, error: cdnProvider.warningMessage };
		}
		if (expectedIp) {
			return { isValid: resolvedIps.includes(expectedIp), ... };
		}
		...
```

- `dns.resolve4` only. **No `resolveCname`, no `resolveTxt`, no IPv6, no HTTP probe** —
  the agent grepped the whole repo; the only DNS imports are these two lines.
- The nicest idea here: **CDN detection instead of a false negative**. A
  Cloudflare-proxied domain can never resolve to the server IP, so Dokploy reports
  "Behind Cloudflare" rather than "Invalid" (`services/cdn.ts:677`,
  hardcoded CIDR lists at `cdn.ts:33-73` — the idea is good, the stale IP lists are not).
- It is **advisory and ephemeral**: a standalone tRPC mutation
  (`apps/dokploy/server/api/routers/domain.ts:247-256`) that `create`/`update` never
  call, triggered by clicking a badge (`show-domains.tsx:185-220`), with the result
  held in `useState` (`show-domains.tsx:108`) so it dies on navigation. Nothing is
  persisted and nothing is rechecked.
- **Ownership verification: none.** No TXT challenge, no magic path, no token.
- The DNS help dialog only ever tells users to set an **A record** to the server IP
  (`dns-helper-modal.tsx:56-72`). Every server migration silently breaks every
  customer domain. This is precisely the failure our CNAME-only rule avoids.

**Traefik: two mechanisms, and the split matters to us.**

| Resource | Mechanism | Applies |
|---|---|---|
| Application, preview | Traefik **file provider** YAML under `/etc/dokploy/traefik/dynamic/<appName>.yml` | within a second (`watch: true`, `traefik-setup.ts:277-280`) |
| **Compose** | Docker **labels** written into the compose file | **only on next deploy** |

Dokploy is honest about it — the API returns `requiresRedeploy: domain.domainType === "compose"`
(`apps/dokploy/server/api/routers/domain.ts:191-194`) and the copy is centralised
(`redeploy-hint.tsx:1-19`). **We are a compose app, so we are on the slow path too.**

Router construction, `packages/server/src/utils/traefik/domain.ts:140-233`:

```ts
	const routerConfig: HttpRouter = {
		rule: `Host(\`${punycodeHost}\`)${path !== null && path !== "/" ? ` && PathPrefix(\`${path}\`)` : ""}`,
		service: `${appName}-service-${uniqueConfigKey}`,
		middlewares: [],
		entryPoints: [entryPoint],
	};
	const isRedirectRouter = entryPoint === "web" && https && !customEntrypoint;
	if (isRedirectRouter) { routerConfig.middlewares?.push("redirect-to-https"); }
	...
	if (entryPoint === "websecure" || (customEntrypoint && https)) {
		if (certificateType === "letsencrypt") {
			routerConfig.tls = { certResolver: "letsencrypt" };
		} else if (certificateType === "custom" && domain.customCertResolver) {
			routerConfig.tls = { certResolver: domain.customCertResolver };
		} else if (certificateType === "none") {
			routerConfig.tls = undefined;
		}
	}
```

Label equivalent at `packages/server/src/utils/docker/domain.ts:418-511`
(`traefik.http.routers.<name>.tls.certresolver=letsencrypt`), and note the
cross-provider middleware name `redirect-to-https@file` (`docker/domain.ts:450`).

**ACME** (`packages/server/src/setup/traefik-setup.ts:282-315`): resolver literally
named `letsencrypt`, **HTTP-01 only**, storage `/etc/dokploy/traefik/dynamic/acme.json`,
default email `test@localhost.com`. No `dnsChallenge` is ever written, so **no
wildcard certificates**. Worse, the `websecure` entrypoint sets
`http: { tls: { certResolver: "letsencrypt" } }` **globally**, so any HTTPS router
triggers an ACME order for its host — including hosts nobody verified. One tenant
with twenty typo'd domains burns the whole box's Let's Encrypt budget on a single
shared ACME account.

**Punycode**: `toPunycode` via `new URL("http://" + host).hostname`
(`traefik/domain.ts:126-138`) — a one-line trick worth copying.

**Uploaded certificates** are a separate org-scoped table
(`packages/server/src/db/schema/certificate.ts:10-29`) but land in the shared dynamic
directory and are matched purely by SNI (`services/certificate.ts:87-129`), so a
tenant's uploaded cert is effectively global to the box. `privateKey` is plaintext
`text` in Postgres. Do not copy either.

**What to take from Dokploy**: the `domain` row with a stable synthetic routing key,
the keyed `removeDomain`, the `enabled` soft off-switch guarded at one choke point,
the CDN-aware DNS answer, the punycode helper, and the honest `requiresRedeploy` flag.
**What to reject**: no uniqueness, no ownership proof, A-record-only instructions,
ephemeral unpersisted check state, and ACME fired before verification.
### B.2 Vercel (the documented reference flow)

- **The CNAME target is per project now, not the old flat `cname.vercel-dns.com`.**
  [add-a-domain](https://vercel.com/docs/domains/working-with-domains/add-a-domain):
  *"Each project has a unique CNAME record e.g. `d1d4fc829fe7bc7c.vercel-dns-017.com`."*
  The legacy `cname.vercel-dns.com` still resolves. Live probes of the pool:
  `cname.vercel-dns-017.com → 216.198.79.1, 64.29.17.1`;
  `d1d4fc829fe7bc7c.vercel-dns-017.com → 216.198.79.65, 64.29.17.65`.
  **Every one of these resolves to a plain IP.** See C.2.
- **Apex is an A record, and there is no CNAME-only path.**
  *"If you're using an Apex domain (e.g. example.com), you will need to configure it with
  an A record"*; *"If you're using a Subdomain (e.g. docs.example.com), you will need to
  configure it with a CNAME record"*. `76.76.21.21` is confirmed live (it answers
  `404 X-Vercel-Error: DEPLOYMENT_NOT_FOUND`), though
  [their KB](https://vercel.com/kb/guide/a-record-and-caa-with-vercel) says newer projects
  draw from an anycast pool. **They explicitly decline ALIAS/ANAME for external DNS:**
  *"Those record types exist to give an apex CNAME-like behavior on other platforms, but
  anycast already provides the steering, so they add no routing benefit here."*
- **`www` is the recommended primary**, and their reasoning is ours:
  *"We recommend using the `www` subdomain as your primary domain, with a redirect from
  the non-`www` domain to it."* … *"The DNS spec forbids using CNAME records on apex
  domains… Unlike A records, CNAME records avoid hard-coding a specific IP address in
  favor of an additional lookup at the DNS level. This means that Vercel can quickly
  steer traffic in the case of DDoS attacks or for performance optimizations."*
  The redirect is a **property on the domain object** (`redirect`,
  `redirectStatusCode`), not a DNS record — which is what C.4's `role` column models.
- **TXT ownership is conditional.**
  [claim-domain-ownership](https://vercel.com/docs/domains/working-with-domains/claim-domain-ownership):
  `TXT _vercel.example.com = vc-domain-verify=…`, required only *"If your domain is in
  use by another Vercel account"*. Not needed for an unclaimed domain.
- **The state model is worth copying verbatim.**
  [`GET /v6/domains/{domain}/config`](https://vercel.com/docs/rest-api/domains/get-a-domain-s-configuration)
  returns `configuredBy: "A" | "CNAME" | "dns-01" | "http" | null`, described as:
  *"`http`: Domain is resolving to Vercel but may be behind a Proxy"* and
  *"`null`: Domain is not resolving to Vercel"*; plus `misconfigured`, *"Whether or not
  the domain is configured AND we can automatically generate a TLS certificate."*
  Two lessons: they **fuse "DNS is right" and "we can get a cert" into one boolean**, and
  they have a **named state for "behind someone else's proxy"** — exactly the case in
  C.6.4. Re-check interval is not published.
- **Certificates.** [working-with-ssl](https://vercel.com/docs/domains/working-with-ssl):
  *"For all non-wildcard domains, we use the HTTP-01 challenge method. For wildcard
  requests, we use the DNS-01 challenge method."* Same as Coolify's Traefik (A.5).
- **CAA is a documented, named failure**, and note the conditional:
  *"you must add a `CAA` record with the value `0 issue "letsencrypt.org"` **if other CAA
  records already exist** on your domain."* An empty CAA set permits everyone. Also:
  *"The `/.well-known` path is reserved and cannot be redirected or rewritten"*, and a
  stale `_acme-challenge` TXT from a previous host is a listed cause of failure.
  Vercel shows only **"Invalid Configuration"** — no distinct certificate error.
- **Rate limits**, [multi-tenant limits](https://vercel.com/docs/platforms/multi-tenant-platforms/limits):
  domain addition 100/h per team, verification 50/h, removal 100/h. HTTP `409` on add
  means the domain is on another project; error codes `domain_already_in_use`,
  `invalid_domain`, `rate_limit_exceeded`.

### B.3 Dub.co — the "rent someone else's proxy" architecture

`/tmp/byod-src/dub`. Dub does not run a proxy; it drives Vercel's API. Useful for its
state handling, not its verification.

- **Verification is one provider call** (`apps/web/lib/api/domains/verify-domain.ts:1-13`,
  3 retries 2.5 s apart at `:15-39`). We cannot copy this; Traefik has no equivalent.
- **Three states from two signals**, resolved in a fixed order
  (`app/api/domains/[domain]/verify/route.ts:64-85`): ownership unproven →
  `"Pending Verification"`; routing wrong → `"Invalid Configuration"`; conflicting records
  → `"Conflicting DNS Records"`. Same split as our gate 3 versus gate 4.
- **No TLS state at all** — grepping `lib/api/domains` and `ui/domains` for "certificate"
  returns nothing. The cert is the provider's problem. We do not have that luxury (A.5).
- **No status column**: `prisma/schema/domain.prisma` stores only `verified: Boolean` and
  `lastChecked: DateTime` with `@@index(lastChecked(sort: Asc))`; status is computed on
  read. Our C.4 keeps a persisted state instead, because our gates are not idempotent
  provider calls.
- **The pre-flight is worth copying.** `app/api/domains/[domain]/validate/route.ts:9-95`
  returns `invalid | conflict | has site | available`, where `"has site"` HEADs
  `https://` then `http://` with a 3 s abort before falling back to `dns.resolve`. It
  stops a customer breaking their own live site. Note it treats a failed check as
  "available" — **the opposite of our rule; keep ours.**
- **The cleanup lifecycle is the piece Coolify and Dokploy both lack**
  (`app/(ee)/api/cron/domains/verify/route.ts:9-15`, hourly, `take: 30`,
  `orderBy: lastChecked asc`): reminder at 14 days, final reminder at 28, delete at 30 —
  with a safety valve that a domain with recorded traffic is never auto-deleted.
- Dub refuses `www` outright (`lib/api/domains/utils.ts:15-20`). Wrong for us — `www` is
  our recommended answer to the apex problem (C.3).

### B.4 The Caddy on-demand TLS family — and why Traefik cannot join it

Four open-source projects (picosh/pico, Bear Blog, Mataroa, Baserow) implement BYOD the
same way, and **none of the seven projects surveyed uses Traefik for it.**

Caddy's [On-Demand TLS](https://caddyserver.com/docs/automatic-https) *"dynamically
obtains a new certificate during the first TLS handshake that requires it, rather than at
config load… this does not require hard-coding the domain names in your configuration
ahead of time."* Abuse is prevented by a mandatory **`ask` endpoint**: GET with
`?domain=<sni>`, 2xx authorises issuance, anything else refuses.

**picosh/pico is the closest to our shape** because it separates customer domains from
platform domains (`caddy/Caddyfile.pgs`):

```
{
	storage postgres { connection_string {$DATABASE_URL} }
	on_demand_tls { ask http://web:3000/check }
}

# custom domains
:443 {
	reverse_proxy web:3000
	tls {$APP_EMAIL} { on_demand }
}

# subdomains and root pgs domain
*.{$APP_DOMAIN}, {$APP_DOMAIN} {
	reverse_proxy web:3000
	tls {$APP_EMAIL} { dns cloudflare {$CF_API_TOKEN} resolvers 1.1.1.1 }
```

and its ask handler does **two-factor authorisation** — a TXT record in the customer's
zone *and* a matching tenant in the database (`pkg/shared/router/api.go:68-89`, TXT lookup
with a 2-minute LRU cache at `pkg/shared/router/router.go:216-237`). Neither alone is
enough, so nobody can burn the ACME budget by pointing a domain at the IP.
Bear Blog's equivalent is 28 lines (`Caddyfile`, handler `blogs/views/blog.py:53-68`).

**Structural payoff:** none of these projects has a domain status field at all. State is
derived live, so there is nothing to poll and nothing to drift.

**Traefik cannot do this, and this is the hard constraint on plan 16.**
[TLS certificates reference](https://doc.traefik.io/traefik/reference/routing-configuration/http/tls/tls-certificates/):
selection is SNI-based and *"if no certificate matches the requested server name, Traefik
falls back to the default certificate."* There is no handshake-time issuance.
[ACME resolver reference](https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/):
*"the certificate resolver derives the domain name from any `Host()` or `HostSNI()`
matchers"*, and *"For new (sub)domains which need Let's Encrypt authentication, the
default Traefik certificate will be used until Traefik is restarted."*

So a hostname **must be in Traefik's configuration before a certificate is attempted** —
which is exactly our attach-then-deploy sequence (C.9), and exactly why gates 2 and 3 must
pass before we ever PATCH Coolify (C.6.3).

Historical note for completeness: **Plausible never used Caddy on-demand TLS** — it ran
`certbot certonly --nginx` over SSH from an Oban worker
(`lib/workers/provision_ssl_certificates.ex` @ v1.2.0) and the whole feature was removed in
2023 (`priv/repo/migrations/20231127132321_remove_custom_domains.exs`). Its worker had
three habits worth copying: `max_attempts: 1` (the cron is the retry, not the queue), a
`now() - '3 days'` window so abandoned domains stop hammering ACME, and the comment
*"Failing to obtain is expected, not a failure for the job queue"*.
**Cal.com is not a BYOD implementation** — it creates proxied CNAMEs inside its own
Cloudflare zone for org subdomains (`deploymentServices/cloudflare.ts:39-55`), which works
only because it is same-account.

## C. Recommended design for OpenScholar

### C.1 The CNAME target: one shared, stable, DNS-only host

**Decision: the target is a name on a dedicated, DNS-only (grey-clouded) zone we control
— never the library's own `<slug>-lib.opendev.space`, which is what the mock currently
shows.** Read this section with C.1a, which refines the target from a single flat
`cname.opendev.space` to a per-library alias on the same grey-clouded wildcard, and with
C.2, which is where the grey-cloud decision is actually settled.

Four reasons, in order of weight:

1. **The per-library target breaks on its own.** Plan 11 gave the platform the right
   to move a library to a new address by itself when the old one is taken
   (`00-README`-level decision 6, `11-address-reservation-and-recovery.md:44-46`;
   implemented in `moveLibraryAddress`, `convex/evidenceLibraries/addressActions.ts:246-295`).
   If a customer's CNAME points at `hello-lib.opendev.space` and the platform moves
   the library to `hello-2-lib.opendev.space`, the customer's site dies and only the
   customer can fix it. A shared target is immune.
2. **Certificates.** With HTTP-01 the certificate is issued for
   `evidence.customer.org`, never for the target. The target's own name and
   certificate are irrelevant, so there is no certificate reason to prefer a
   per-library target.
3. **Moving servers.** One A record change on `cname.opendev.space` moves every
   customer domain at once. Per-library targets would also work here, but only
   because they share the same wildcard — and the wildcard is orange-clouded, which
   brings us to the real problem.
4. **Cloudflare.** Measurement 0b.3 is decisive: Cloudflare's edge **refuses the TLS
   handshake** for a hostname that is in nobody's Cloudflare zone. A customer CNAME
   to any orange-clouded `*.opendev.space` host produces a dead site with no HTTP
   response at all — not even an error page our probe could classify. The target
   **must** be DNS-only.

So the shape stays exactly as the mock draws it; only the value changes:

| Type | Name | Value |
|---|---|---|
| CNAME | `evidence.customer.org` | `cname.opendev.space` |
| TXT | `_openscholar.evidence.customer.org` | `os-verify=<per-library token>` |

**Infrastructure work this needs (one-off, not per library):**
- Add `cname.opendev.space` as an **A record, proxy off (grey cloud)**, pointing at the
  Coolify server, in the `opendev.space` Cloudflare zone.
- Nothing else. Traefik already answers port 80 and 443 on that IP.

### C.1a Refinement suggested by Vercel: a per-library alias on a shared zone

Give each library a **stable, per-library CNAME target that is not its platform address**:

```
CNAME  evidence.customer.org  →  <libraryId>.cname.opendev.space
```

with one grey-clouded wildcard `*.cname.opendev.space` behind it. Keeps everything C.1
argued for, and adds Vercel's benefit: we can re-steer one library later without asking
that customer to change anything. Cost: one wildcard record and a longer string to copy.
**Recommended over a flat `cname.opendev.space`.**

### C.2 Be honest: CNAME-only does not hide the IP

The user's requirement is "customers point with a CNAME, never an A record — the
platform's IP must not be exposed or documented". The first half is achievable and worth
doing. **The second half is not achievable with a plain CNAME**, and plan 16 must say so
rather than imply otherwise.

Every CNAME chain must end in an address record, and a resolver returns the whole chain in
one answer. One `dig` on the customer's hostname prints our target *and* our IP:

```
evidence.customer.org.      CNAME  <libraryId>.cname.opendev.space.
<libraryId>.cname.opendev.space.  A  203.0.113.45   <-- our Traefik server
```

Every real SaaS CNAME target behaves the same way — `cname.dub.co → 66.33.60.66`,
`domain-proxy.bearblog.dev → 159.223.204.176`, `apex-loadbalancer.netlify.com → 75.2.60.5`,
`cname.vercel-dns-017.com → 216.198.79.1`. There is no record type meaning "connect here
but do not tell me where here is". That only exists when a proxy answers with its own IP.

What CNAME-only actually buys, and these are real and worth the trade:
- **No customer ever types an IP**, and none is in our documentation.
- **We can move servers without touching a single customer's DNS.** This is the point.
- **No customer DNS goes stale** when infrastructure changes.

**The option that does hide the IP is cheaper than expected.**
[Cloudflare for SaaS pricing](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/)
(page dated 14 Aug 2026): **100 custom hostnames included on every plan including Free**,
then **$0.10 per hostname per month**, up to 50,000. We will not have 100 custom domains
for a long time, so in practice this is **free**.

How it works ([getting-started](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/)):
we create a proxied fallback-origin record and a proxied CNAME target (a wildcard such as
`*.cname.opendev.space` is allowed); the customer creates
`evidence.customer.org CNAME cname.opendev.space`. Both of our records stay **orange**, so
the origin IP is never in any answer. Cloudflare issues and renews the per-hostname
certificate, which also takes the whole Let's Encrypt rate-limit exposure (C.6.3) off our
Traefik. Validation can be HTTP DCV, TXT DCV, or one-time **DCV delegation**
(`_acme-challenge.example.com CNAME example.com.<VALIDATION_URL>.`).

This is **not** the special-casing the user refused. The refusal was about requiring
something of the *customer's* DNS provider. Cloudflare for SaaS asks the customer for the
same single CNAME either way.

Its costs are real but small: Cloudflare, not Traefik, owns customer TLS; the zone must run
**Full (strict)**; and Cloudflare connects to the fallback origin with the *custom hostname*
in SNI by default, so either Traefik needs a certificate covering it or we set a per-hostname
origin/SNI override. There is also a documented gap where *"the hostname may route to
Cloudflare before the certificate reaches `ssl.status: active`"* — a brief TLS-error window.

**Recommendation, changed by the pricing:** ask the user to choose between

| | grey-clouded target | Cloudflare for SaaS |
|---|---|---|
| IP hidden | no | **yes** |
| Certificates | Traefik / Let's Encrypt, ours to break | Cloudflare's |
| ACME rate-limit exposure | shared across the whole server (C.6.3) | none |
| New dependency | none | Cloudflare API call on attach and remove |
| Cost | none | free to 100 hostnames, then $0.10/month each |
| Redeploy per domain | yes (A.6) | still yes, for Traefik routing |

**If the "IP must not be exposed" requirement is meant literally, Cloudflare for SaaS is
the answer and it is affordable.** If it is really "no customer types an IP and we can move
servers", the grey-clouded target is simpler. This is the single decision plan 16 cannot
make on its own.

### C.3 The apex problem

A bare domain cannot have a CNAME. The apex must carry SOA and NS records
([RFC 2181 §6.1](https://www.rfc-editor.org/rfc/rfc2181): the NS and SOA records are
*"the mandatory records in every zone"*), and a CNAME forbids all other data at its node.
[RFC 1034 §3.6.2](https://www.rfc-editor.org/rfc/rfc1034): *"If a CNAME RR is present at a
node, no other data should be present."* [RFC 2181 §10.1](https://www.rfc-editor.org/rfc/rfc2181)
states the exclusivity formally. The most quotable version is
[RFC 1912 §2.4](https://www.rfc-editor.org/rfc/rfc1912):

> A CNAME record is not allowed to coexist with any other data. … Since no other records
> are allowed to coexist with a CNAME, the NS entries are ignored. Therefore all the hosts
> in the podunk.xx domain are ignored as well!

**The plain-language version for the owner, and the reason this is not negotiable:** an
apex CNAME does not just break the website. Because the rule is per *name*, not per *type*,
it wipes out the domain's MX records (email stops), SPF/DKIM/DMARC, and CAA at the same time.

**Which providers can alias an apex to a third-party target**

| Supported | Not supported | Vendor resources only — **unusable for us** |
|---|---|---|
| Cloudflare (CNAME flattening, **on by default on every plan, cannot be disabled**), DNSimple (ALIAS), easyDNS (ANAME), Namecheap (ALIAS, all their DNS tiers), Gandi LiveDNS (ALIAS), Porkbun (ALIAS), Squarespace (ALIAS), Netlify DNS, Vercel DNS, Google Cloud DNS (ALIAS) | Hetzner, deSEC (deliberately, for DNSSEC), DigitalOcean, OVH, Vultr | **AWS Route 53** — *"An alias record can only redirect queries to selected AWS resources"*; **Azure DNS** — *"They can reference other Azure resources from within your DNS zone"* |

Two caveats worth knowing. Google Cloud DNS ALIAS *"are not compatible with DNSSEC"* and
cannot be configured in the console — gcloud or API only. Gandi warns an ALIAS *"will
break DNSSEC on the bare domain"*.

**The consequential finding: Route 53 and Azure DNS customers cannot use a bare apex with
us, at all, and that is not appealable.** Apex aliasing is common on registrar DNS and
absent exactly where larger institutions host their zones. Since Evidence Library owners
are universities and NGOs, expect to hit this.

So, three situations and what we tell the owner:

1. **Their DNS host supports flattening/ALIAS/ANAME.** They point that record type at our
   target and it works. We accept it, because our verification is behavioural (C.5 gate 2b),
   not record-type-based.
2. **It does not** (Route 53, Azure DNS, and most enterprise DNS). We say plainly: use
   `www.example.org` as the library address and forward `example.org` to it at the registrar.
   Netlify gives exactly this advice, and adds our conclusion:
   *"we recommend using a subdomain for your primary domain when using external DNS."*
   GoDaddy and Namecheap both offer 301 forwarding at the root; on Cloudflare it is a
   Redirect Rule with a **proxied** dummy `A @ 192.0.2.1` (the
   [documented](https://developers.cloudflare.com/fundamentals/manage-domains/redirect-domain/)
   RFC 5737 address that *"does not route traffic to an origin server but allows Cloudflare
   to apply rules"*).
3. **They insist on a bare apex with neither.** Refuse with option 2's wording. This is
   where the CNAME-only rule bites, and it should — it is what keeps us movable.

**Copy for the UI:**
> Most domain hosts cannot point a bare domain like `example.org` at another address, and
> forcing it would stop your email working. Use `www.example.org` or
> `library.example.org` instead, and ask your domain host to forward `example.org` to it.
> If your domain host offers "CNAME flattening", "ALIAS" or "ANAME", you can use the bare
> domain with that.

**Not a solution yet: SVCB/HTTPS AliasMode.** [RFC 9460 §2.4.2](https://www.rfc-editor.org/rfc/rfc9460.html)
says *"The primary purpose of AliasMode is to allow aliasing at the zone apex, where CNAME
is not allowed"*, but it only helps a client that queries type 65 and follows the alias, and
it does not synthesise A/AAAA. General resolvers do not chase it. Treat it as a future
optimisation on top of an ALIAS or A floor, not a 2026 apex strategy.

### C.4 Data model

**A new table, not a field on the binding.** A library must be able to have a domain
in a half-finished state without touching the runtime binding, and later more than one
(a `www` alias, a renamed institution). Follow Dokploy's shape, fix its two holes.

```ts
evidenceLibraryDomains: defineTable({
  libraryId: v.id("evidenceLibraries"),
  // Lowercased, trailing dot stripped, punycode ASCII. The unique key.
  host: v.string(),
  // Proof the owner controls the name. Generated once, never regenerated on retry.
  verificationToken: v.string(),
  role: v.union(v.literal("primary"), v.literal("redirect")),
  state: v.union(
    v.literal("added"),      // saved; records not seen yet
    v.literal("pointing"),   // CNAME chain reaches our target (DNS proof)
    v.literal("verified"),   // TXT token matches too (ownership proof)
    v.literal("active"),     // Coolify serves it and the library answers on it
    v.literal("failed"),     // last check failed; `failure` says why
  ),
  failure: v.optional(v.union(
    v.literal("no-records"), v.literal("wrong-target"), v.literal("token-mismatch"),
    v.literal("host-taken"), v.literal("not-served"), v.literal("certificate"),
    v.literal("check-failed"),
  )),
  checkedAt: v.optional(v.number()),
  activatedAt: v.optional(v.number()),
})
  .index("by_host", ["host"])          // global uniqueness
  .index("by_libraryId", ["libraryId"])
  .index("by_state", ["state"]),       // for the recheck sweep
```

Notes on each decision:

- **`by_host` is the uniqueness gate Dokploy lacks.** A second library claiming a host
  another library holds is refused with "That domain is already used by another
  library" — the same shape as the existing `name-taken` answer
  (`addressActions.ts:35-38`). Enforce it inside the mutation transaction, exactly the
  way `reserveAddress` re-checks after the action's read (`addressActions.ts:222-236`).
- **`role: primary | redirect`** covers `www` + apex-forward and future renames. Only
  one `primary` per library; every `redirect` 308s to the primary through the runtime's
  existing `getCanonicalLibraryRedirect`, at zero extra cost.
- **The five states are the user's list**, and they map onto the mock's chips without
  changing the mock:

  | server state | mock `DnsStatus` | extra chip |
  |---|---|---|
  | `added` | `pending` ("Not verified") | — |
  | (check running) | `checking` ("Checking…") | — |
  | `pointing` | `pending` | — |
  | `verified` | `verified` ("Verified") | — |
  | `active` | `verified` | "TLS: Active" |
  | `failed` | `failed` ("Records not found") | — |

  So the mock's "TLS: Active" chip becomes truthful (it means `active`), and the mock
  needs no visual change. `checking` stays what it is today: transient client state
  while the action runs.
- The platform address is **not** a row in this table. It stays where it is, on the
  runtime binding as `targetBaseUrl`. Keeping one source of truth for the address the
  platform guarantees avoids a whole class of "which one is real" bugs.
- `verificationToken` is per library, generated once at first domain add, so the TXT
  record survives the owner retyping the host — matching the mock, which shows a stable
  `VERIFY_TOKEN` for the library, not per host.

### C.5 Verification, with no provider API and no special-casing

Four gates, in order. Each one is behaviour any customer can produce with any DNS host.
Nothing advances a state unless its gate passed; a gate that could not *run* never
advances and never fails — it returns `check-failed`, exactly like
`AddressCheckError` today (`addressActions.ts:52-57`).

**Gate 1 — the host is free (before anything is stored).**
Reuse `findFreeEvidenceLibraryAddress`'s middle gate unchanged: `listServedHosts()`
(`coolifyClient.ts:1462-1481`) must not already contain the host. Plus the new
`by_host` index. Refuse with `host-taken`.

**Gate 2 — the CNAME chain reaches our target → `pointing`.**
Resolve `evidence.customer.org` and require our target to appear in the chain.

*Do it over DNS-over-HTTPS with `fetch`, not `node:dns`.* Reasons:
- It runs in the default Convex runtime (`convex/_generated/ai/guidelines.md:267`:
  "`fetch()` is available in the default Convex runtime"), so no `"use node"` file split.
  We have **no precedent for `node:dns` in this repo** — the only Node built-in used
  anywhere in `convex/` is `node:crypto` — and whether the self-hosted backend
  container permits outbound UDP/53 is unverified.
- `dns.resolveCname` returns only the CNAME at the name queried; it does not give the
  chain. A DoH `A` query returns the **full chain in the answer section**, so one
  request proves both "there is a CNAME" and "it lands on us".
- Query two independent public resolvers and require both to agree. Using a public
  recursive resolver is not special-casing our own DNS provider; it asks the customer
  for nothing.

Accept when either:
  (a) the answer section contains a `CNAME` RR whose target is `cname.opendev.space`
      (case-insensitive, trailing dot stripped) — the normal subdomain case; or
  (b) the answer resolves to the same address set as `cname.opendev.space` with no
      CNAME visible — the apex flattening/ALIAS case (C.3 situation 1).
Reject with `wrong-target` when it resolves somewhere else, `no-records` when NXDOMAIN
or empty.

**This does not contradict plan 11.** Plan 11 banned DNS lookups for deciding whether a
`*.opendev.space` host is free, because every name in a wildcard zone resolves
identically (`11-address-reservation-and-recovery.md:22-23`). That reasoning does not
apply to a customer's own zone, where a CNAME is exactly the signal we need. Plan 16
should say this out loud so the two plans do not look like they disagree.

#### C.5a The DoH mechanics, verified today

I ran these against both resolvers on 2026-08-28. They behave exactly as the design needs.

```
GET https://cloudflare-dns.com/dns-query?name=<host>&type=A
    accept: application/dns-json
GET https://dns.google/resolve?name=<host>&type=A
```

**The chain comes back in one answer** (`type: 5` is CNAME, `type: 1` is A):

```json
{"Status":0,"Answer":[
  {"name":"www.github.com","type":5,"TTL":3031,"data":"github.com."},
  {"name":"github.com","type":1,"TTL":18,"data":"140.82.121.4"}]}
```

So gate 2 is a single request per resolver: look for a `type: 5` record whose `data`,
lowercased with the trailing dot stripped, equals `cname.opendev.space`.

**TXT** (`type=16`) returns the value **wrapped in literal quotes** — strip them before
comparing:

```json
{"Status":0,"Answer":[{"name":"_dmarc.github.com","type":16,
  "data":"\"v=DMARC1; p=quarantine; ...\""}]}
```

**CAA** (`type=257`) returns flag + tag + value as one string, so the gate is a scan for
`issue "letsencrypt.org"` when any `issue` record exists:

```json
{"Answer":[{"name":"github.com","type":257,"data":"0 issue \"digicert.com\""},
           {"name":"github.com","type":257,"data":"0 issue \"letsencrypt.org\""}]}
```

**Three things to get right in the parser:**
- `Status: 3` is NXDOMAIN. `Status: 0` **with no `Answer` key** is NODATA — the name
  exists but has no record of that type. They are different failures and deserve
  different messages ("We could not find that domain" vs "Those records are not there yet").
- Google returns names with a trailing dot (`"www.github.com."`); Cloudflare does not.
  Normalise both sides before comparing.
- Require both resolvers to agree before advancing a state. Let a single-resolver
  disagreement be `check-failed`, never `failed` — same rule as `AddressCheckError`
  today (`addressActions.ts:52-57`).

**Gate 3 — the TXT token matches → `verified`.**
DoH `TXT` query for `_openscholar.<host>`; require an exact string match on
`os-verify=<token>`.

Why keep the TXT record when a CNAME already proves zone control? Because a CNAME
**cannot coexist with any other record at the same name**, so a customer whose
`evidence.customer.org` currently serves a live site cannot create the CNAME until
they are ready to cut over. The TXT lives at `_openscholar.evidence.customer.org`,
a different name, so they can prove ownership first and cut over second, with no
downtime window. This is exactly why Vercel uses `_vercel` TXT, and it justifies the
mock's second row.

**Gate 4 — our proxy answers, then our library answers → `active`.**
Two steps, because they prove different things and fail differently.

4a, *before* attaching in Coolify: `GET http://<host>/` over **plain HTTP** and require
`404` with body `404 page not found`. Measurement 0b.2: that is precisely what our
Traefik returns for a host it has no router for, and only our Traefik can answer at
that address. This is the direct analogue of `isFreeHostSignal` and should be a
sibling pure function in `addressActions.ts`:

```ts
// Our proxy answers `404 page not found` on plain HTTP for a host it does not
// route yet. Reaching that answer proves the name points at us and nothing
// serves it. HTTPS cannot be used here: the certificate does not exist yet.
export function isUnroutedHostSignal(status: number, body: string): boolean {
  return status === 404 && body.trimStart().toLowerCase().startsWith("404 page not found");
}
```

  **Do not reuse the existing HTTPS `503 no available server` probe here.** Measurement
  0b.2 shows that signal only exists over TLS, and before the certificate is issued
  there is no TLS to speak on. Using the wrong probe is the single most likely way to
  ship a feature that never verifies anything.

4b, *after* attaching and deploying: the existing
`probeEvidenceLibraryAddress` / `requireActiveRevision`
(`readinessClient.ts:259-292`, `:339-370`) against `https://<host>/api/library-config/health`,
requiring `state === "ours"` and `active.revision === revisionKey`. That proves the
certificate works, Traefik routes to the right container, and it is *this* library and
not a neighbour's. Only then does the row become `active`.

**Rechecking.** Dokploy's biggest failure is that its check result is `useState` and
dies on navigation. Persist `state`, `failure` and `checkedAt`, and run a sweep over
`by_state` for `active` rows on a schedule. A customer who repoints DNS away should
show as `failed`, not keep a live router for ever. Reuse the "Check DNS" button for
the manual path exactly as the mock draws it.

### C.6 Certificates through Traefik, and how they fail

Coolify's Traefik issues per-hostname certificates over **HTTP-01** on the `web`
entrypoint (A.5). **A hostname must be in Traefik's configuration before a certificate is
attempted** — Traefik has no on-demand TLS (B.4), and *"For new (sub)domains which need
Let's Encrypt authentication, the default Traefik certificate will be used until Traefik is
restarted."* So the order is fixed: verify, then PATCH Coolify, then deploy.

Failure modes, in the order they will bite:

1. **The CNAME target is orange-clouded.** Fatal and silent, and the default if we skip
   C.1. Cloudflare terminates TLS at the edge, looks the hostname up, finds it in nobody's
   zone, and refuses — Traefik is never contacted, so the ACME challenge never arrives.
   **Two distinct errors, and which one you get depends on the customer:**
   - the customer's zone is **on Cloudflare** → **1014 CNAME Cross-User Banned**:
     *"This error indicates that a CNAME record between domains in different Cloudflare
     accounts is prohibited… To allow CNAME record resolution to a domain in a different
     Cloudflare account, the domain owner of the CNAME target must use Cloudflare for SaaS."*
   - the customer's zone is **not on Cloudflare** → **1001**:
     *"A non-Cloudflare domain cannot CNAME to a Cloudflare domain, unless the
     non-Cloudflare domain is added to a Cloudflare account."*

   My measurement 0b.3 is the raw form of this: the handshake is dropped before any HTTP
   status exists. Prevented by the grey-clouded target, or removed entirely by Cloudflare
   for SaaS (C.2).
2. **A CAA record blocks Let's Encrypt.** Only bites when the customer *already has* CAA
   records — an empty set permits everyone. **Check it in gate 2** with a DoH `CAA` query
   on the host and each parent label; if any `issue` value exists and none is
   `letsencrypt.org`, fail early naming the exact record to add:
   `0 issue "letsencrypt.org"`. Vercel ships a troubleshooting page for precisely this,
   which is reason enough to build it on day one. Two neighbours of this failure, both
   documented by Vercel: a **stale `_acme-challenge` TXT** left by a previous host, and any
   rewrite or redirect of `/.well-known` (*"The `/.well-known` path is reserved and cannot
   be redirected or rewritten"*).
3. **Let's Encrypt rate limits, and one of them has no override.** Current limits
   ([letsencrypt.org/docs/rate-limits](https://letsencrypt.org/docs/rate-limits/), Aug 2026):

   | Limit | Value | Override? |
   |---|---|---|
   | New orders per ACME account | 300 per 3 h | yes |
   | New certificates per registered domain | 50 per 7 days | yes |
   | New certificates per exact identifier set | 5 per 7 days | no |
   | **Authorisation failures per identifier per account** | **5 per hour** | **no** |
   | Consecutive authorisation failures per identifier | 1,152 before pause | no |

   Coolify runs **one shared ACME account for the whole server** (A.5), so the 300-orders
   bucket is shared by every library. The dangerous one is the 5-failures-per-hour cap:
   Traefik retries a failing hostname, and after five attempts that hostname is locked out
   for the hour with **no way to appeal**.
   **Mitigation, and the strongest argument for the whole gated state machine: never hand a
   host to Coolify until it reaches `verified`.** Gates 2 and 3 cost Let's Encrypt nothing.
   Also confirm `acme.json` is on durable storage — Coolify puts it at
   `/data/coolify/proxy/acme.json` — because losing it re-orders every certificate at once.
4. **The customer puts their own proxy in front.** If `evidence.customer.org` is itself
   orange-clouded on *their* Cloudflare, gate 2 sees Cloudflare addresses rather than our
   CNAME and gate 4a fails, because their proxy answers, not ours. Give it its own message
   ("Your domain is behind another proxy. Turn the proxy off for this record.") rather than
   a generic failure. Vercel models this as a first-class state
   (`configuredBy: "http"` — *"resolving to Vercel but may be behind a Proxy"*); Bear Blog
   just prints, in bold, *"If you're using Cloudflare turn off the proxy (the little orange
   cloud)."* Dokploy's CDN detection (`services/domain.ts:174-187`) is the same idea done
   with hardcoded IP ranges — take the idea, not the lists.
5. **Removing a domain does not remove its certificate.** Traefik keeps it in `acme.json`
   until expiry. Do not read "the old host still serves TLS" as a failed removal.

#### C.6a The escape hatch worth keeping in the plan: DNS-01 delegation

If HTTP-01 proves fragile — most likely because a customer insists on keeping their own
proxy in front (failure 4) — there is a documented way out that needs no proxy changes.
[Let's Encrypt](https://letsencrypt.org/docs/challenge-types/): *"you can use CNAME records
or NS records to delegate answering the challenge to other DNS zones. This can be used to
delegate the `_acme-challenge` subdomain to a validation-specific server or zone."*
Traefik's ACME library (lego) **follows those CNAMEs by default** — the switch is
`LEGO_DISABLE_CNAME_SUPPORT`, i.e. opt-*out*.

The customer would add one extra one-time record:

```
CNAME  _acme-challenge.evidence.customer.org  →  <token>.acme.opendev.space
```

and we answer the challenge in our own zone. It works through any proxy, works for
wildcards, and never needs port 80 to reach us. It does mean writing TXT records in our
zone programmatically, so it is a second-phase option, not a day-one one.

Also worth offering owners later: [RFC 8657](https://letsencrypt.org/docs/caa/) CAA
parameters. `accounturi` *"controls which ACME accounts can request issuance"* and
`validationmethods` restricts the challenge type — a genuine security feature for an owner
who wants to pin issuance to us.

### C.7 The canonical host and the redirect toggle

**The runtime already implements the toggle, for free.**
`getCanonicalLibraryRedirect` (`new-el-optimize/src/lib/runtime-routing.ts:62-91`)
308-redirects every request whose host is not `identity.baseUrl`, and `src/proxy.ts:264-273`
runs it before anything else. So:

- **Toggle off** (default after attaching): `identity.baseUrl` stays the platform
  address. The custom domain is routed by Traefik, gets its certificate, and 308s
  visitors to the platform address. Nothing in the runtime changes. **This is a useful
  state, not a broken one**: the owner can visit the custom domain and see it work
  (padlock, redirect) before committing.
- **Toggle on**: publish a revision whose `identity.baseUrl` is the custom domain.
  The platform address then 308s to the custom domain automatically, again with no
  runtime change. The mock's hint — "Visitors to the platform address land on the
  custom domain" — is exactly this.

So **no Traefik redirect labels are needed** and Coolify's per-domain
`redirect: "www" | "non-www" | "both"` field (which our parser already understands,
`coolifyClient.ts:571-584`) stays unused. Good: it would have been a second source of
truth for the same behaviour.

**Reuse the address-move machinery, do not write a new one.** `startAddressMove`
(`convex/evidenceLibraries/versions.ts:130-165`) already rewrites `identity.baseUrl`,
re-runs `validateOwnerSections` with the new `expectedBaseUrl`, and queues an operation
that writes nothing until Coolify serves the new host. Flipping the toggle is that
function with `movedTo = "https://evidence.customer.org"`. `owner-rules.ts:56-69`
keeps rejecting owner-supplied values, which is still right — the field is set by the
platform, just from a new source.

**Two things that must be said in the plan before the toggle ships:**
- `identity.baseUrl` is the **NextAuth origin**
  (`new-el-optimize/src/app/api/auth/[...nextauth]/config.ts:96,103`). Flipping it logs
  everyone out. Say so in the confirm dialog.
- `identity.baseUrl` is baked into **DOI landing pages** registered with Crossref and
  Zenodo (`crossref-adapter.ts:117`, `zenodo-adapter.ts:181`). Those URLs are supposed
  to be permanent. **Therefore the platform address must never be released after a
  custom domain goes primary** — keep the `targetBaseUrl` row and its Traefik route
  for ever, redirecting. This also means "delete the library's platform address to free
  it up" must stay impossible. See C.8.

### C.8 Removal

- **Remove a `redirect` domain**: delete the row, PATCH `docker_compose_domains` without
  it, redeploy. Nothing else moves.
- **Remove the `primary` domain**: this is an address move back to the platform address.
  Run `startAddressMove` with `movedTo = binding.targetBaseUrl` **first**, wait for it to
  be active, and only then drop the host from Coolify. Doing it in the other order takes
  the site down between the two steps.
- **Never free the platform address** (C.7). Removal never touches `targetBaseUrl`.
- **Library teardown**: delete every `evidenceLibraryDomains` row for the library in the
  same path that deletes the application (`convex/evidenceLibraries/teardown.ts`), so a
  deleted library cannot keep a host reserved. This is the bug Dokploy has in HEAD
  (`apps/dokploy/server/api/routers/domain.ts:239-242` cleans up only one of three owner
  kinds).
### C.9 Exact files to change, and the exact Coolify calls

**OpenScholar (`/Users/mcharrad/Documents/Github/openscholar/dev-self`)**

| File | Change |
|---|---|
| `convex/schema.ts` | add `evidenceLibraryDomains` (C.4) with `by_host`, `by_libraryId`, `by_state` |
| `convex/evidenceLibraries/validators.ts` | `evidenceLibraryDomainFields`, the state and failure unions |
| `convex/evidenceLibraries/coolifyClient.ts` | **the main surgery** — see below |
| `convex/evidenceLibraries/addressActions.ts` | add `isUnroutedHostSignal` (pure, testable) beside `isFreeHostSignal`; a plain-HTTP probe beside `probeAddress` |
| **new** `convex/evidenceLibraries/dnsClient.ts` | DoH `A` / `TXT` / `CAA` lookups over `fetch`, two resolvers, pure parsing split from the fetch so it unit-tests |
| **new** `convex/evidenceLibraries/domainActions.ts` (`"use node"` not needed) | `addDomain`, `checkDomain`, `removeDomain` — the four gates of C.5 |
| `convex/evidenceLibraries/mutations.ts` | transactional claim of `host` with the `by_host` re-check, mirroring `reserveAddress` (`addressActions.ts:222-236`) |
| `convex/evidenceLibraries/versions.ts` | `startAddressMove` gains a custom-domain caller; keep `expectedBaseUrl` semantics |
| `convex/evidenceLibraries/teardown.ts` | delete domain rows with the library |
| `lib/evidence-libraries/configuration/section-registry.ts` | **no change** — see the note below |
| `components/evidence-libraries/configuration/configuration-workspace.tsx` | add `"domain"` to `RailKey` and `RAIL_GROUPS` (`:115-181`) exactly like `"team"` and `"versions"` |
| **new** `components/evidence-libraries/configuration/sections/domain-section.tsx` | port `mock/config/domain-section.tsx`, changing only the CNAME value |
| `messages/*.json` (6 locales) | the `domain` block already drafted on the mock branch |

**Domain is not a configuration section.** `SECTION_REGISTRY`
(`lib/evidence-libraries/configuration/section-registry.ts:33-200`) maps each section to a
**pointer into the pinned runtime schema** (`/identity`, `/theme`, `/services`, …). The
runtime has no `/domain`, and the mock says so in its own header comment
(`lib/evidence-libraries/mock/config.ts:1-5`: "everything else (domain, team, versions,
share image, legal files) is OpenScholar-side"). So the Domain section gets a place in the
page rail and its own Convex table, but it must **not** be added to `SECTION_REGISTRY`, must
not go through `validateOwnerSections`, and must not become a
`evidenceLibraryConfigSections` row. Its only effect on the runtime is indirect: making a
domain primary rewrites `identity.baseUrl` through the existing address-move path (C.7).

The real page already has the pattern for this. `configuration-workspace.tsx:115-181`
declares `type RailKey = PageSectionKey | "versions" | "team" | "danger"` — three rail
entries that are **not** configuration sections. `domain` becomes the fourth, with no new
machinery.

Note the mock lists `domain` in `DRAFT_SECTIONS` (`config.ts:358-375`, "sections that live
in the draft and take part in Save / Activate"). That is a mock-store convenience, not a
schema statement — the same list includes `team`, which is equally OpenScholar-side. Treat
domain changes as their own operation, not part of Save/Activate.

**`coolifyClient.ts` — the five places that assume one domain**

`hasExpectedComposeDomain` (`:806-813`) currently demands exactly one key and one exact
string. Replace it with a set comparison over the comma-separated list:

```ts
function composeDomainHosts(domains: Record<string, ComposeDomain> | null): Set<string> {
  const web = domains?.web?.domain;
  if (!web) return new Set();
  return new Set(web.split(",").map((entry) => entry.trim()).filter(Boolean));
}

function hasExpectedComposeDomains(
  domains: Record<string, ComposeDomain> | null,
  expected: readonly string[],
): boolean {
  const actual = composeDomainHosts(domains);
  return (
    domains !== null &&
    Object.keys(domains).length === 1 &&
    actual.size === expected.length &&
    expected.every((domain) => actual.has(domain))
  );
}
```

Then update the five call sites (`:841`, `:863`, `:875-895`, `:924`, `:1776`) to take a
`readonly string[]` instead of a `publicDomain: string`. `requirePublicDomain`
(`:316-338`) must additionally **lowercase the host** before returning, because Coolify
does not normalise compose domains (A.7.4).

`requestCoolify` (`:443-449`) turns a 409 into a generic
`COOLIFY_REQUEST_FAILED` / "Coolify rejected the request". Add an `allowConflict` flag
so an attach can report "That domain is already used by another site" instead.

**The Coolify calls, exactly**

Attach a verified domain (one PATCH, always the complete map, platform address first
so it keeps loop index 0 and its existing Traefik router names):

```http
PATCH /api/v1/applications/{applicationUuid}
Authorization: Bearer {EL_COOLIFY_TOKEN}
Content-Type: application/json

{
  "docker_compose_domains": [
    { "name": "web",
      "domain": "https://hello-lib.opendev.space,https://evidence.customer.org" }
  ],
  "force_domain_override": false,
  "instant_deploy": false
}
```
Expect `200 {"uuid": "..."}`. A `409` means another Coolify resource holds the host →
mark the row `failed` / `host-taken`. A `422` means our normalisation was wrong.

Then re-read and assert, then deploy through the existing publish pipeline
(`configurationDeploymentActions.ts`). **The domain is not live until that deploy
finishes** — Coolify bakes Traefik labels into the container (A.6).

Remove a domain — same call with the platform address alone:

```json
{ "docker_compose_domains": [ { "name": "web", "domain": "https://hello-lib.opendev.space" } ],
  "force_domain_override": false, "instant_deploy": false }
```

Never send `"redirect"`. Never send `domains` (hard 422 for compose apps). Never set
`force_domain_override: true`.

**Runtime (`/Users/mcharrad/Documents/Github/new-el-optimize`): no changes needed.**
`getCanonicalLibraryRedirect` (`src/lib/runtime-routing.ts:62-91`) already produces both
toggle states from `identity.baseUrl` alone (C.7). The only runtime work would be if the
user wants two hosts served **without** a redirect — which we should not do (duplicate
content, split analytics, split DOI landing pages).

**Infrastructure, one-off:** add `cname.opendev.space` as a grey-clouded (DNS-only) A
record to the Coolify server in the `opendev.space` Cloudflare zone.

**Deployability gate for plan 16.** `npm run convex:push` from `dev-self` ending in
`✔ Convex functions ready!`, then attach a real test domain to a development library and
show: the DoH check moving `added → pointing → verified`, the PATCH returning 200, the
deploy finishing, `https://<test domain>/api/library-config/health` returning our JSON
with the expected revision, and the platform address 308-ing to it after the toggle.
`npm run logs:convex` open throughout, with no matching failure.

## D. Risks and open questions

### Decisions only the user can make

1. **Grey-clouded target, or Cloudflare for SaaS (C.2).** A plain CNAME cannot hide the
   IP. Cloudflare for SaaS can, and is **free up to 100 custom hostnames** then $0.10 each
   per month — far cheaper than assumed, and it also removes our Let's Encrypt rate-limit
   exposure entirely. **Ask before writing plan 16.** Everything else in section C works
   either way.
2. **The mock's CNAME value must change** from the library's own address to a stable,
   DNS-only, per-library alias (C.1, C.1a). The mock is binding, so this needs a yes.
3. **The redirect toggle reading** (C.7): on = the custom domain becomes the library's
   address; off = attached and redirecting to the platform address. No mock change needed,
   but confirm.

### Real risks

4. **Certificate Transparency publishes our customer list.** Every publicly trusted
   certificate is logged. A Traefik certificate for `evidence.customer.org` puts that
   hostname permanently on crt.sh, searchable by anyone. For a platform whose customers are
   named institutions this is a genuine disclosure. **Issue one certificate per hostname and
   never SAN several tenants together** — Cloudflare warns about exactly this: *"If your
   domain is included in a shared certificate, you may receive notifications for domains or
   subdomains that do not belong to you but are included as subject alternative names."*
   This risk exists under Cloudflare for SaaS too. It is inherent to public TLS.
5. **Historical DNS may already hold our origin IP.** Cloudflare's own guidance: *"Once
   onboarded, rotate your origin IPs, as DNS records are in the public domain. Historical
   records are kept and would contain IP addresses prior to joining Cloudflare."* If the
   IP has ever been in a DNS-only record, orange-clouding today does not un-publish it —
   only a new IP does. Worth one check against passive-DNS before promising anything about
   IP secrecy.
6. **The 5-authorisation-failures-per-identifier-per-hour limit has no override** (C.6.3),
   and Coolify shares one ACME account across the whole server with **no error surface at
   all** (A.5). Our post-deploy HTTPS health probe is the only certificate signal that
   exists. Never attach an unverified host.
7. **A domain change needs a full redeploy** (A.6, B.4 — Traefik has no on-demand TLS), so
   attaching takes as long as a publish and can fail for unrelated reasons. The UI must not
   imply "Check DNS" makes the site live.
8. **`reconcileDockerComposeDomains` prunes domains when the compose file changes**
   (A.7.6). If `new-el` renames the `web` service, every library silently loses every
   domain. Add an assertion that the bound application still has exactly the `web` key.
9. **A second exposed port on the `web` service breaks routing for every library** (A.3),
   because compose apps get no `loadbalancer.server.port` label. Belongs as a note in the
   runtime repo, not only here.
10. **`identity.baseUrl` is the NextAuth origin and the DOI landing-page base** (0d).
    Flipping it signs everyone out and orphans registered DOI URLs unless the platform
    address redirects for ever. Plan 16 must forbid ever releasing a platform address that
    has served a primary custom domain.
11. **Coolify's uniqueness is per-team and advisory** (A.2), and its DB unique index was
    dropped. Our `by_host` index plus `listServedHosts()` is the real gate; do not rely on
    Coolify's 409.
12. **Route 53 and Azure DNS customers cannot use a bare apex with us** (C.3), and those
    are exactly where university and NGO zones live. Expect this in support from week one;
    have the `www` wording ready.

### Unverified — check before or during plan 16

13. **Does the self-hosted Convex backend allow outbound DoH?** It makes outbound HTTPS
    calls to Coolify and GitHub, so almost certainly yes, but confirm with one throwaway
    action. `node:dns` is separately unverified and has no precedent in this repo (only
    `node:crypto` is used anywhere in `convex/`).
14. **Whether HTTP-01 can ever succeed through a Cloudflare-proxied CNAME target.** Two
    independent lines of reasoning say no and my measurement 0b.3 supports it, but no
    first-party document states it outright. **Prove it on a throwaway domain before
    committing**, since the whole grey-cloud decision rests on it.
15. **Cloudflare's `/.well-known/acme-challenge/` pass-through behaviour** is
    community-sourced, not first-party-documented. The common real-world breakage is a
    cached 404 on the challenge path, fixed with a Cache Rule bypass. Only matters if we
    choose Cloudflare for SaaS.
16. **Punycode.** Undecided whether we accept internationalised domains. Dokploy's
    one-liner (`new URL("http://" + host).hostname`, `traefik/domain.ts:126-138`) is the
    cheap answer; Coolify does not punycode at all. Pick one and write it down.
17. **Coolify's 4-hex-character service-name hash** (`docker.php:19-22`) is a 16-bit hash.
    Irrelevant with one service called `web`; do not add compose services casually.
18. **Vercel's DNS re-check interval** is not published, so there is no industry number to
    anchor our recheck sweep against. Dub's hourly cron with `take: 30` and a 14/28/30-day
    reminder-and-delete lifecycle (B.3) is the best documented model to copy.
