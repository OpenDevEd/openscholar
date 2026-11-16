// A sky of stars as one picture, drawn here at build time at the size it is laid out at.
//
// A hero keeps three of them, so each can twinkle as a whole out of step with the others. A browser keeps a picture that
// fades as a whole at the picture's own size, where a drawing (an SVG, box shadows) is kept at the screen's density: three
// drawn skies on a Retina screen held about 100 MB for specks that look the same. That left too little room to redraw
// what changes on the page, which then blinked.
import sharp from "sharp";

/** `stars` are [x, y, radius, opacity]. With `fade`, the sky fades out over its first and last 400 px, so on a window wider than the picture it never stops at an edge. */
export const sky = async (stars, width, height, fade = false) => {
  const dots = stars.map(([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" opacity="${o}"/>`).join("");
  const ends = fade ? `<linearGradient id="f"><stop stop-color="#000"/><stop offset="${400 / width}" stop-color="#fff"/><stop offset="${1 - 400 / width}" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient><mask id="m"><rect width="${width}" height="${height}" fill="url(#f)"/></mask>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="#e6eaf5">${ends}<g${fade ? ' mask="url(#m)"' : ""}>${dots}</g></svg>`;
  return `data:image/webp;base64,${(await sharp(Buffer.from(svg)).webp({ lossless: true }).toBuffer()).toString("base64")}`;
};
