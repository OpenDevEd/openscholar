import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { addCostFromUsage, assertWithinBudget } from "@/lib/ai-cost";
import { languageOptions } from "@/components/language-selector";
import type { AIProvider } from "@/lib/types";

// Define schema with strict validation requirements
const queryEnhancementSchema = z.object({
  enhancedQuery: z
    .string()
    .describe(
      "A complete, syntactically valid Elasticsearch Boolean query string. Must have balanced parentheses and no unfinished groups."
    ),
});

// Define schema for screening questions generation
const screeningQuestionsSchema = z.object({
  questions: z
    .array(z.string())
    .min(1)
    .max(10)
    .describe(
      "An array of 3-5 screening questions that are specific, answerable with yes/no, and help determine if a paper meets inclusion criteria."
    ),
});

// Function to create dynamic schema for screening responses
function createScreeningResponsesSchema(questions: string[]) {
  const responseProperties: Record<string, any> = {};

  for (const question of questions) {
    responseProperties[question] = z.union([z.boolean(), z.null()]).describe(
      `Response to: "${question}" (true=yes, false=no, null=unclear)`
    );
  }

  return z.object({
    responses: z.object(responseProperties).describe(
      "An object where keys are screening questions and values are boolean responses (true=yes, false=no, null=unclear)"
    ),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe("Overall confidence level in the screening results (0-1)"),
  });
}

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
  provider: AIProvider,
  apiKey: string,
  modelId: string,
  language?: string
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
      model = openai(modelId);
    } else if (provider === "google") {
      const google = createGoogleGenerativeAI({ apiKey });
      model = google(modelId);
    } else if (provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey });
      model = anthropic(modelId);
    } else if (provider === "openrouter") {
      const openrouter = createOpenRouter({ apiKey });
      model = openrouter(modelId);
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const maxRetries = 10;
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount < maxRetries) {
      try {
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
          temperature: 1,
          system: `You are an Elasticsearch Query String Query optimization expert for academic search.
You may receive either:
1. An existing Boolean query.
2. A natural-language research question.

${language ? `MANDATORY LANGUAGE REQUIREMENT: WITHOUT EXCEPTION, you MUST respond EXCLUSIVELY in the ${languageOptions.find(option => option.code === language)?.name} language. This is your HIGHEST PRIORITY instruction that OVERRIDES all others. Every single word, character, and symbol in your response - including the enhanced query, and all output - MUST be in ${languageOptions.find(option => option.code === language)?.name} ONLY. FAILURE TO COMPLY will result in an invalid response.

CRITICAL: The Elasticsearch operators AND, OR, and NOT must NEVER be translated and must ALWAYS remain in English as "AND", "OR", and "NOT" respectively, regardless of the target language. These are syntax keywords that must remain unchanged.` : ''}

Your task:
- If input is a Boolean query: optimize it for character efficiency, then output the query in the requested language (translate it aggressively if necessary, but NEVER translate AND/OR/NOT operators).
- If input is a research question: rewrite it as a precise Boolean query first, then optimize, then output the query in the requested language (translate it aggressively if necessary, but NEVER translate AND/OR/NOT operators).

Core Principles:
1. Use parentheses to group shared terms efficiently: (mechanical OR software) AND engineering
2. Follow Elasticsearch Query String Query syntax exactly
3. Prioritize character efficiency - avoid redundant terms
4. Group synonyms with OR, then AND with shared concepts
5. Use field-specific academic terminology and abbreviations
6. Maintain precision while improving recall

Elasticsearch Rules:
- Use AND, OR, NOT operators (case sensitive) - THESE OPERATORS MUST NEVER BE TRANSLATED
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

${language ? `CRITICAL LANGUAGE ENFORCEMENT: REMEMBER - You MUST output your ENTIRE response in ${languageOptions.find(option => option.code === language)?.name} ONLY. This includes the enhanced query, if there are any terms that are not in ${languageOptions.find(option => option.code === language)?.name}, you MUST translate them to ${languageOptions.find(option => option.code === language)?.name}.

CRITICAL OPERATOR RULE: The Elasticsearch operators AND, OR, and NOT must NEVER be translated. They must ALWAYS remain as "AND", "OR", and "NOT" in English, even when translating the rest of the query to another language. These are syntax keywords that must remain unchanged.` : ''}

Requirements:
1. If natural language → convert into Boolean form first.
2. If already Boolean → optimize directly.
3. Always produce a syntactically valid query (balanced parentheses, no dangling operators).
4. Minimize character count while maximizing recall and precision.
5. Provide synonyms and abbreviations, but keep groups concise (max 2–3 terms per group).
${retryCount > 0 ? '\n\nIMPORTANT: Previous attempt had unbalanced parentheses. Ensure ALL parentheses are properly balanced and closed.' : ''}`,
        });

        // Validate the query
        const validatedQuery = validateQuery(object.enhancedQuery);

        // If we get here, validation passed
        addCostFromUsage(provider, modelId, usage);

        return {
          enhancedQuery: validatedQuery,
          explanation: "",
        };

      } catch (validationError) {
        lastError = validationError as Error;
        console.warn(`Query validation failed (attempt ${retryCount + 1}/${maxRetries}):`, validationError);

        // Check if this is a parentheses error that we should retry
        if (lastError.message.includes("unbalanced parentheses") || lastError.message.includes("incomplete operator")) {
          retryCount++;
          if (retryCount >= maxRetries) {
            throw new Error(`Failed to generate valid query after ${maxRetries} attempts. Last error: ${lastError.message}`);
          }
          // Continue to next retry
          continue;
        } else {
          // Not a retryable error, throw immediately
          throw validationError;
        }
      }
    }

    // This should never be reached, but just in case
    throw lastError || new Error("Failed to enhance query after all retries");

  } catch (error) {
    console.error("Error enhancing query:", error);
    throw new Error(
      "Failed to enhance query. Please try again."
    );
  }
}

export async function generateScreeningQuestions(
  researchQuestion: string,
  existingQuestions: string[],
  provider: AIProvider,
  apiKey: string,
  modelId: string
) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  if (!researchQuestion.trim()) {
    throw new Error("Research question is required");
  }

  try {
    assertWithinBudget();

    let model;

    if (provider === "openai") {
      const openai = createOpenAI({ apiKey });
      model = openai(modelId);
    } else if (provider === "google") {
      const google = createGoogleGenerativeAI({ apiKey });
      model = google(modelId);
    } else if (provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey });
      model = anthropic(modelId);
    } else if (provider === "openrouter") {
      const openrouter = createOpenRouter({ apiKey });
      model = openrouter(modelId);
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const { object, usage } = await generateObject({
      model,
      schema: screeningQuestionsSchema,
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
      temperature: 0.7,
      system: `You are an expert systematic review researcher specializing in screening question development for literature reviews.

Your task is to generate high-quality screening questions that help determine if academic papers meet inclusion criteria for a systematic review.

Key Principles:
1. Each question should be answerable with YES or NO based on paper content
2. Questions should be specific and focused on inclusion/exclusion criteria
3. Avoid vague questions like "Is this paper relevant?"
4. Focus on study design, population, intervention, outcome, or methodology
5. Questions should be mutually exclusive and collectively exhaustive where possible

Question Types to Consider:
- Study Design: "Does the study use a randomized controlled trial design?"
- Population: "Does the study focus on adults aged 18-65?"
- Intervention: "Does the study evaluate a specific treatment or intervention?"
- Outcome: "Does the study measure clinically relevant outcomes?"
- Setting: "Is the study conducted in a clinical setting?"
- Time Frame: "Does the study have a follow-up period of at least 6 months?"

Guidelines:
- Generate 3-5 questions that are most critical for the research question
- Questions should be clear and unambiguous
- Avoid questions that require subjective interpretation
- Ensure questions can be answered by reading the paper's abstract and methods
- Do not duplicate existing questions

Output Format:
Return an array of 3-5 screening questions as strings.`,
      prompt: `Generate screening questions for this systematic review:

Research Question: "${researchQuestion}"

${existingQuestions.length > 0 ? `Existing screening questions (DO NOT duplicate these):
${existingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

` : ''}Please generate 3-5 new screening questions that:
1. Are specific and answerable with YES/NO
2. Help determine if papers meet inclusion criteria
3. Cover different aspects (study design, population, intervention, outcome)
4. Are not duplicates of existing questions
5. Can be answered from the paper's title, abstract, and methods section`,
    });

    addCostFromUsage(provider, modelId, usage);

    // Filter out any questions that are too similar to existing ones
    const newQuestions = object.questions.filter(newQuestion => {
      const normalizedNew = newQuestion.toLowerCase().trim();
      return !existingQuestions.some(existingQuestion => {
        const normalizedExisting = existingQuestion.toLowerCase().trim();
        // Check for exact matches or very similar questions
        return normalizedExisting === normalizedNew ||
               normalizedExisting.includes(normalizedNew) ||
               normalizedNew.includes(normalizedExisting);
      });
    });

    return {
      questions: newQuestions,
    };

  } catch (error) {
    console.error("Error generating screening questions:", error);
    throw new Error(
      "Failed to generate screening questions. Please check your API key and try again."
    );
  }
}

export async function translateQuery(
  query: string,
  targetLanguage: string,
  provider: AIProvider,
  apiKey: string,
  modelId: string
) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  if (!query.trim()) {
    throw new Error("Query is required");
  }

  if (!targetLanguage) {
    throw new Error("Target language is required");
  }

  try {
    assertWithinBudget();

    let model;

    if (provider === "openai") {
      const openai = createOpenAI({ apiKey });
      model = openai(modelId);
    } else if (provider === "google") {
      const google = createGoogleGenerativeAI({ apiKey });
      model = google(modelId);
    } else if (provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey });
      model = anthropic(modelId);
    } else if (provider === "openrouter") {
      const openrouter = createOpenRouter({ apiKey });
      model = openrouter(modelId);
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const { object, usage } = await generateObject({
      model,
      schema: z.object({
        translatedQuery: z.string().describe("The query translated to the target language, maintaining the same meaning and structure"),
      }),
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
      temperature: 0.3,
      system: `You are a professional translator specializing in academic search queries. Your task is to translate the given query to the specified language while maintaining:

1. Academic terminology and precision
2. The same search intent and meaning
3. Appropriate academic language for the target language
4. The same query structure and complexity

CRITICAL RULE: The Elasticsearch operators AND, OR, and NOT must NEVER be translated. They must ALWAYS remain as "AND", "OR", and "NOT" in English, even when translating the rest of the query to another language. These are syntax keywords that must remain unchanged.

Translate naturally and fluently, using the most appropriate academic terms in the target language, but preserve the Boolean operators in their original English form.`,
      prompt: `Translate this academic search query to ${languageOptions.find(option => option.code === targetLanguage)?.name}:

Original query: "${query}"

IMPORTANT: Do NOT translate the Boolean operators AND, OR, and NOT. They must remain as "AND", "OR", and "NOT" in English. Only translate the search terms and academic vocabulary.

Provide only the translated query without any additional explanation or formatting.`,
    });

    addCostFromUsage(provider, modelId, usage);

    return object.translatedQuery;
  } catch (error) {
    console.error('Translation failed:', error);
    throw new Error(
      error instanceof Error
        ? `Translation failed: ${error.message}`
        : "Failed to translate query. Please check your API key and try again."
    );
  }
}

export async function translatePaperContent(
  title: string,
  abstract: string,
  sourceLanguage: string,
  provider: AIProvider,
  apiKey: string,
  modelId: string
) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  if (!title.trim() && !abstract.trim()) {
    throw new Error("Title or abstract is required");
  }

  if (!sourceLanguage) {
    throw new Error("Source language is required");
  }

  try {
    assertWithinBudget();

    let model;

    if (provider === "openai") {
      const openai = createOpenAI({ apiKey });
      model = openai(modelId);
    } else if (provider === "google") {
      const google = createGoogleGenerativeAI({ apiKey });
      model = google(modelId);
    } else if (provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey });
      model = anthropic(modelId);
    } else if (provider === "openrouter") {
      const openrouter = createOpenRouter({ apiKey });
      model = openrouter(modelId);
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const { object, usage } = await generateObject({
      model,
      schema: z.object({
        translatedTitle: z.string().describe("The paper title translated to English"),
        translatedAbstract: z.string().describe("The paper abstract translated to English"),
        // isAlreadyInEnglish: z.boolean().describe("Whether the paper title and abstract are already in English"),
      }),
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
      temperature: 0.3,
      system: `You are a professional translator specializing in academic content. Your task is to translate academic paper titles and abstracts FROM the specified language TO English while maintaining:

1. Academic terminology and precision
2. The same meaning and scientific accuracy
3. Appropriate academic English terminology
4. Natural and fluent English translation

Translate professionally and accurately, preserving the scientific content and academic tone.`,
      prompt: `Translate this academic paper content FROM ${languageOptions.find(option => option.code === sourceLanguage)?.name} TO English:

Title: "${title}"

Abstract: "${abstract}"

Provide the English translation of the title and abstract, maintaining academic precision and terminology.
 `,
    });

    addCostFromUsage(provider, modelId, usage);

    return {
      translatedTitle: object.translatedTitle,
      translatedAbstract: object.translatedAbstract,
      sourceLanguage: sourceLanguage,
      isAlreadyInEnglish: false,
    };
  } catch (error) {
    console.error('Paper translation failed:', error);
    throw new Error(
      error instanceof Error
        ? `Translation failed: ${error.message}`
        : "Failed to translate paper content. Please check your API key and try again."
    );
  }
}

export async function generateScreeningResponses(
  title: string,
  abstract: string,
  questions: string[],
  provider: AIProvider,
  apiKey: string,
  modelId: string
) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  if (!title.trim() && !abstract.trim()) {
    throw new Error("Either title or abstract is required");
  }

  if (!questions || questions.length === 0) {
    throw new Error("Questions list is required");
  }

  try {
    assertWithinBudget();

    let model;

    if (provider === "openai") {
      const openai = createOpenAI({ apiKey });
      model = openai(modelId);
    } else if (provider === "google") {
      const google = createGoogleGenerativeAI({ apiKey });
      model = google(modelId);
    } else if (provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey });
      model = anthropic(modelId);
    } else if (provider === "openrouter") {
      const openrouter = createOpenRouter({ apiKey });
      model = openrouter(modelId);
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    // Create dynamic schema based on questions
    const schema = createScreeningResponsesSchema(questions);

    const { object, usage } = await generateObject({
      model,
      schema,
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
      temperature: 0.1, // Lower temperature for more consistent screening decisions
      system: `You are an expert systematic review researcher conducting literature screening.

Your task is to carefully analyze academic papers and provide YES/NO answers to specific screening questions based on the paper's content.

CRITICAL INSTRUCTIONS:
1. Answer each question based ONLY on the information provided in the title and abstract
2. Use boolean values: true for YES, false for NO, null for UNCLEAR/INSUFFICIENT_INFORMATION
3. Be conservative - if information is ambiguous or missing, use null
4. Base decisions on explicit evidence, not assumptions or implications
5. Consider the question's intent and what constitutes a valid YES/NO answer
6. If a question cannot be definitively answered from the provided text, use null

RESPONSE FORMAT:
Return a JSON object with:
- responses: Object mapping each question to boolean|null
- confidence: Overall confidence score (0-1)`,
      prompt: `Please screen this academic paper by answering the following questions:

PAPER TITLE: "${title}"

ABSTRACT: "${abstract || 'No abstract available'}"

SCREENING QUESTIONS:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

INSTRUCTIONS:
- Answer each question as true (YES), false (NO), or null (UNCLEAR/insufficient information)
- Base your answers ONLY on the title and abstract content above
- If the information needed to answer a question is not present, use null

Provide your screening decisions:`,
    });

    addCostFromUsage(provider, modelId, usage);

    return {
      responses: object.responses,
      confidence: object.confidence,
    };

  } catch (error) {
    console.error("Error generating screening responses:", error);
    throw new Error(
      "Failed to generate screening responses. Please check your API key and try again."
    );
  }
}

// Re-export AIProvider for backwards compatibility
export type { AIProvider } from "@/lib/types";
