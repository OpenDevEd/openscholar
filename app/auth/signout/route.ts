import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";

function resolveRequiredReturnTo() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_URL;

  if (!configuredUrl) {
    throw new Error(
      "Missing sign-out return URL configuration. Set NEXT_PUBLIC_APP_URL or NEXT_PUBLIC_URL.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new Error(
      "Invalid sign-out return URL configuration. NEXT_PUBLIC_APP_URL or NEXT_PUBLIC_URL must be an absolute URL.",
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      "Invalid sign-out return URL protocol. NEXT_PUBLIC_APP_URL or NEXT_PUBLIC_URL must use http or https.",
    );
  }

  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.toString();
}

const WORKOS_SESSION_COOKIE = process.env.WORKOS_COOKIE_NAME ?? "wos-session";
const WORKOS_JWT_COOKIE = "workos-access-token";

async function clearCookieVariants(name: string) {
  const cookieStore = await cookies();
  cookieStore.delete(name);
  cookieStore.delete({ name, path: "/" });

  const configuredDomain = process.env.WORKOS_COOKIE_DOMAIN;
  if (configuredDomain) {
    cookieStore.delete({ name, path: "/", domain: configuredDomain });
  }
}

export const GET = async () => {
  const returnTo = resolveRequiredReturnTo();
  let sessionId: string | undefined;

  try {
    const auth = await withAuth({ ensureSignedIn: false });
    sessionId = auth.sessionId;
  } catch {
    sessionId = undefined;
  }

  await clearCookieVariants(WORKOS_SESSION_COOKIE);
  await clearCookieVariants(WORKOS_JWT_COOKIE);

  if (sessionId) {
    const logoutUrl = getWorkOS().userManagement.getLogoutUrl({
      sessionId,
      returnTo,
    });
    return NextResponse.redirect(logoutUrl);
  }

  return NextResponse.redirect(returnTo);
};
