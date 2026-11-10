import type { ValidationIssue } from "./generated-validation";

/** Kept apart from `assembly.ts`, which loads the 4 MB generated validator: a module that only catches this stays light. */
export class ConfigurationAssemblyError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super("Evidence Community configuration is invalid");
    this.name = "ConfigurationAssemblyError";
    this.issues = issues;
  }
}
