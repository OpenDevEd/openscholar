import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { addCostFromUsage, assertWithinBudget } from "@/lib/ai-cost";
import { GOOGLE_MODEL, OPENAI_MODEL } from "@/lib/screening-utils";

export type AIProvider = "openai" | "google";

// Define schema with strict validation requirements
const queryEnhancementSchema = z.object({
  enhancedQuery: z
    .string()
    .describe(
      "A complete, syntactically valid Elasticsearch Boolean query string. Must have balanced parentheses and no unfinished groups."
    ),
});

// Helper to check query validity
function validateQuery(query: string): string {
  const openParens = (query.match(/\(/g) || []).length;
  const closeParens = (query.match(/\)/g) || []).length;

  if (openParens !== closeParens) {
    throw new Error("Generated query has unbalanced parentheses");
  }

  if (/OR\s*$|AND\s*$|NOT\s*$/.test(query)) {
    throw new Error("Generated query ends with an incomplete operator");
  }

  return query;
}

export async function enhanceSearchQuery(
  query: string,
  provider: "openai" | "google",
  apiKey: string
) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  if (!query.trim()) {
    throw new Error("Query is required");
  }

  try {
    assertWithinBudget();

    let model;

    if (provider === "openai") {
      const openai = createOpenAI({ apiKey });
      model = openai(OPENAI_MODEL);
    } else {
      const google = createGoogleGenerativeAI({ apiKey });
      model = google(GOOGLE_MODEL);
    }

    const { object, usage } = await generateObject({
      model,
      schema: queryEnhancementSchema,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
        openai: {
          reasoningEffort: "minimal",
        },
      },
      onError: (error: any) => {
        console.error("Error enhancing query:", error);
        throw new Error(
          "Failed to enhance query. Please check your API key and try again."
        );
      },
      system: `You are an Elasticsearch Query String Query optimization expert for academic search.
You may receive either:
1. An existing Boolean query.
2. A natural-language research question.

Your task:
- If input is a Boolean query: optimize it for character efficiency.
- If input is a research question: rewrite it as a precise Boolean query first, then optimize.

Core Principles:
1. Use parentheses to group shared terms efficiently: (mechanical OR software) AND engineering
2. Follow Elasticsearch Query String Query syntax exactly
3. Prioritize character efficiency - avoid redundant terms
4. Group synonyms with OR, then AND with shared concepts
5. Use field-specific academic terminology and abbreviations
6. Maintain precision while improving recall

Elasticsearch Rules:
- Use AND, OR, NOT operators (case sensitive)
- Group with parentheses for precedence
- Use quotes for exact phrases: "machine learning"
- Wildcards: algorithm* for variations
- Field searches: title:"deep learning"

Validation Rules:
- Always return a complete Boolean query with balanced parentheses
- Never leave unfinished groups
- Do not end with OR, AND, or NOT
- Limit synonym groups to the most common 2–3 academic terms to avoid truncation
- The final query must be executable in Elasticsearch

Examples:
Q: "What are the effects of climate change on agriculture in Africa?"
→ (climate OR "global warming") AND agriculture AND Africa

Q: "Artificial intelligence and deep learning in medical imaging"
→ (artificial OR AI OR deep) AND (intelligence OR learning) AND ("medical imaging" OR radiology)

Character Optimization Examples:
- Instead of: "mechanical engineering" OR "software engineering"
- Use: (mechanical OR software) AND engineering
- Instead of: "artificial intelligence" OR "machine learning" OR "deep learning"
- Use: (artificial OR machine OR deep) AND (intelligence OR learning)`,
      prompt: `Enhance this academic search query using Elasticsearch Query String Query syntax. 
Input query: "${query}"

Requirements:
1. If natural language → convert into Boolean form first.
2. If already Boolean → optimize directly.
3. Always produce a syntactically valid query (balanced parentheses, no dangling operators).
4. Minimize character count while maximizing recall and precision.
5. Provide synonyms and abbreviations, but keep groups concise (max 2–3 terms per group).`,
    });

    addCostFromUsage(provider, usage);

    return {
      enhancedQuery: validateQuery(object.enhancedQuery),
      explanation: "",
    };
  } catch (error) {
    console.error("Error enhancing query:", error);
    throw new Error(
      "Failed to enhance query. Please check your API key and try again."
    );
  }
}
