import { describe, expect, test } from "vitest";
import type { Validator } from "convex/values";
import schema from "../schema";

import {
  chatGenerationUsageFields,
  chatPaperFields,
  creditsFields,
  creditTransactionFields,
  subscriptionFields,
  userFields,
} from "./validators";

import {
  extractionEvidenceUnitFields,
  extractionJobFields,
  extractionPaperErrorFields,
  extractionPaperFields,
  extractionQuestionFields,
  extractionResultFields,
} from "../extraction/validators";

const ssotTables = {
  users: userFields,
  credits: creditsFields,
  subscriptions: subscriptionFields,
  creditTransactions: creditTransactionFields,
  chatPapers: chatPaperFields,
  chatGenerationUsages: chatGenerationUsageFields,
  extractionJobs: extractionJobFields,
  extractionQuestions: extractionQuestionFields,
  extractionPapers: extractionPaperFields,
  extractionPaperErrors: extractionPaperErrorFields,
  extractionResults: extractionResultFields,
  extractionEvidenceUnits: extractionEvidenceUnitFields,
} as const;

type AnyValidator = Validator<unknown, "required" | "optional", string>;

function describeValidator(v: AnyValidator): string {
  const inner = v.kind;
  const optional = (v as { isOptional?: "required" | "optional" }).isOptional === "optional";
  return optional ? `optional<${inner}>` : inner;
}

describe("schema/validator parity", () => {
  for (const [tableName, fields] of Object.entries(ssotTables)) {
    test(`${tableName}: field-object matches schema.tables.${tableName}.validator.fields`, () => {
      const tableDef = (
        schema.tables as unknown as Record<
          string,
          { validator: { fields: Record<string, AnyValidator> } }
        >
      )[tableName];
      expect(tableDef, `schema.tables.${tableName} missing — schema desync`).toBeDefined();

      const schemaShape: Record<string, string> = Object.fromEntries(
        Object.entries(tableDef.validator.fields).map(([k, v]) => [k, describeValidator(v)]),
      );

      const validatorShape: Record<string, string> = Object.fromEntries(
        Object.entries(fields as Record<string, AnyValidator>).map(([k, v]) => [
          k,
          describeValidator(v),
        ]),
      );

      expect(validatorShape).toEqual(schemaShape);
    });
  }
});

test("credit transactions use signed ledger amounts without a stale balance snapshot", () => {
  expect(creditTransactionFields).not.toHaveProperty("balanceAfter");
});
