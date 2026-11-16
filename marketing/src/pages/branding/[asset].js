import sharp from "sharp";
import mark from "../../data/mark.svg?raw";
import wordmark from "../../data/wordmark.svg?raw";

export function getStaticPaths() {
  return ["light", "dark"].flatMap((theme) => ["logo", "mark"].flatMap((kind) => ["svg", "png"].map((format) => ({
    params: { asset: `openscholar-${kind}-${theme}.${format}` }, props: { theme, kind, format },
  }))));
}

export async function GET({ props: { theme, kind, format } }) {
  const color = theme === "dark" ? "#f5f5f5" : "#141414";
  const symbol = mark.replace(/<\/?svg[^>]*>/g, "").replaceAll("#f5f5f5", color);
  const letters = wordmark.replace(/<\/?svg[^>]*>/g, "").replaceAll("currentColor", color);
  const width = kind === "logo" ? 313.08 : 64;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 64" width="${width}" height="64">${symbol}${kind === "logo" ? `<g transform="translate(78 0)">${letters}</g>` : ""}</svg>`;
  const body = format === "png" ? await sharp(Buffer.from(svg)).resize({ width: kind === "logo" ? 1600 : 1024 }).png().toBuffer() : svg;
  return new Response(body, { headers: { "Content-Type": format === "png" ? "image/png" : "image/svg+xml" } });
}
