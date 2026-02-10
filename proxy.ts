import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { PUBLIC_UNAUTHENTICATED_PATHS } from "@/lib/auth/public-routes";

export default authkitMiddleware({
  redirectUri:
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ??
    process.env.WORKOS_REDIRECT_URI!,
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [...PUBLIC_UNAUTHENTICATED_PATHS],
  },
});

// Match all paths except API routes, Next internals, and static assets.
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
