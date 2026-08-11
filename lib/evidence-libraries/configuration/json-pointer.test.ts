import { describe, expect, test } from "vitest";

import {
  escapeJsonPointerToken,
  jsonPointerPatternMatches,
  unescapeJsonPointerToken,
} from "./json-pointer";

describe("JSON Pointer helpers", () => {
  test("round-trips RFC 6901 tokens and matches array wildcard patterns", () => {
    const token = "provider~/name";
    const escaped = escapeJsonPointerToken(token);

    expect(escaped).toBe("provider~0~1name");
    expect(unescapeJsonPointerToken(escaped)).toBe(token);
    expect(
      jsonPointerPatternMatches(
        "/ai/providers/*/apiKey",
        "/ai/providers/0/apiKey",
      ),
    ).toBe(true);
    expect(
      jsonPointerPatternMatches(
        "/ai/providers/*/apiKey",
        "/ai/providers/0/defaultModel",
      ),
    ).toBe(false);
  });
});
