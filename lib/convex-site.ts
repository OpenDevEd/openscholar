export function getConvexSiteUrl() {
  const explicitSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!explicitSiteUrl && !convexUrl) return null;

  try {
    if (explicitSiteUrl) {
      return new URL(explicitSiteUrl).origin;
    }

    const url = new URL(convexUrl!);
    let host = url.host;

    if (host.endsWith(".convex.cloud")) {
      host = host.replace(".convex.cloud", ".convex.site");
    }

    return `${url.protocol}//${host}`;
  } catch (error) {
    return null;
  }
}
