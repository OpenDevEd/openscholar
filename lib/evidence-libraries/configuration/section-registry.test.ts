import { describe, expect, test } from "vitest";

import catalogs from "./generated/library-config.catalogs.json";
import schema from "./generated/library-config.schema.json";
import {
  ENVELOPE_FIELDS,
  SECTION_REGISTRY,
  getFieldAuthority,
  resolveSchemaPointer,
  writeOnlyPathToPointerPattern,
} from "./section-registry";

describe("Evidence Library section registry", () => {
  test("resolves fields inside schema alternatives", () => {
    const alternativeSchema = {
      properties: {
        search: {
          anyOf: [
            {
              oneOf: [
                { properties: { apiKey: { type: "string" } } },
                { properties: { url: { type: "string" } } },
              ],
            },
            { type: "null" },
          ],
        },
      },
    };

    expect(resolveSchemaPointer(alternativeSchema, "/search/apiKey")).toEqual({
      type: "string",
    });
  });

  test("covers the generated runtime contract exactly and derives credential paths", () => {
    const generatedSections = Object.keys(schema.properties).filter(
      (key) =>
        !ENVELOPE_FIELDS.includes(key as (typeof ENVELOPE_FIELDS)[number]),
    );

    expect(SECTION_REGISTRY.map((section) => section.key)).toEqual(
      generatedSections,
    );
    expect(SECTION_REGISTRY).toHaveLength(24);
    expect(SECTION_REGISTRY.map((section) => section.key)).toContain("sources");
    expect(SECTION_REGISTRY.map((section) => section.key)).not.toContain(
      "meta",
    );

    for (const section of SECTION_REGISTRY) {
      expect(section.authority).toBeTruthy();
      expect(resolveSchemaPointer(schema, section.pointer)).toBeDefined();
    }

    for (const writeOnlyPath of catalogs.fields.writeOnlyPaths) {
      const pointerPattern = writeOnlyPathToPointerPattern(writeOnlyPath);
      expect(resolveSchemaPointer(schema, pointerPattern)).toBeDefined();
      expect(getFieldAuthority(pointerPattern)).toBe("credentialLifecycle");
    }
  });
});
