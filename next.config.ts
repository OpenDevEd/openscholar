import type { NextConfig } from "next";
import { withPostHogConfig } from "@posthog/nextjs-config";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["citeproc-ts"],
  devIndicators: false,
  poweredByHeader: false,
  typescript: {
    // CI type-checks once in its unit job, so its e2e build skips the check.
    ignoreBuildErrors: process.env.NEXT_BUILD_SKIP_VERIFIED_TYPES === "1",
  },
  experimental: {
    testProxy: process.env.PLAYWRIGHT_TEST_PROXY === "1",
    optimizePackageImports: ["lucide-react"],
    turbopackFileSystemCacheForBuild: true,
  },
  // A second local address for testing, as the free question limit counts each address on its own.
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      // The marketing site fetches these ahead, so they're on hand the moment someone searches from it. Images only: the script changes.
      {
        source: "/question-stage/:file([\\w-]+\\.avif)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "off",
          },
        ],
      },
    ];
  },
  // The old addresses: running communities still send their admins through /evidence-libraries (convex/evidenceLibraries/runtimeConfiguration.ts).
  async redirects() {
    return [
      { source: "/evidence-libraries", destination: "/evidence-communities", permanent: true },
      { source: "/evidence-libraries/:path*", destination: "/evidence-communities/:path*", permanent: true },
      { source: "/o/:slug/evidence-libraries", destination: "/o/:slug/evidence-communities", permanent: true },
      { source: "/o/:slug/evidence-libraries/:path*", destination: "/o/:slug/evidence-communities/:path*", permanent: true },
      { source: "/settings/admin/evidence-libraries", destination: "/settings/admin/evidence-communities", permanent: true },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/data/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/data/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

// Errors in PostHog read as our code: a build with POSTHOG_API_KEY uploads its source maps and deletes them, so
// they're never served. A build without the key, on a laptop or in CI, uploads nothing.
const postHogApiKey = process.env.POSTHOG_API_KEY ?? "";

export default withPostHogConfig(withNextIntl(nextConfig), {
  personalApiKey: postHogApiKey,
  projectId: "125154",
  host: "https://eu.posthog.com",
  sourcemaps: {
    enabled: postHogApiKey !== "",
    releaseName: "openscholar",
    releaseVersion: process.env.SOURCE_COMMIT || "unversioned",
  },
});
