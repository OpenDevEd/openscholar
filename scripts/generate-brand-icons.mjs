#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "public/icon.svg"));

async function transparentPng(size) {
  return sharp(source).resize(size, size, { fit: "contain" }).png().toBuffer();
}

async function whiteCanvasPng(size) {
  const innerSize = Math.round(size * 0.75);
  const inset = Math.floor((size - innerSize) / 2);
  const icon = await transparentPng(innerSize);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite([{ input: icon, left: inset, top: inset }])
    .png()
    .toBuffer();
}

function ico(frames) {
  const directorySize = 6 + frames.length * 16;
  const header = Buffer.alloc(directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  let offset = directorySize;
  frames.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, ...frames.map(({ data }) => data)]);
}

const faviconFrames = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, data: await transparentPng(size) })),
);

const outputs = [
  ["app/icon0.svg", source],
  ["app/icon1.png", await transparentPng(96)],
  ["app/favicon.ico", ico(faviconFrames)],
  ["app/apple-icon.png", await whiteCanvasPng(180)],
  ["public/web-app-manifest-192x192.png", await whiteCanvasPng(192)],
  ["public/web-app-manifest-512x512.png", await whiteCanvasPng(512)],
];

for (const [relativePath, data] of outputs) {
  await writeFile(path.join(root, relativePath), data);
  console.log(`Generated ${relativePath}`);
}
