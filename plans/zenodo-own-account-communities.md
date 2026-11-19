# A community archives in its owner's own Zenodo account (#1237)

Working rules: [AGENTS.md](../AGENTS.md), [docs/agents/project.md](../docs/agents/project.md).

## Problem and decisions

Reports archive in their author's own Zenodo account since #1471: Openscholar keeps the OAuth tokens
(`convex/zenodo`) and renews them before use. A community's records are deposited by its own runtime
(evidence-community's publication worker), which today reads a fixed Zenodo token from its configuration. Zenodo's
OAuth access tokens expire (60 days, measured 2026-11-19) and are renewed with a refresh token that rotates, so a
copied token goes stale and two holders of one refresh token would undo each other.

Decided (2026-11-19):

- Openscholar stays the only holder of a connected account's tokens. The runtime asks Openscholar for a current
  access token before each Zenodo write, and keeps it until five minutes before it expires.
- A community's Publishing settings offer "Your Zenodo account" beside the existing modes. Saving it records whose
  connected account it uses (the person saving, who must have a working connection). Nothing else changes for
  the community: the record keeps its Crossref DOI (`reuse-crossref`).
- A broken or removed connection fails the deposit with a message to reconnect; nothing is deposited in another
  account in its place.
- A community registering DOIs in the Crossref sandbox can't choose it: its deposits would be real zenodo.org
  records carrying test DOIs. On shared dev the option shows, off, with that reason.

## Contract

- Configuration (evidence-community `zenodoPublicationSchema`): `account: "token" | "openscholar"`, default
  `"token"`. With `"openscholar"`, `token` is absent and `environment` is `production`. Openscholar sends the key
  only for a community that chose its own account; a community on a release from before refuses it, so that choice
  waits for its runtime update.
- Endpoint (Openscholar, Convex HTTP): `POST /api/v1/evidence-libraries/zenodo-token`, body `{ libraryId }`, the
  community's machine credential as bearer (as `/reports/records`). Answers `200 { accessToken, expiresAt }`,
  `409 { error: { code: "zenodo_reconnect" } }` when the connection is missing or broken, `401` for a wrong
  credential.

## Scope and owners

- evidence-community: the schema key, one async token reader used by the Zenodo adapter and the activation service,
  its cache, and the reconnect error. Released and rolled out to dev before Openscholar sends the key.
- Openscholar: the settings mode and its owner, the config builder, the endpoint, and the Publishing option
  (the #1237 mock's community part).

## Migration

None: the new key defaults to the current behaviour; existing settings keep their modes.

## Checks

- evidence-community: unit test of the token reader (cache, reconnect); the Zenodo adapter tests with a token from
  Openscholar; fallow; CI's full suite on the branch before merge.
- Openscholar: Convex test of the endpoint (owner's token, broken connection, wrong credential); the config builder
  test; the Publishing option in the browser.
- Live: the endpoint answering a dev community's credential with the connected account's token.

## Completion

Both merged and deployed to shared dev, the dev communities on the release, the endpoint proven live. Risk: a
community whose owner leaves keeps depositing in their account until someone else saves the setting.
