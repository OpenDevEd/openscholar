import "server-only";

import schema from "./generated/library-config.schema.json";
import { resolveSchemaPointer } from "./section-registry";

export type StringFieldContract = {
  maxLength?: number;
  minLength?: number;
  pattern?: string;
};

function readSchemaNode(pointer: string): Record<string, unknown> {
  const value = resolveSchemaPointer(schema, pointer);
  if (!value || typeof value !== "object") {
    throw new Error(`Generated configuration contract is missing ${pointer}`);
  }
  return value as Record<string, unknown>;
}

export function readStringContract(pointer: string): StringFieldContract {
  const node = readSchemaNode(pointer) as StringFieldContract;
  return {
    maxLength: node.maxLength,
    minLength: node.minLength,
    pattern: node.pattern,
  };
}

// Returns the allowed values at a pointer. Works for an enum field and for an
// array whose items are an enum (use the /items suffix or the array pointer).
export function readEnum(pointer: string): string[] {
  const node = readSchemaNode(pointer) as {
    enum?: unknown[];
    items?: { enum?: unknown[] };
  };
  const values = node.enum ?? node.items?.enum;
  if (!values || values.length === 0) {
    throw new Error(`Generated configuration contract has no choices at ${pointer}`);
  }
  if (!values.every((value): value is string => typeof value === "string")) {
    throw new Error(`Generated configuration contract has a non-text choice at ${pointer}`);
  }
  return values;
}
