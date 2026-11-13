// The world as cells: land as faint cells, each research institution brightening its cell. Flat triples of cell x, cell y and
// strength, from src/data/earth.bin. The turning globe and the team map both draw from it.
import { readFileSync } from "node:fs";
export const CELL = 2.4;
export function earthCells() {
  const f = readFileSync("src/data/earth.bin"), earth = new Int16Array(f.buffer.slice(f.byteOffset, f.byteOffset + f.length));
  const INST = 9988, cells = new Map(), land = (earth.length - 2 - INST * 2) / 2;
  const add = (lon, lat, w) => { const k = `${Math.floor((lon + 180) / CELL)},${Math.floor((90 - lat) / CELL)}`; cells.set(k, (cells.get(k) ?? 0) + w); };
  for (let i = 0; i < INST; i++) add(earth[2 + i * 2] / 100, earth[3 + i * 2] / 100, 1);
  for (let i = 0; i < land; i++) add(earth[2 + INST * 2 + i * 2] / 100, earth[3 + INST * 2 + i * 2] / 100, 0);
  const out = [];
  // Rings of empty ice near the poles only show up as grid lines, so land stops at 72 degrees north.
  for (const [k, n] of cells) { const [x, y] = k.split(",").map(Number); if (!n && 90 - y * CELL > 72) continue; out.push(x, y, n > 40 ? 3 : n > 8 ? 2 : n > 0 ? 1 : 0); }
  return out;
}
