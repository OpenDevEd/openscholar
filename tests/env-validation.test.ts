import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

const REQUIRED_ENV_VARS = [
  "STRIPE_SECRET_KEY",
  "ENCRYPTION_KEY",
  "STRIPE_GO_PRICE_ID",
  "STRIPE_PRO_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "CLERK_JWT_ISSUER_DOMAIN",
  "ZOTERO_CLIENT_KEY",
  "ZOTERO_CLIENT_SECRET",
];

describe("validateRequiredEnvVars", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original env vars
    for (const key of REQUIRED_ENV_VARS) {
      originalEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env vars
    for (const key of REQUIRED_ENV_VARS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    vi.resetModules();
  });

  it("detects missing STRIPE_SECRET_KEY", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    // Set all other required env vars to non-empty values
    process.env.ENCRYPTION_KEY = "test-key";
    process.env.STRIPE_GO_PRICE_ID = "price_go";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.CLERK_JWT_ISSUER_DOMAIN = "https://test.clerk.dev";
    process.env.ZOTERO_CLIENT_KEY = "zk_test";
    process.env.ZOTERO_CLIENT_SECRET = "zs_test";

    const { validateRequiredEnvVars } = await import(
      "../convex/lib/envValidation"
    );
    const result = validateRequiredEnvVars();
    expect(result.missing).toContain("STRIPE_SECRET_KEY");
  });

  it("detects empty string ENCRYPTION_KEY", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.ENCRYPTION_KEY = "";
    process.env.STRIPE_GO_PRICE_ID = "price_go";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.CLERK_JWT_ISSUER_DOMAIN = "https://test.clerk.dev";
    process.env.ZOTERO_CLIENT_KEY = "zk_test";
    process.env.ZOTERO_CLIENT_SECRET = "zs_test";

    const { validateRequiredEnvVars } = await import(
      "../convex/lib/envValidation"
    );
    const result = validateRequiredEnvVars();
    expect(result.missing).toContain("ENCRYPTION_KEY");
  });

  it("returns empty array when all env vars are present", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.ENCRYPTION_KEY = "test-encryption-key";
    process.env.STRIPE_GO_PRICE_ID = "price_go";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.CLERK_JWT_ISSUER_DOMAIN = "https://test.clerk.dev";
    process.env.ZOTERO_CLIENT_KEY = "zk_test";
    process.env.ZOTERO_CLIENT_SECRET = "zs_test";

    const { validateRequiredEnvVars } = await import(
      "../convex/lib/envValidation"
    );
    const result = validateRequiredEnvVars();
    expect(result.missing).toEqual([]);
  });

  it("detects multiple missing env vars", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_GO_PRICE_ID = "price_go";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    process.env.CLERK_JWT_ISSUER_DOMAIN = "https://test.clerk.dev";
    process.env.ZOTERO_CLIENT_KEY = "zk_test";
    process.env.ZOTERO_CLIENT_SECRET = "zs_test";

    const { validateRequiredEnvVars } = await import(
      "../convex/lib/envValidation"
    );
    const result = validateRequiredEnvVars();
    expect(result.missing).toContain("STRIPE_SECRET_KEY");
    expect(result.missing).toContain("ENCRYPTION_KEY");
    expect(result.missing).toContain("STRIPE_WEBHOOK_SECRET");
    expect(result.missing).toHaveLength(3);
  });

  it("detects missing ZOTERO_CLIENT_KEY", async () => {
    delete process.env.ZOTERO_CLIENT_KEY;
    // Set all other required env vars to non-empty values
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.ENCRYPTION_KEY = "test-key";
    process.env.STRIPE_GO_PRICE_ID = "price_go";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.CLERK_JWT_ISSUER_DOMAIN = "https://test.clerk.dev";
    process.env.ZOTERO_CLIENT_SECRET = "zs_test";

    const { validateRequiredEnvVars } = await import(
      "../convex/lib/envValidation"
    );
    const result = validateRequiredEnvVars();
    expect(result.missing).toContain("ZOTERO_CLIENT_KEY");
  });

  it("detects missing ZOTERO_CLIENT_SECRET", async () => {
    delete process.env.ZOTERO_CLIENT_SECRET;
    // Set all other required env vars to non-empty values
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.ENCRYPTION_KEY = "test-key";
    process.env.STRIPE_GO_PRICE_ID = "price_go";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.CLERK_JWT_ISSUER_DOMAIN = "https://test.clerk.dev";
    process.env.ZOTERO_CLIENT_KEY = "zk_test";

    const { validateRequiredEnvVars } = await import(
      "../convex/lib/envValidation"
    );
    const result = validateRequiredEnvVars();
    expect(result.missing).toContain("ZOTERO_CLIENT_SECRET");
  });
});
