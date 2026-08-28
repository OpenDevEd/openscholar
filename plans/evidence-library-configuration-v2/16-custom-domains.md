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
   origin IP never appears in any DNS answer; the `openscholar.ai` zone is
   on an Enterprise plan the user's grant covers, so hostnames cost
   nothing extra. The customer's job is one CNAME plus
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
   Previously written as `cname.opendev.space`; superseded. Not the
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
origin in the `openscholar.ai` zone, Cloudflare for SaaS enabled on that
zone, an API token scoped to SSL and Certificates: Edit on it, set as
`EL_CLOUDFLARE_API_TOKEN` + `EL_CLOUDFLARE_ZONE_ID` on the shared
deployment. `EL_CUSTOM_DOMAIN_TARGET` names the target and defaults to
`cname.openscholar.ai`; nothing hard-codes a domain.

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
- **Origin TLS — answered in lane D (2026-08-28).** Each custom hostname is
  created with `custom_origin_server` set to the library's own platform
  address (`<slug>-lib.opendev.space`). Cloudflare documents the default
  origin SNI as *"the value of the SNI will be that of the custom origin and
  the `Host` header will be the original custom hostname"*, which is exactly
  what we need: the runtime is asked for the certificate it already holds
  for its platform address, and the customer's name arrives in the `Host`
  header, which is what the proxy routes on. The explicit `custom_origin_sni`
  field is **not** sent: Cloudflare only accepts `":request_host_header:"`
  or a name inside our own zone there, and both are wrong here. Omitting it
  is the documented way to get the SNI we want.
  Source: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/custom-origin/
  What is still unproven, and what the integration owner must watch at the
  shared gate: Coolify writes a Traefik router with its Let's Encrypt
  certificate resolver for **every** compose domain, so Traefik may still
  order its own certificate for the custom hostname over HTTP-01. That
  request is not needed and nothing depends on it. It is bounded by the
  gates: a host only reaches Coolify after the address and ownership
  records pass, so Traefik never retries a name that does not point at us,
  and the five-authorisation-failures-per-hour cap is never approached.
  The lane could not test this — the lane has no Cloudflare credentials.
- The CAA gate accepts `pki.goog`, `letsencrypt.org`, `ssl.com`,
  `sectigo.com` and `digicert.com`. Cloudflare issues custom hostname
  certificates from Google Trust Services, Let's Encrypt, SSL.com and
  Sectigo and falls back between them, so any one of these being permitted
  is enough. Source:
  https://developers.cloudflare.com/ssl/edge-certificates/caa-records/

## Decisions taken during lane D

These correct or complete the decisions above. Each one is a change to the
plan, not a silent difference.

1. **The toggle does not use `startAddressMove`.** That function moves the
   *platform* address: it rewrites `targetBaseUrl` and Coolify's domain.
   Decision 8 forbids ever releasing a platform address, so the toggle
   instead writes a new `canonicalBaseUrl` on the runtime binding, which is
   the address `identity.baseUrl` must equal. `targetBaseUrl` never moves.
   Everything that computed `expectedBaseUrl` from `targetBaseUrl` now reads
   `canonicalBaseUrl ?? targetBaseUrl`, and a later platform address move
   leaves `identity.baseUrl` alone while a custom domain is primary.
2. **A publish is queued with a new `domainChange` operation field**
   (`{ host, reason: attach | detach | canonical }`), beside `addressMove`.
   Coolify writes the proxy rules into the container, so a domain only goes
   live through a deployment.
3. **`attachedAt` on the domain row.** Whether the proxy holds a host is
   kept apart from the row's state, so a failed check can never make the
   platform forget a host Coolify is already serving.
4. **Coolify assertions.** Only the new `setCustomDomains` compares the
   whole set. The five existing call sites require the platform address to
   be **first** in the list and leave later entries alone; `applicationPatch`
   and `setApplicationDomain` keep the hosts already there. Demanding an
   exact set everywhere would have made every ordinary deployment fail for a
   library with a custom domain.
5. **Removing the primary domain is refused**, with "Send the platform
   address back to itself before removing this domain", rather than moving
   the address back on the owner's behalf. One clear owner step instead of a
   hidden two-phase operation.
6. **No separate `behind-proxy` failure.** Another proxy in front cannot be
   told apart from a wrong record without vendor IP lists, which the
   research rules out. The `wrong-target` message names both possibilities.
7. **Gate 4a (the plain-HTTP `404 page not found` probe) is not built.**
   Under Cloudflare for SaaS the edge answers the custom hostname, not
   Traefik, so that signal never appears. Gate 4b — our own health answer
   with the live revision — is the proof, and it is stronger.
8. **International domains must be given in punycode.** Only ASCII host
   names are accepted; every domain host shows the `xn--` form.
9. **The queries and mutations live in a new `convex/evidenceLibraries/domains.ts`**,
   not in `mutations.ts`, which is already long and shared with other lanes.
10. **The rail entry sits in the existing `platform` group**, beside
    Versions. The page has no "Publishing" group.

11. **The sweep of decision 6 runs every six hours**, twenty rows at a
    time, over `by_state` eq `active`. It only ever moves a working domain
    off `active`; a sweep that could not run leaves the row untouched, and
    the row keeps `activatedAt` and its history.


## Corrections after review (2026-08-28)

A review of the branch found fourteen blocking problems. The fixes changed
these decisions.

12. **Nothing outside OpenScholar is touched before a removal is allowed.**
    Removing the domain a library calls its own is refused first, in a
    mutation, before the proxy or the certificate service hears about it.
    The old order took a live site down and then refused the request.
13. **Removal is staged.** The proxy loses the host, the deployment applies
    it, and only when that deployment is live do the certificate and the row
    go. Until then the row shows "Removing". A removal that stops halfway
    keeps every receipt, so pressing again carries on.
14. **Attach saves each receipt as it happens.** The certificate hostname id
    is written before the proxy is touched, so a failure can never leave a
    hostname nothing points back to. Every step is safe to run again.
15. **The library's new address is written only after readiness passes.**
    `setDomainPrimary` writes nothing: the desired address travels on the
    operation, the deployment carries it, and `completeDomainChange` writes
    the binding, the draft, the live revision and the roles once the site
    answers. A failed deployment leaves nothing changed.
16. **Readiness reads the address the library calls its own**, and separately
    requires the platform address to redirect to it. The platform address is
    never released, so it has to keep sending visitors on. The same address
    is used for the `/admin` login link and the public link on the libraries
    list.
17. **Every request to a custom domain repeats the address gate first**, and
    refuses any address that is not on the public internet. An owner can
    repoint their records at any moment; without this a verified domain
    could be aimed inside our own network.
18. **Check is limited and locked.** One check per domain at a time, and
    three token buckets: per owner, per library, per domain.
19. **A check that could not run writes nothing at all.** It answers
    `check-failed` and the row keeps exactly what the last check that did run
    found. The old code stored `failed`.
20. **Coolify's map is compared in full, against our own records.** A map
    that is not exactly `{web}` reads as unreadable rather than empty, so no
    write can replace it. The list of custom domains travels with the
    deployment target, so an ordinary publish can neither drop a custom
    domain nor accept a stranger's.
21. **The sweep pages by oldest check** over `by_state_and_checkedAt`, moves
    a working domain's check time forward too, stops at a fixed deadline and
    schedules the next page.
22. **NXDOMAIN and NODATA are different answers.** A name that does not exist
    fails with `no-name` ("We could not find that domain"); a name with no
    address record fails with `no-records`.
23. **A flattened apex must answer with the target's whole address set.** One
    address in common proves nothing on a shared proxy.
24. **`CAA 0 issue ";"` blocks issuance.** An empty issuer value is kept and
    permits nobody.
25. **Host names are strict LDH.** No underscores, no reserved `ab--` form,
    punycode endings accepted, and the platform's own domains and everything
    beneath them refused.
26. **The section follows the mock.** The mock's five status words, its
    records table, its panel and its toggle. Two honest differences: every
    stored domain is drawn, with Add offered until the limit; and a failed
    check names what actually went wrong instead of always saying "Records
    not found".

## Files that change

Lane D: `convex/schema.ts`, `convex/evidenceLibraries/validators.ts`,
`coolifyClient.ts`, `addressActions.ts`, `domainActions.ts` (new),
`dnsClient.ts` (new), `cloudflareSaasClient.ts` (new), `mutations.ts`,
`versions.ts`, `teardown.ts`, `runtimeActionConfig.ts` (env), their tests,
`components/evidence-libraries/configuration/sections/domain-section.tsx`
(new), `configuration-workspace.tsx`, `messages/*.json`.
