import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validateLibraryConfigStructure } from "./validation";

describe("validateLibraryConfigStructure", () => {
  test("normalizes required, format, and enum failures to stable field pointers", () => {
    const result = validateLibraryConfigStructure({
      schemaVersion: 1,
      revision: "candidate-1",
      updatedAt: "2026-08-11T10:00:00Z",
      identity: {
        name: 42,
        baseUrl: "not a uri",
      },
      theme: {
        colors: {},
        layout: "boxed",
      },
      localization: {
        defaultLocale: "en-GB",
      },
      services: {},
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        {
          pointer: "/identity/assets",
          section: "identity",
          keyword: "required",
          message: "Required field is missing.",
        },
        {
          pointer: "/identity/baseUrl",
          section: "identity",
          keyword: "format",
          message: "Value must match the uri format.",
        },
        {
          pointer: "/identity/name",
          section: "identity",
          keyword: "type",
          message: "Value must be a string.",
        },
        {
          pointer: "/theme/layout",
          section: "theme",
          keyword: "enum",
          message: "Value must be one of: small, wide.",
        },
      ]),
    );
  });
});
