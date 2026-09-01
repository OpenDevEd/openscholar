# Custom domains

## Outcome

An Evidence Library owner can attach up to five domains without exposing the
origin server or asking OpenScholar to manage certificates itself.

The owner points each domain at `cname.openscholar.ai`. Public DNS resolves to
the Hetzner load balancer. Traefik receives the host through the library
application's domain configuration and issues its certificate with the
`letsencrypt` resolver.

## Decisions

- Use the existing Coolify application-domain API. It already writes the
  Traefik host rule and `tls.certresolver=letsencrypt` labels.
- Do not use Cloudflare for SaaS or the Cloudflare custom-hostname API.
- Keep Cloudflare DNS-only on `cname.openscholar.ai`. Customer domains may be
  ordinary CNAME records.
- Do not expose the origin address in customer-facing DNS.
- Require one TXT ownership record per authoritative DNS zone before attaching
  any host in that zone.
- Permit only `letsencrypt.org` when a domain publishes CAA records.
- Treat a successful HTTPS health response with the active revision as proof
  that both TLS and routing work.
- Keep the load balancer, rather than an origin server, as the public apex
  target.
- **Changed 2026-09-01:** support apex domains directly. Show the load
  balancer's configured IPv4 address as an `A` record, suggest the `www`
  counterpart, and use the existing domain roles and runtime `308` redirect
  for apex-to-`www`. This replaces the earlier flattening-only guidance because
  the stable Hetzner load balancer can safely own the public address without
  exposing an Evidence Library server.
- **Changed 2026-09-01:** place the ownership TXT at the authoritative zone
  apex and show it once. The same record verifies the apex and `www`, matching
  GitHub Pages' zone-level ownership model. This replaces the earlier
  per-host TXT because it made owners add duplicate proof for one DNS zone.
- Domains inside a shared hosted zone are unsupported when the owner cannot
  add a TXT at that zone's apex. Public suffixes are never accepted as
  verification zones.
- This is pre-production. The old certificate fields and cleanup state are
  removed rather than migrated or kept for compatibility.

## Owner flow

1. The owner enters a domain.
2. OpenScholar rejects invalid, reserved, already claimed, or already served
   hosts.
3. OpenScholar shows the record that matches the host:
   - apex: `A <host> <EL_CUSTOM_DOMAIN_APEX_IPV4>`
   - subdomain: `CNAME <host> cname.openscholar.ai`
   - once per authoritative zone:
     `TXT _openscholar.<zone-apex> os-verify=<token>`
     When the host is an apex, OpenScholar recommends adding its `www`
     counterpart. After both domains are active, making `www` canonical uses the
     existing runtime redirect for the apex and every other attached address.
4. **Check DNS** verifies the target, shared zone TXT token, and CAA rules.
5. A second check adds the domain to the library application's complete domain
   list and queues a deployment.
6. After the deployment succeeds, another check makes a pinned HTTPS request.
   The row becomes active only when the response contains the library's active
   revision.
7. The owner may then make the domain canonical. The existing confirmation and
   deployment fencing remain in place.

The UI derives its TLS label from the same state:

- attached and not active: **Certificate pending**
- active: **TLS: Active**

There is no separate platform-readiness banner or certificate-provider status.

## Removal and teardown

Removing a non-canonical domain updates the application's complete domain list
and deploys it. The successful deployment transaction deletes the domain row.
There is no later certificate cleanup action because Traefik owns certificate
lifecycle.

A library teardown passes every confirmed or uncertain domain to the existing
application deletion boundary, deletes the application, and then deletes the
library's Convex rows. A running domain change still blocks teardown until it
finishes or loses its lease.

## Data contract

`evidenceLibraryDomains` keeps:

- host, authoritative verification zone, library, role, and verification token
- state and failure
- attached, removal, and deployment receipts
- transition fencing and generation
- check and activation timestamps
- apex status

It does not keep provider hostname IDs, certificate state, or certificate
cleanup retries.

On 2026-09-01, all four existing shared development rows were backfilled and
verified with their authoritative verification zones. The field is now
required.

## Configuration

Required platform settings:

- `EL_CUSTOM_DOMAIN_TARGET=cname.openscholar.ai`
- `EL_CUSTOM_DOMAIN_APEX_IPV4` for the public load balancer address shown in
  apex DNS instructions
- `EL_RESERVED_DOMAIN_SUFFIXES` for any additional platform-owned suffixes
- the existing Evidence Library runtime settings used by the application-domain
  and deployment clients

No Cloudflare API token or zone ID is required.

## Verification

Focused automated checks cover:

- DNS target, one zone-level TXT, CAA, and resolver agreement
- platform and cross-library host conflicts
- application-domain attach and deployment fencing
- HTTPS revision activation
- canonical switching
- atomic removal after deployment
- teardown and sweep races
- the Domain section's pending and active TLS states

The deployment gate uses both live test names:

- `domain-test.openscholar.ai`
- `domain-test.educationevidence.io`

For each name, verify the owner flow, an exact Let's Encrypt certificate, a
public response through the load balancer, and no origin address in public DNS.
