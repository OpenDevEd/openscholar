// Renders the rich colour fields behind each section. Usage: node art/fields.mjs
import sharp from "sharp";
const out = new URL("../public/img/", import.meta.url).pathname, W = 1600, H = 1000;
const FIELDS = {
  cobalt: ["#0b1f6b", [["#1d4ed8", 300, 120, 620], ["#1e40af", 1300, 180, 560], ["#0369a1", 1000, 760, 520], ["#1e3a8a", 200, 860, 620], ["#0ea5e9", 1560, 980, 300]]],
  amber: ["#7c2d12", [["#c2410c", 300, 180, 640], ["#b45309", 1250, 160, 560], ["#b91c1c", 240, 880, 560], ["#c2410c", 980, 820, 520], ["#ea580c", 1560, 980, 260]]],
  emerald: ["#064e3b", [["#047857", 260, 160, 620], ["#047857", 1200, 240, 580], ["#0f766e", 860, 860, 560], ["#065f46", 120, 880, 520], ["#047857", 1560, 980, 260]]],
  rose: ["#7f1d3f", [["#be123c", 280, 220, 620], ["#be185d", 1240, 140, 560], ["#c2410c", 1000, 860, 520], ["#9f1239", 180, 880, 540], ["#e11d48", 1560, 980, 260]]],
  ocean: ["#083344", [["#0e7490", 260, 180, 600], ["#0369a1", 1240, 200, 560], ["#1d4ed8", 900, 880, 560], ["#155e75", 120, 860, 520], ["#0891b2", 1560, 980, 240]]],
  night: ["#060b24", [["#1e3a8a", 220, 120, 560], ["#155e75", 1320, 120, 480], ["#172554", 880, 900, 620], ["#0369a1", 1540, 980, 240]]],
};
for (const [name, [base, blobs]] of Object.entries(FIELDS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="120"/></filter></defs><rect width="${W}" height="${H}" fill="${base}"/><g filter="url(#b)">${blobs.map(([c, x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join("")}</g></svg>`;
  const raw = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
  // A little grain stops banding in the gradients.
  for (let i = 0; i < raw.length; i += 3) { const n = (Math.random() - 0.5) * 7; raw[i] = Math.min(255, Math.max(0, raw[i] + n)); raw[i + 1] = Math.min(255, Math.max(0, raw[i + 1] + n)); raw[i + 2] = Math.min(255, Math.max(0, raw[i + 2] + n)); }
  const info = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).resize(1200).avif({ quality: 55, effort: 6 }).toFile(`${out}field-${name}.avif`);
  console.log(name, Math.round(info.size / 1024) + " KB");
}
