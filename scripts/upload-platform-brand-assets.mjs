#!/usr/bin/env node
/**
 * Put the canonical OpenScholar logo and browser icons into the platform
 * bucket so libraries without their own uploads can use the full icon set.
 *
 * Run from the integration checkout after generating the icons, then set the
 * three values it prints
 * on every Convex deployment that creates or updates libraries:
 *
 *   EL_STORAGE_URL=... EL_STORAGE_SERVICE_KEY=... node scripts/upload-platform-brand-assets.mjs
 *
 * Read the two inputs with `npx convex env get EL_STORAGE_URL` and
 * `npx convex env get EL_STORAGE_SERVICE_KEY`. The files go under
 * `platform/` in the public `openscholar` bucket, next to the per-library
 * folders (`lib/evidence-libraries/configuration/uploads.ts`). The addresses
 * are plain https, have no query string and use formats supported by the
 * Evidence Library runtime.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = "openscholar";
const ASSETS = [
  {
    env: "EL_DEFAULT_LOGO_URL",
    file: "public/icon.svg",
    key: "platform/openscholar-logo.svg",
    contentType: "image/svg+xml",
  },
  {
    env: "EL_DEFAULT_FAVICON_URL",
    file: "app/favicon.ico",
    key: "platform/openscholar-favicon.ico",
    contentType: "image/x-icon",
  },
  {
    runtimeIcon: true,
    file: "app/icon0.svg",
    key: "platform/openscholar-icon.svg",
    contentType: "image/svg+xml",
  },
  {
    runtimeIcon: true,
    file: "app/icon1.png",
    key: "platform/openscholar-icon-96.png",
    contentType: "image/png",
  },
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
  return value;
}

const storageOrigin = new URL(requireEnv("EL_STORAGE_URL")).origin;
const serviceKey = requireEnv("EL_STORAGE_SERVICE_KEY");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const lines = [];
const iconUrls = [];
for (const asset of ASSETS) {
  const body = await readFile(path.join(root, asset.file));
  const response = await fetch(
    new URL(`/storage/v1/object/${BUCKET}/${asset.key}`, storageOrigin),
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "cache-control": "public, max-age=31536000, immutable",
        "content-type": asset.contentType,
        "x-upsert": "true",
      },
      body,
    },
  );
  if (!response.ok) {
    console.error(
      `Upload of ${asset.file} failed: ${response.status} ${await response.text()}`,
    );
    process.exit(1);
  }
  const url = `${storageOrigin}/storage/v1/object/public/${BUCKET}/${asset.key}`;
  if (asset.env) lines.push(`npx convex env set ${asset.env} ${url}`);
  if (asset.runtimeIcon) iconUrls.push(url);
  console.log(`${asset.file} -> ${url}`);
}
lines.push(
  `npx convex env set EL_DEFAULT_ICON_URLS_JSON '${JSON.stringify(iconUrls)}'`,
);

console.log("\nSet these on each Convex deployment that creates or updates libraries:");
for (const line of lines) console.log(`  ${line}`);
