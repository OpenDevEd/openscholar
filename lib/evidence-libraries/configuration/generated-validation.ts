import type { ErrorObject, ValidateFunction } from "ajv";
import {
  essentialValidator,
  fullValidator,
} from "./generated/library-config.validator.cjs";
import { escapeJsonPointerToken } from "./json-pointer";
import { SECTION_REGISTRY } from "./section-registry";

export type ValidationIssue = {
  pointer: string;
  section: (typeof SECTION_REGISTRY)[number]["key"] | null;
  keyword: string;
  message: string;
};

function issuePointer(error: ErrorObject) {
  if (error.keyword === "required") {
    const missingProperty = (error.params as { missingProperty: string })
      .missingProperty;
    return `${error.instancePath}/${escapeJsonPointerToken(missingProperty)}`;
  }
  if (error.keyword === "additionalProperties") {
    const property = (error.params as { additionalProperty: string })
      .additionalProperty;
    return `${error.instancePath}/${escapeJsonPointerToken(property)}`;
  }
  return error.instancePath || "";
}

function issueMessage(error: ErrorObject) {
  if (error.keyword === "required") return "Required field is missing.";
  if (error.keyword === "format") {
    const { format } = error.params as { format: string };
    return `Value must match the ${format} format.`;
  }
  if (error.keyword === "enum") {
    const { allowedValues } = error.params as { allowedValues: unknown[] };
    return `Value must be one of: ${allowedValues.join(", ")}.`;
  }
  if (error.keyword === "type") {
    const { type } = error.params as { type: string };
    return `Value must be a ${type}.`;
  }
  if (error.keyword === "const") {
    const { allowedValue } = error.params as { allowedValue: unknown };
    return `Value must equal ${String(allowedValue)}.`;
  }
  return "Value does not satisfy the configuration contract.";
}

function sectionForPointer(pointer: string): ValidationIssue["section"] {
  const section = pointer.split("/")[1];
  return SECTION_REGISTRY.find((entry) => entry.key === section)?.key ?? null;
}

function runValidator(
  validate: ValidateFunction<unknown>,
  input: unknown,
): { valid: boolean; issues: ValidationIssue[] } {
  if (validate(input)) return { valid: true, issues: [] };
  const issues = (validate.errors ?? [])
    .map((error) => {
      const pointer = issuePointer(error);
      return {
        pointer,
        section: sectionForPointer(pointer),
        keyword: error.keyword,
        message: issueMessage(error),
      } satisfies ValidationIssue;
    })
    .sort((left, right) =>
      `${left.pointer}:${left.keyword}`.localeCompare(
        `${right.pointer}:${right.keyword}`,
      ),
    );
  return { valid: false, issues };
}

export function validateLibraryConfigStructure(input: unknown) {
  return runValidator(fullValidator as ValidateFunction<unknown>, input);
}

export function validateEssentialConfigStructure(input: unknown) {
  return runValidator(essentialValidator as ValidateFunction<unknown>, input);
}
