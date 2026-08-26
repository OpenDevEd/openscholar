import type { ValidateFunction } from "ajv";

export const fullValidator: ValidateFunction<unknown>;
export const sectionValidators: Readonly<Record<string, ValidateFunction<unknown>>>;
