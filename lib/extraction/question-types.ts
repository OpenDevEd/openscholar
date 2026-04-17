export const QUESTION_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "list",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const DEFAULT_QUESTION_TYPE: QuestionType = "text";

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Yes / No",
  date: "Date",
  list: "List",
};

export const QUESTION_TYPE_ARIA_LABEL = "Answer type";

export function isQuestionType(value: string | undefined): value is QuestionType {
  return value !== undefined && (QUESTION_TYPES as readonly string[]).includes(value);
}

export function normalizeQuestionType(value: string | undefined): QuestionType {
  return isQuestionType(value) ? value : DEFAULT_QUESTION_TYPE;
}
