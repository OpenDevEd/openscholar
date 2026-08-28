# Plan 16 — Custom domains

## Goal

An owner can give a library their own web address (for example
`evidence.example.org`). They add one CNAME to `cname.openscholar.ai` and a
TXT record, press "Check DNS", and the library answers on that address with
a valid certificate. The platform's server address is never shown or
needed. A toggle sends the platform address to the custom domain.

Research behind this plan: `16-RESEARCH.md` in this folder (Coolify 4.3.12,
Dokploy, Vercel, Dub, the Caddy on-demand family, and live measurements
against our own setup on 2026-08-28). Read it before touching code.

## Decisions (made with the user on 2026-08-28)

1. **Cloudflare for SaaS, with a proxied target.** A customer CNAME to any
   proxied (orange-cloud) `opendev.space` name is refused at Cloudflare's
   edge unless that hostname is registered as a *custom hostname* in our
   account (research 0b.3, C.6.1). So OpenScholar registers each attached
   domain as a custom hostname through the Cloudflare API on attach and
   removes it on detach. Cloudflare issues and renews the certificate; the
   origin IP never appears in any DNS answer; free up to 100 hostnames,
   then $0.10 per hostname per month. The customer's job is one CNAME plus
   one TXT, the same as on any other platform — this is our own account,
   not a dependency on the customer's DNS provider.
2. **The CNAME target is `cname.openscholar.ai`** (proxied), in the
   `openscholar.ai` zone, which is on Cloudflare Enterprise (a grant covers
   it; decided with the user on 2026-08-28). Custom hostnames must live in
   the zone that hosts the target, and owners recognise the brand in their
   DNS. Enterprise also gives each custom hostname a **custom origin**: the
   origin is set to the library's own platform address
   (`<slug>-lib.opendev.space`) with matching SNI, so Traefik serves the
   certificate it already has and no Let's Encrypt issuance happens for
   custom domains at all. The platform addresses stay on `opendev.space`.
   Previously written as `cname.openscholar.ai`; superseded. Not the
   library's own `<slug>-lib.opendev.space`: the platform may move a
   library to another address by itself (plan 11), which would break a
   customer's CNAME. The agreed mock keeps its shape (a CNAME row and a
   TXT row); only the CNAME value changes.
3. **Apex domains.** A bare `example.org` cannot carry a CNAME (RFC 1034
   §3.6.2, RFC 1912 §2.4). Owners whose DNS host offers CNAME flattening,
   ALIAS or ANAME may use the apex; the verification is behavioural, so it
   passes. Everyone else (Route 53, Azure DNS, most enterprise DNS) is told
   to use `www.example.org` or `library.example.org` and forward the apex
   at their registrar. A bare apex that does not resolve to our target is
   refused with that wording, not worked around.
4. **States**: `added` → `pointing` → `verified` → `active`, or `failed`
   with a reason. Stored on a new table `evidenceLibraryDomains`, one row
   per hostname, unique by host across the platform. Roles `primary` and
   `redirect` (a `www` alias 308s to the primary through the runtime's
   existing canonical-host redirect). The platform address stays on the
   runtime binding and is never a row here.
5. **Verification without any DNS-provider API.** Four gates, each one
   behaviour any customer can produce; a gate that cannot run never
   advances and never fails (`check-failed`, like `AddressCheckError`):
   1. the host is free: not in our table (`by_host`), not among the hosts
      Coolify serves (`listServedHosts`);
   2. DNS-over-HTTPS (`fetch`, two resolvers — Cloudflare and Google —
      that must agree): an `A` query for the host shows a CNAME to
      `cname.openscholar.ai` in the chain, or resolves to the same address
      set as the target (flattened apex) → `pointing`; NXDOMAIN →
      `no-records`, elsewhere → `wrong-target`; also a `CAA` scan on the
      host and its parents: if any `issue` value exists and none permits
      Cloudflare's CA (`letsencrypt.org`, `digicert.com`, `pki.goog`,
      `sectigo.com` — read the current list from Cloudflare's docs at
      implementation time), fail with the record to add;
   3. `TXT _openscholar.<host>` equals `os-verify=<token>` → `verified`
      (the TXT lives at a different name so an owner with a live site can
      prove ownership before cutting over);
   4. attach: create the Cloudflare custom hostname (HTTP DCV), PATCH the
      Coolify compose domains with the complete list (platform address
      first), deploy through the existing publish pipeline, then the
      existing `probeEvidenceLibraryAddress` + `requireActiveRevision`
      against `https://<host>/api/library-config/health` must answer
      `ours` with the live revision → `active`. Certificate status is
      read from the custom hostname (`ssl.status`) and shown as the "TLS"
      chip the mock already draws.
   Plan 11's "no DNS lookups" rule was about our own wildcard zone, where
   every name resolves the same; it does not apply to a customer's zone,
   where the CNAME is exactly the signal. Say so in the code comment.
6. **Rechecks.** "Check DNS" is manual, as in the mock. A scheduled sweep
   re-probes `active` rows and marks `failed` when the CNAME or the health
   answer is gone; the row keeps its history (`checkedAt`, `failure`).
7. **The redirect toggle is the runtime's canonical host.** Off: the custom
   domain is served and 308s to the platform address (a useful "see it
   work first" state). On: `startAddressMove` (plan 11 machinery) rewrites
   `identity.baseUrl` to the custom domain and publishes; the platform
   address then 308s to it. No Traefik redirect labels; Coolify's
   `redirect` field stays unused. The confirm dialog says visitors will be
   signed out (the base URL is the runtime's auth origin).
8. **The platform address is never released** once a custom domain has
   been primary: DOI landing pages registered with Crossref/Zenodo point at
   `identity.baseUrl` at the time of registration and must keep redirecting.
   Removing the primary domain is an address move back to the platform
   address first, then detach. Library teardown deletes the rows and the
   custom hostnames.
9. **Coolify.** `docker_compose_domains` is always sent as the complete
   map for `web`, platform address first (index 0 keeps its Traefik router
   names), custom hosts appended in one comma-separated string, lower-cased
   on our side (Coolify does not normalise compose domains); never
   `redirect`, never `domains`, never `force_domain_override: true`. A
   `409` means another Coolify resource holds the host → `host-taken`.
   `hasExpectedComposeDomain` and its five call sites become a set
   comparison over the list.
10. **Domain is a rail entry, not a configuration section.** It joins
    `team`, `versions` and `danger` in the rail; it is not in
    `SECTION_REGISTRY`, not validated by `validateOwnerSections`, not a
    draft row, and not part of Save/Activate. Its own actions apply
    immediately (add, check, attach, toggle, remove).
11. **Cloudflare client**: one small module (`cloudflareSaasClient.ts`) for
    `POST/GET/DELETE /zones/{zone}/custom_hostnames`, token and zone id
    from platform env (`EL_CLOUDFLARE_API_TOKEN` with the SSL-for-SaaS
    permission, `EL_CLOUDFLARE_ZONE_ID`), never exposed to the browser. When
    the env is missing, the Domain section says "Custom domains are not set
    up on this platform yet" and adds nothing.

## Facts checked on 2026-08-28

- Every `opendev.space` name is proxied through Cloudflare; the edge
  refuses TLS for hostnames outside any Cloudflare zone (research 0b).
- Coolify: compose domains are a JSON string keyed by service, written as
  an array of `{ name, domain }`; a PATCH replaces the whole map; a domain
  change needs a redeploy; no DNS check or certificate error surface exists
  in the API (research A). We already read and write this shape in
  `convex/evidenceLibraries/coolifyClient.ts`.
- The address check pipeline (`addressActions.ts`), the ownership probe
  (`readinessClient.ts`) and the address-move operation (`versions.ts`
  `startAddressMove`) already exist and are reused, not rebuilt.
- The agreed mock: `git show origin/feat/library-interface-mock:components/evidence-libraries/mock/config/domain-section.tsx`
  and the `evidenceLibraryMock.config.domain` copy. Binding, except the
  CNAME value.
- Cloudflare for SaaS: custom hostnames API, HTTP or TXT DCV, `ssl.status`
  lifecycle, fallback origin; pricing page dated 2026-08-14.

## Lanes

| Lane | Repo | Branch | Owns |
|---|---|---|---|
| D · Domains | openalex-count | `codex/custom-domains` | `convex/schema.ts` (new table), `convex/evidenceLibraries/{validators,coolifyClient,addressActions,domainActions,dnsClient,cloudflareSaasClient,mutations,versions,teardown}.ts` and tests, `components/evidence-libraries/configuration/sections/domain-section.tsx` (new), `configuration-workspace.tsx` (rail), `messages/*.json` `evidenceLibraryConfiguration.domain` |

The runtime needs no change (the canonical-host redirect already produces
both toggle states). Infrastructure, by the integration owner before the
gate: a proxied `cname.openscholar.ai` CNAME target and a proxied fallback
origin in the `opendev.space` zone, Cloudflare for SaaS enabled on the
zone, an API token scoped to SSL and Certificates: Edit on that zone, set
as `EL_CLOUDFLARE_API_TOKEN` + `EL_CLOUDFLARE_ZONE_ID` on the shared
deployment (and on the lane for the lane gate).

## Test-first steps

1. `dnsClient.test.ts`: pure parsing of DoH JSON (chain with CNAME, flattened
   apex, NXDOMAIN vs NODATA, TXT quote stripping, Google's trailing dots,
   CAA scan) and the two-resolver agreement rule; the fetch is injected.
2. `addressActions.test.ts`: `isUnroutedHostSignal` is not needed under
   Cloudflare for SaaS (the edge answers, not Traefik) — delete that idea;
   instead a pure `classifyCustomHostnameStatus` for Cloudflare's
   `status`/`ssl.status` values.
3. `domainActions.test.ts`: the state machine — each gate's pass and each
   failure reason, `check-failed` on transport errors, host uniqueness in
   the mutation transaction, attach builds the complete Coolify map with
   the platform address first, remove sends the platform address alone,
   primary removal moves the address back first.
4. `coolifyClient.test.ts`: `hasExpectedComposeDomains` set comparison,
   lower-casing, 409 → conflict.
5. `cloudflareSaasClient.test.ts`: request shapes and status mapping; the
   fetch is injected.
6. `versions.test.ts`: toggle on = address move to the custom domain;
   toggle off = move back; `identity.baseUrl` validated with the new
   `expectedBaseUrl`.
7. `teardown.test.ts`: rows and custom hostnames removed with the library.
8. Component test for the section: records table shows the CNAME to
   `cname.openscholar.ai` and the TXT with the library's token; the state
   chips; the toggle disabled until verified; apex wording when the host
   has no dots beyond the registrable domain.
9. Workspace test: "Domain" in the rail under Publishing with its dot.

## Deployability gate

- `npx tsc --noEmit`; the vitest sets above; `npx convex dev --once` on the
  lane with the two Cloudflare env values set there; a browser check on the
  lane port of the section with a fake host (records shown, Check DNS →
  `no-records`).
- Integration owner, on the shared platform with a real test domain the
  user provides: `npm run convex:push`; attach the test domain to a
  throwaway library: `added → pointing → verified` from the DoH checks,
  the custom hostname created (`ssl.status` reaches `active`), the Coolify
  PATCH 200, the deploy finishing, `https://<test domain>/api/library-config/health`
  answering `ours` with the live revision; toggle on → the platform address
  308s to the custom domain; toggle off → the reverse; remove → the
  hostname deleted, DNS answers 1001 again. `npm run logs:convex` open
  throughout. Tear the library down.

## Known risks

- Certificate Transparency publishes every custom hostname (inherent).
- Cloudflare's brief window between routing and `ssl.status: active`
  shows a TLS error; the section shows "Certificate pending" until the
  status is active.
- Customers who put their own proxy in front (their Cloudflare orange
  cloud) fail gate 2 with a distinct message ("Your domain is behind
  another proxy. Turn the proxy off for this record.").
- `reconcileDockerComposeDomains` drops every domain if the compose
  service is renamed; assert the `web` key on every read.
- Origin TLS: each custom hostname is created with a custom origin (the
  library's platform address) and origin SNI set to it — an Enterprise
  feature of Cloudflare for SaaS — so the runtime serves its existing
  platform certificate and Traefik never attempts Let's Encrypt for the
  custom hostname. Lane D confirms the exact API fields
  (`custom_origin_server`, `custom_origin_sni`) against Cloudflare's docs
  and writes them here.

## Files that change

Lane D: `convex/schema.ts`, `convex/evidenceLibraries/validators.ts`,
`coolifyClient.ts`, `addressActions.ts`, `domainActions.ts` (new),
`dnsClient.ts` (new), `cloudflareSaasClient.ts` (new), `mutations.ts`,
`versions.ts`, `teardown.ts`, `runtimeActionConfig.ts` (env), their tests,
`components/evidence-libraries/configuration/sections/domain-section.tsx`
(new), `configuration-workspace.tsx`, `messages/*.json`.
