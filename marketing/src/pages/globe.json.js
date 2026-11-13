// The points for the globe, from src/data/earth.mjs.
import { CELL, earthCells } from "../data/earth.mjs";
export function GET() {
  return new Response(JSON.stringify({ cell: CELL, p: earthCells() }), { headers: { "Content-Type": "application/json" } });
}
