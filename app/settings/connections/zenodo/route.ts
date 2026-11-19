// Where Zenodo's sign-in sends the person back (the address registered on Openscholar's Zenodo app, #1237): the
// sign-in is finished here for whoever started it, as its state says, and they go back to where they started. One
// opened in a small window goes to a page that closes it; the page behind it sees the account arrive through Convex.
// A file outside Clerk (lib/auth/public-routes.ts), as Zotero's callback is: the state is all it needs.
import { fetchAction } from "convex/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // A relative address: behind the proxy, the request's own origin is the container's (localhost:3000), not the site's.
  const back = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("/settings/connections?zenodo_error=1");
  try {
    return back(await fetchAction(api.zenodo.connectionActions.finish, { code, state }));
  } catch (error) {
    console.error(JSON.stringify({ event: "zenodo-connect-failed", error: String(error).slice(0, 300) }));
    return back("/settings/connections?zenodo_error=1");
  }
}
