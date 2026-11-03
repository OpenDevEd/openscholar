import type { NextConfig } from "next";
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
  async headers() {
    return [
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

export default withNextIntl(nextConfig);
