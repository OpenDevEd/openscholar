// Plates: the 9,988 institutions behind the Wealth Inequality library, on a dot-matrix Earth. Data: its /api/institution-locations.
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { plate, haze, develop, save } from "./lib.mjs";

const here = (f) => new URL(f, import.meta.url).pathname;
const places = Object.values(JSON.parse(readFileSync(here("data/institutions.json"))));
const svg = readFileSync(here("data/world.svg"), "utf8").replace(/<svg /, '<svg fill="#fff" ');
const W = 1600, H = 800, { data } = await sharp(Buffer.from(svg), { density: 144 }).resize(W, H).flatten({ background: "#000" }).greyscale().raw().toBuffer({ resolveWithObject: true });
const rad = Math.PI / 180;
// Equal Earth, the projection world.svg is already in (scale 150, centred at 400, 200).
function equalEarth(lon, lat) {
  const A = [1.340264, -0.081106, 0.000893, 0.003796], M = Math.sqrt(3) / 2, t = Math.asin(M * Math.sin(lat * rad)), t2 = t * t, t6 = t2 * t2 * t2;
  return [lon * rad * Math.cos(t) / (M * (A[0] + 3 * A[1] * t2 + t6 * (7 * A[2] + 9 * A[3] * t2))), t * (A[0] + A[1] * t2 + t6 * (A[2] + A[3] * t2))];
}
const land = (lon, lat) => { const [x, y] = equalEarth(lon, lat), px = Math.round((400 + x * 150) * W / 800), py = Math.round((200 - y * 150) * H / 400); return px >= 0 && py >= 0 && px < W && py < H && data[py * W + px] > 90; };

{
  const w = 3000, h = 1460, k = w / 5.5, p = plate(w, h), P = (lon, lat) => { const [x, y] = equalEarth(lon, lat); return [w / 2 + x * k, h / 2 - y * k]; };
  for (let lat = -58; lat < 84; lat += 0.9) for (let lon = -180; lon < 180; lon += 0.9) if (land(lon, lat)) { const [x, y] = P(lon, lat); p.star(x, y, 0.42, 1.6); }
  for (const [lon, lat] of places) { const [x, y] = P(lon, lat); p.star(x, y, 1.1, 2.1); }
  haze(p, 6, 0.3);
  await save(develop(p, 1.5), "world-institutions", [2400, 1200]);
}
// A globe, for the Maps page.
{
  const s = 2000, R = 900, c = s / 2, p = plate(s, s), lon0 = 20, lat0 = 18;
  const P = (lon, lat) => { const a = (lon - lon0) * rad, f = lat * rad, f0 = lat0 * rad; const z = Math.sin(f0) * Math.sin(f) + Math.cos(f0) * Math.cos(f) * Math.cos(a); return [c + R * Math.cos(f) * Math.sin(a), c - R * (Math.cos(f0) * Math.sin(f) - Math.sin(f0) * Math.cos(f) * Math.cos(a)), z]; };
  for (let lat = -88; lat < 88; lat += 0.75) for (let lon = -180; lon < 180; lon += 0.75 / Math.max(0.2, Math.cos(lat * rad))) if (land(lon, lat)) { const [x, y, z] = P(lon, lat); if (z > 0) p.star(x, y, 0.5 * (0.45 + z * 0.55), 1.5); }
  for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 0.08) { const [x, y, z] = P(lon, lat); if (z > 0) p.stamp(x, y, 0.05); }
  for (let lon = -180; lon < 180; lon += 30) for (let lat = -90; lat < 90; lat += 0.08) { const [x, y, z] = P(lon, lat); if (z > 0) p.stamp(x, y, 0.05); }
  for (let a = 0; a < 6.2832; a += 0.0004) p.stamp(c + R * Math.cos(a), c + R * Math.sin(a), 0.16);
  for (const [lon, lat] of places) { const [x, y, z] = P(lon, lat); if (z > 0) p.star(x, y, 1.15 * (0.5 + z * 0.5), 2.2); }
  haze(p, 5, 0.3);
  await save(develop(p, 1.5), "globe-institutions", [1600, 800]);
}
const countries = new Set(places.map((q) => q[3]));
writeFileSync(here("../src/data/institutions-count.json"), JSON.stringify({ institutions: places.length, countries: countries.size }));
console.log({ institutions: places.length, countries: countries.size });
