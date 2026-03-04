import { describe, it, expect } from "vitest";
import { migrateSearchHistoryState } from "../lib/store";
import { MIN_YEAR } from "../lib/constants";

/** Shape of the migrated search history state after all migrations */
interface MigratedSearchHistoryState {
  searchHistory?: Array<{
    query?: string;
    yearRange?: [number, number];
    isYearRangeEnabled?: boolean;
    queryHistory?: Array<{ query: string; timestamp: string }>;
    questionHistory?: unknown[];
    screeningQuestions?: Array<{ question: string }>;
    screeningResponses?: Record<string, Record<string, string>>;
    language?: string;
    createdAt?: string;
  }>;
}

/** Helper to cast migrate result to typed state */
function migrate(input: unknown, version: number): MigratedSearchHistoryState {
  return migrateSearchHistoryState(input, version) as MigratedSearchHistoryState;
}

describe("migrateSearchHistoryState", () => {
  it("version 0 -> 7: adds isYearRangeEnabled and all subsequent fields", () => {
    const input = {
      searchHistory: [
        {
          query: "test",
          yearRange: [1990, 2024],
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    };

    const result = migrate(input, 0);

    expect(result.searchHistory![0].isYearRangeEnabled).toBe(true);
    expect(result.searchHistory![0].queryHistory).toEqual([
      { query: "test", timestamp: "2024-01-01T00:00:00.000Z" },
    ]);
    expect(result.searchHistory![0].questionHistory).toEqual([]);
    expect(result.searchHistory![0].screeningQuestions).toEqual([]);
    expect(result.searchHistory![0].screeningResponses).toEqual({});
    expect(result.searchHistory![0].language).toBeUndefined();
  });

  it("version 0 -> 7: default yearRange sets isYearRangeEnabled to false", () => {
    const currentYear = new Date().getFullYear();
    const input = {
      searchHistory: [
        {
          query: "q",
          yearRange: [MIN_YEAR, currentYear],
        },
      ],
    };

    const result = migrate(input, 0);

    expect(result.searchHistory![0].isYearRangeEnabled).toBe(false);
  });

  it("version 1 -> 7: adds queryHistory from existing query", () => {
    const input = {
      searchHistory: [
        {
          query: "my query",
          isYearRangeEnabled: true,
          createdAt: "2024-06-15T12:00:00.000Z",
        },
      ],
    };

    const result = migrate(input, 1);

    expect(result.searchHistory![0].queryHistory).toEqual([
      { query: "my query", timestamp: "2024-06-15T12:00:00.000Z" },
    ]);
    expect(result.searchHistory![0].questionHistory).toEqual([]);
    expect(result.searchHistory![0].screeningQuestions).toEqual([]);
    expect(result.searchHistory![0].screeningResponses).toEqual({});
    expect(result.searchHistory![0].language).toBeUndefined();
  });

  it("version 3 -> 7: adds screeningQuestions and subsequent fields", () => {
    const input = {
      searchHistory: [
        {
          query: "q",
          isYearRangeEnabled: false,
          queryHistory: [{ query: "q", timestamp: "2024-01-01T00:00:00.000Z" }],
          questionHistory: [],
        },
      ],
    };

    const result = migrate(input, 3);

    expect(result.searchHistory![0].screeningQuestions).toEqual([]);
    expect(result.searchHistory![0].screeningResponses).toEqual({});
    expect(result.searchHistory![0].language).toBeUndefined();
    // Fields from earlier migrations remain untouched
    expect(result.searchHistory![0].queryHistory).toEqual([
      { query: "q", timestamp: "2024-01-01T00:00:00.000Z" },
    ]);
  });

  it("version 5 -> 7: adds language and normalizes screeningQuestions", () => {
    const input = {
      searchHistory: [
        {
          query: "q",
          isYearRangeEnabled: false,
          queryHistory: [{ query: "q", timestamp: "2024-01-01T00:00:00.000Z" }],
          questionHistory: [],
          screeningQuestions: [{ question: "Is this relevant?" }],
          screeningResponses: {},
        },
      ],
    };

    const result = migrate(input, 5);

    expect(result.searchHistory![0].language).toBeUndefined();
    expect(result.searchHistory![0].screeningQuestions).toEqual([
      { question: "Is this relevant?" },
    ]);
  });

  it("version 6 -> 7: normalizes screeningQuestions shape", () => {
    const input = {
      searchHistory: [
        {
          query: "q",
          isYearRangeEnabled: false,
          queryHistory: [{ query: "q", timestamp: "2024-01-01T00:00:00.000Z" }],
          questionHistory: [],
          screeningQuestions: [{ text: "old format" }],
          screeningResponses: {},
          language: "en",
        },
      ],
    };

    const result = migrate(input, 6);

    // Malformed object without .question property gets fallback empty string
    expect(result.searchHistory![0].screeningQuestions).toEqual([
      { question: "" },
    ]);
  });

  it("version 7 -> 7: no-op (already at current version)", () => {
    const input = {
      searchHistory: [
        {
          query: "q",
          isYearRangeEnabled: true,
          queryHistory: [{ query: "q", timestamp: "2024-01-01T00:00:00.000Z" }],
          questionHistory: [],
          screeningQuestions: [{ question: "Is it good?" }],
          screeningResponses: { paper1: { q1: "yes" } },
          language: "en",
        },
      ],
    };

    const result = migrate(structuredClone(input), 7);

    expect(result).toEqual(input);
  });

  it("handles empty searchHistory array", () => {
    for (const version of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const result = migrate({ searchHistory: [] }, version);
      expect(result.searchHistory).toEqual([]);
    }
  });

  it("handles undefined searchHistory", () => {
    const result = migrate({}, 0);

    // migrate checks `if (persistedState.searchHistory)` before mapping, so no crash
    expect(result).toBeDefined();
    expect(result.searchHistory).toBeUndefined();
  });
});
