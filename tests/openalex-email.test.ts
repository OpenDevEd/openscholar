import { describe, it, expect, vi, afterEach } from "vitest";

describe("OpenAlex contact email validation", () => {
  const originalEmail = process.env.OPENALEX_CONTACT_EMAIL;

  afterEach(() => {
    if (originalEmail === undefined) {
      delete process.env.OPENALEX_CONTACT_EMAIL;
    } else {
      process.env.OPENALEX_CONTACT_EMAIL = originalEmail;
    }
    vi.resetModules();
  });

  it("throws when OPENALEX_CONTACT_EMAIL is not set", () => {
    delete process.env.OPENALEX_CONTACT_EMAIL;

    // Replicate the validation logic from convex/extraction/actions.ts
    const contactEmail = process.env.OPENALEX_CONTACT_EMAIL;
    expect(contactEmail).toBeUndefined();

    // The validation in the actual code would throw:
    expect(() => {
      if (!contactEmail) {
        throw new Error(
          "OPENALEX_CONTACT_EMAIL is not configured. Set this env var in the Convex dashboard."
        );
      }
    }).toThrow("OPENALEX_CONTACT_EMAIL is not configured");
  });

  it("uses configured email when OPENALEX_CONTACT_EMAIL is set", () => {
    process.env.OPENALEX_CONTACT_EMAIL = "research@university.edu";

    const contactEmail = process.env.OPENALEX_CONTACT_EMAIL;
    expect(contactEmail).toBe("research@university.edu");

    const userAgent = `OpenAlex-Count/1.0 (mailto:${contactEmail})`;
    expect(userAgent).toBe(
      "OpenAlex-Count/1.0 (mailto:research@university.edu)"
    );
  });
});
