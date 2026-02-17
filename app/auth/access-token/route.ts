import { withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await withAuth({ ensureSignedIn: false });
    if (!auth.user || !auth.accessToken) {
      return NextResponse.json(
        { accessToken: null },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { accessToken: auth.accessToken },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { accessToken: null },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
}
