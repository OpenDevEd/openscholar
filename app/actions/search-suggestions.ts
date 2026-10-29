"use server";
import { fetchQuery } from "convex/nextjs";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { executeAIOperation } from "@/lib/ai/core/execute";

export type SearchSuggestion = { question: string; from: string };

const schema = z.object({
  suggestions: z.array(z.object({ question: z.string(), from: z.number() })),
});

const INSTRUCTIONS = (language: string) => [
  "You suggest the next research questions a researcher could search for in a scholarly search engine.",
  "You get their recent searches, newest first, numbered from 0. Some are plain questions, some boolean keyword queries.",
  "Write exactly 3 research questions that build on them: a related angle, a narrower population or setting, an outcome or method they have not searched yet.",
  "Each question is one plain sentence under 80 characters, ends with a question mark, and is not a rewording of a search they already ran.",
  "Prefer the newest searches. Set `from` to the number of the search each question builds on.",
  `Write the questions in the language with code "${language}".`,
].join("\n");

/**
 * Mock: three research questions written from a person's recent searches, on the Cheap preset's
 * model and our own key, so no credits are spent. The real version runs in Convex after each
 * saved search and stores the result per workspace and person, so the home page reads it at once.
 */
export async function suggestSearches(searches: string[], language: string): Promise<SearchSuggestion[]> {
  const recent = [...new Set(searches.map((text) => text.trim().slice(0, 400)))].slice(0, 10);
  if (!recent.length) return [];
  const picks = await fetchQuery(api.aiModelConfig.queries.presetPicks, {});
  const pick = picks.cheap.find((entry) => entry.task === "questionToQuery");
  if (!pick?.model) return [];
  const { output } = await executeAIOperation({
    model: createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })(pick.model.modelId),
    schema,
    input: recent,
    buildPrompts: (input) => ({ system: INSTRUCTIONS(language), prompt: input.map((text, index) => `${index}. ${text}`).join("\n") }),
    repairStrategy: { type: "full-json" },
    temperature: 0.7,
    effort: pick.effort ?? undefined,
  });
  return output.suggestions
    .filter((entry) => recent[entry.from] !== undefined)
    .slice(0, 3)
    .map((entry) => ({ question: entry.question.trim(), from: recent[entry.from] }));
}
