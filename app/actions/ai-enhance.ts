import { z } from "zod";
import { generateObject } from "ai";
import { addCostFromUsage, assertWithinBudget } from "@/lib/ai-cost";
import { createAIModel } from "@/lib/ai-utils";
import { languageOptions } from "@/components/language-selector";
import type { AIProvider } from "@/lib/types";
import { captureAIGeneration } from "@/lib/posthog-ai";
import { jsonrepair } from "jsonrepair";

// ============================================================================
// JSON Repair Helpers
// ============================================================================

/**
 * Generic JSON repair function for AI responses
 * Handles cases where AI returns plain text instead of JSON
 */
async function repairJSON(text: string, error: any): Promise<string | null> {
  try {
    console.log('Attempting to repair text:', text);
    console.log('Parse error:', error);
    
    // If the text looks like a plain response (not JSON), wrap it in proper JSON
    if (!text.trim().startsWith('{')) {
      console.log('Wrapped plain text as JSON');
      return text.trim();
    }
    
    // Otherwise, try to repair malformed JSON
    const repaired = jsonrepair(text);
    console.log('Repaired JSON:', repaired);
    return repaired;
  } catch (repairError) {
    console.error('JSON repair failed:', repairError);
    
    // Last resort: if we have plain text, return it unwrapped
    if (typeof text === 'string' && text.trim().length > 0 && !text.trim().startsWith('{')) {
      return text.trim();
    }
    
    return null; // Cannot repair
  }
}

/**
 * Repair function for single-field responses (e.g., enhancedQuery, translatedQuery)
 */
async function repairSingleField(text: string, error: any, fieldName: string): Promise<string | null> {
  const result = await repairJSON(text, error);
  if (result === null) return null;
  
  // If we got plain text back, wrap it in the expected JSON structure
  if (!result.startsWith('{')) {
    return JSON.stringify({ [fieldName]: result });
  }
  
  return result;
}

/**
 * Standard provider options to disable thinking/reasoning for faster responses
 */
const STANDARD_PROVIDER_OPTIONS = {
  google: {
    thinkingConfig: {
      thinkingBudget: 0,
    },
  },
  openai: {
    reasoningEffort: "minimal" as const,
  },
};

/**
 * Given an OpenRouter-style error data object { message, code, metadata },
 * compose the most informative message by combining the base message with
 * provider details and raw upstream errors from metadata.
 */
function extractFromErrorData(data: Record<string, unknown>): string | null {
  const message = typeof data.message === "string" ? data.message : null;
  const metadata = data.metadata as Record<string, unknown> | null | undefined;

  if (!metadata || typeof metadata !== "object") {
    return message || null;
  }

  // Try to get the raw upstream provider error message
  const raw = metadata.raw as Record<string, unknown> | undefined;
  const rawMessage =
    raw && typeof raw === "object" && raw.error && typeof raw.error === "object"
      ? (raw.error as Record<string, unknown>).message
      : undefined;

  const providerName =
    typeof metadata.provider_name === "string" ? metadata.provider_name : null;

  // Prefer the raw upstream message (e.g. "Rate limit exceeded. Please retry after 20s")
  if (typeof rawMessage === "string" && rawMessage) {
    return providerName ? `${providerName}: ${rawMessage}` : rawMessage;
  }

  // Fall back to reasons array
  const reasons = Array.isArray(metadata.reasons)
    ? metadata.reasons.join(", ")
    : null;

  if (message && providerName && reasons) {
    return `${providerName}: ${message} (${reasons})`;
  }
  if (message && providerName) {
    return `${providerName}: ${message}`;
  }
  if (message && reasons) {
    return `${message} (${reasons})`;
  }

  return message || null;
}

/**
 * Extract the most useful error message from nested AI SDK / provider errors.
 *
 * Error structures vary by provider:
 * - AI SDK `APICallError`: wraps provider errors; real details in `responseBody`, `data`, or `cause`
 * - OpenRouter SDK errors: `error.error.message` has the provider message; `body` has raw JSON
 *   When OpenRouter proxies to an upstream provider that fails, the real details
 *   live in `error.metadata` (provider_name, reasons, raw upstream error).
 * - Plain `Error`: `.message` is sufficient
 */
function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return error ? String(error) : "Unknown error";
  }

  const err = error as Record<string, unknown>;

  // 1. AI SDK APICallError – parse responseBody JSON
  if (typeof err.responseBody === "string" && err.responseBody) {
    try {
      const body = JSON.parse(err.responseBody);
      if (body?.error && typeof body.error === "object") {
        const msg = extractFromErrorData(
          body.error as Record<string, unknown>
        );
        if (msg) return msg;
      }
    } catch {
      /* not JSON */
    }
  }

  // 2. AI SDK APICallError – pre-parsed data.error
  if (err.data && typeof err.data === "object") {
    const data = err.data as Record<string, unknown>;
    if (data.error && typeof data.error === "object") {
      const msg = extractFromErrorData(data.error as Record<string, unknown>);
      if (msg) return msg;
    }
  }

  // 3. OpenRouter SDK errors – error.error (structured error data)
  if (err.error && typeof err.error === "object") {
    const msg = extractFromErrorData(err.error as Record<string, unknown>);
    if (msg) return msg;
  }

  // 4. OpenRouter SDK errors – parse body string
  if (typeof err.body === "string" && err.body) {
    try {
      const body = JSON.parse(err.body);
      if (body?.error && typeof body.error === "object") {
        const msg = extractFromErrorData(
          body.error as Record<string, unknown>
        );
        if (msg) return msg;
      }
    } catch {
      /* not JSON */
    }
  }

  // 5. Recurse into cause (AI SDK often wraps the real error)
  if ("cause" in err && err.cause && err.cause !== error) {
    const causeMsg = extractErrorMessage(err.cause);
    if (causeMsg && causeMsg !== "Unknown error") return causeMsg;
  }

  // 6. Fall back to error.message
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown error";
}

/**
 * Enhanced error logging for AI failures
 */
function logAIError(context: string, error: unknown): void {
  console.error(`Error in ${context}:`, error);

  if (error && typeof error === 'object') {
    if ('cause' in error) {
      console.error("Error cause:", error.cause);
    }
    if ('text' in error) {
      console.error("Model output text:", error.text);
    }
  }
}

// ============================================================================
// Schema Definitions
// ============================================================================

// Define schema with strict validation requirements
const queryEnhancementSchema = z.object({
  enhancedQuery: z
    .string()
    .describe(
      "A complete, syntactically valid Boolean query string for OpenAlex-compatible search. Must have balanced parentheses, no unfinished groups, and no field:value prefixes."
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

const DISALLOWED_FIELD_PREFIX_REGEX =
  /(^|[\s(])([A-Za-z_][A-Za-z0-9_.-]*):(?=(?:"|\(|[^\s/)"]))/g;

function stripDisallowedFieldPrefixes(query: string): string {
  return query.replace(DISALLOWED_FIELD_PREFIX_REGEX, "$1");
}

function normalizeQueryWhitespace(query: string): string {
  return query
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function normalizeAndValidateQuery(query: string): string {
  const queryWithoutFieldPrefixes = stripDisallowedFieldPrefixes(query);
  const normalizedQuery = normalizeQueryWhitespace(queryWithoutFieldPrefixes);

  if (!normalizedQuery) {
    throw new Error(
      "Generated query is empty after removing disallowed field prefixes"
    );
  }

  if (!/[^\s()]/.test(normalizedQuery)) {
    throw new Error(
      "Generated query is invalid after removing disallowed field prefixes"
    );
  }

  const openParens = (normalizedQuery.match(/\(/g) || []).length;
  const closeParens = (normalizedQuery.match(/\)/g) || []).length;

  if (openParens !== closeParens) {
    throw new Error("Generated query has unbalanced parentheses");
  }

  if (/^(OR|AND|NOT)\b/.test(normalizedQuery)) {
    throw new Error("Generated query starts with an incomplete operator");
  }

  if (/\b(OR|AND|NOT)\s*$/.test(normalizedQuery)) {
    throw new Error("Generated query ends with an incomplete operator");
  }

  return normalizedQuery;
}

function isRetryableQueryValidationError(errorMessage: string): boolean {
  return [
    "Generated query has unbalanced parentheses",
    "Generated query starts with an incomplete operator",
    "Generated query ends with an incomplete operator",
    "Generated query is empty after removing disallowed field prefixes",
    "Generated query is invalid after removing disallowed field prefixes",
  ].some((message) => errorMessage.includes(message));
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

    const model = createAIModel(provider, apiKey, modelId);

    const maxRetries = 10;
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount < maxRetries) {
      const startTime = performance.now();
      try {
        const { object, usage } = await generateObject({
          model,
          schema: queryEnhancementSchema,
          experimental_repairText: async ({ text, error }) => 
            repairSingleField(text, error, 'enhancedQuery'),
          providerOptions: STANDARD_PROVIDER_OPTIONS,
          temperature: 1,
          system: `You are an OpenAlex academic search query optimization expert.

CRITICAL: You MUST respond with valid JSON in the following format:
{
  "enhancedQuery": "your query here"
}

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
2. Follow OpenAlex-compatible Boolean syntax (Elasticsearch-like subset)
3. Prioritize character efficiency - avoid redundant terms
4. Group synonyms with OR, then AND with shared concepts
5. Use domain-specific academic terminology and abbreviations
6. Maintain precision while improving recall

Syntax Rules:
- Use AND, OR, NOT operators (case sensitive) - THESE OPERATORS MUST NEVER BE TRANSLATED
- Group with parentheses for precedence
- Use quotes for exact phrases: "machine learning"
- Wildcards: algorithm* for variations
- NEVER use field prefixes of any kind (field:value), including title:, abstract:, author:, year:, etc.
- INVALID: title:"ai testing" OR (AI OR artificial) AND (testing OR evaluation)
- VALID: "ai testing" OR (AI OR artificial) AND (testing OR evaluation)

Validation Rules:
- Always return a complete Boolean query with balanced parentheses
- Never leave unfinished groups
- Do not end with OR, AND, or NOT
- Never output field:value syntax; output only plain Boolean terms and groups
- Limit synonym groups to the most common 2–3 academic terms to avoid truncation
- The final query must be executable in OpenAlex search

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
          prompt: `Enhance this academic search query using OpenAlex-compatible Boolean syntax.
Input query: "${query}"

${language ? `CRITICAL LANGUAGE ENFORCEMENT: REMEMBER - You MUST output your ENTIRE response in ${languageOptions.find(option => option.code === language)?.name} ONLY. This includes the enhanced query, if there are any terms that are not in ${languageOptions.find(option => option.code === language)?.name}, you MUST translate them to ${languageOptions.find(option => option.code === language)?.name}.

CRITICAL OPERATOR RULE: The Elasticsearch operators AND, OR, and NOT must NEVER be translated. They must ALWAYS remain as "AND", "OR", and "NOT" in English, even when translating the rest of the query to another language. These are syntax keywords that must remain unchanged.` : ''}

Requirements:
1. If natural language → convert into Boolean form first.
2. If already Boolean → optimize directly.
3. Always produce a syntactically valid query (balanced parentheses, no dangling operators).
4. Minimize character count while maximizing recall and precision.
5. Provide synonyms and abbreviations, but keep groups concise (max 2–3 terms per group).
6. NEVER use field prefixes (field:value), including title:, abstract:, author:, year:, or any other field name.
7. If you receive field:value syntax in input, convert it by removing field names and keeping only values.
8. INVALID EXAMPLE: title:"ai testing" OR (AI OR artificial) AND (testing OR evaluation)
9. VALID EXAMPLE: "ai testing" OR (AI OR artificial) AND (testing OR evaluation)
${retryCount > 0 ? '\n\nIMPORTANT: Previous attempt produced an invalid query. Ensure there are no field:value prefixes, all parentheses are balanced, and no dangling operators remain.' : ''}`,
        });

        // Validate the query
        const validatedQuery = normalizeAndValidateQuery(object.enhancedQuery);

        // If we get here, validation passed
        const latencyMs = performance.now() - startTime;
        addCostFromUsage(provider, modelId, usage);
        captureAIGeneration({
          provider, modelId,
          feature: "enhance_search_query",
          usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
          latencyMs,
          input: query,
          output: JSON.stringify(object),
        });

        return {
          enhancedQuery: validatedQuery,
          explanation: "",
        };

      } catch (validationError) {
        lastError = validationError as Error;
        console.warn(`Query validation failed (attempt ${retryCount + 1}/${maxRetries}):`, validationError);

        // Retry for validation errors so the model can self-correct
        if (isRetryableQueryValidationError(lastError.message)) {
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
    logAIError("enhanceSearchQuery", error);
    captureAIGeneration({
      provider, modelId,
      feature: "enhance_search_query",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
      input: query,
      output: "",
      isError: true,
      errorMessage: extractErrorMessage(error),
    });
    throw new Error(
      `Failed to enhance query. ${extractErrorMessage(error)}`
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

    const model = createAIModel(provider, apiKey, modelId);
    const startTime = performance.now();

    const { object, usage } = await generateObject({
      model,
      schema: screeningQuestionsSchema,
      experimental_repairText: async ({ text, error }) => repairJSON(text, error),
      providerOptions: STANDARD_PROVIDER_OPTIONS,
      temperature: 0.7,
      system: `You are an expert systematic review researcher specializing in screening question development for literature reviews.

CRITICAL: You MUST respond with valid JSON in the following format:
{
  "questions": ["question 1", "question 2", "question 3"]
}

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

    const latencyMs = performance.now() - startTime;
    addCostFromUsage(provider, modelId, usage);
    captureAIGeneration({
      provider, modelId,
      feature: "generate_screening_questions",
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      latencyMs,
      input: researchQuestion,
      output: JSON.stringify(object),
    });

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
    logAIError("generateScreeningQuestions", error);
    captureAIGeneration({
      provider, modelId,
      feature: "generate_screening_questions",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
      input: researchQuestion,
      output: "",
      isError: true,
      errorMessage: extractErrorMessage(error),
    });
    throw new Error(extractErrorMessage(error));
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

    const model = createAIModel(provider, apiKey, modelId);
    const startTime = performance.now();

    const { object, usage } = await generateObject({
      model,
      schema: z.object({
        translatedQuery: z.string().describe("The query translated to the target language, maintaining the same meaning and structure"),
      }),
      experimental_repairText: async ({ text, error }) => 
        repairSingleField(text, error, 'translatedQuery'),
      providerOptions: STANDARD_PROVIDER_OPTIONS,
      temperature: 0.3,
      system: `You are a professional translator specializing in academic search queries. Your task is to translate the given query to the specified language while maintaining:

1. Academic terminology and precision
2. The same search intent and meaning
3. Appropriate academic language for the target language
4. The same query structure and complexity

CRITICAL RULE: The Elasticsearch operators AND, OR, and NOT must NEVER be translated. They must ALWAYS remain as "AND", "OR", and "NOT" in English, even when translating the rest of the query to another language. These are syntax keywords that must remain unchanged.
CRITICAL RULE: Never output field prefixes of any kind (field:value), including title:, abstract:, author:, year:, etc. If present in the source query, remove field names and keep only the value expression.
INVALID: title:"ai testing" OR (AI OR artificial) AND (testing OR evaluation)
VALID: "ai testing" OR (AI OR artificial) AND (testing OR evaluation)

Translate naturally and fluently, using the most appropriate academic terms in the target language, but preserve the Boolean operators in their original English form.`,
      prompt: `Translate this academic search query to ${languageOptions.find(option => option.code === targetLanguage)?.name}:

Original query: "${query}"

IMPORTANT: Do NOT translate the Boolean operators AND, OR, and NOT. They must remain as "AND", "OR", and "NOT" in English. Only translate the search terms and academic vocabulary.
IMPORTANT: Do NOT output any field:value syntax. Remove all field names such as title:, abstract:, author:, year:, etc.
INVALID EXAMPLE: title:"ai testing" OR (AI OR artificial) AND (testing OR evaluation)
VALID EXAMPLE: "ai testing" OR (AI OR artificial) AND (testing OR evaluation)

Provide only the translated query without any additional explanation or formatting.`,
    });

    const latencyMs = performance.now() - startTime;
    addCostFromUsage(provider, modelId, usage);
    captureAIGeneration({
      provider, modelId,
      feature: "translate_query",
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      latencyMs,
      input: query,
      output: JSON.stringify(object),
    });

    return normalizeAndValidateQuery(object.translatedQuery);
  } catch (error) {
    logAIError("translateQuery", error);
    captureAIGeneration({
      provider, modelId,
      feature: "translate_query",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
      input: query,
      output: "",
      isError: true,
      errorMessage: extractErrorMessage(error),
    });
    throw new Error(`Translation failed: ${extractErrorMessage(error)}`);
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

    const model = createAIModel(provider, apiKey, modelId);
    const startTime = performance.now();

    const { object, usage } = await generateObject({
      model,
      schema: z.object({
        translatedTitle: z.string().describe("The paper title translated to English"),
        translatedAbstract: z.string().describe("The paper abstract translated to English"),
      }),
      experimental_repairText: async ({ text, error }) => repairJSON(text, error),
      providerOptions: STANDARD_PROVIDER_OPTIONS,
      temperature: 0.3,
      system: `You are a professional translator specializing in academic content.

CRITICAL: You MUST respond with valid JSON in the following format:
{
  "translatedTitle": "translated title here",
  "translatedAbstract": "translated abstract here"
}

Your task is to translate academic paper titles and abstracts FROM the specified language TO English while maintaining:

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

    const latencyMs = performance.now() - startTime;
    addCostFromUsage(provider, modelId, usage);
    captureAIGeneration({
      provider, modelId,
      feature: "translate_paper_content",
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      latencyMs,
      input: `${title}\n\n${abstract}`,
      output: JSON.stringify(object),
    });

    return {
      translatedTitle: object.translatedTitle,
      translatedAbstract: object.translatedAbstract,
      sourceLanguage: sourceLanguage,
      isAlreadyInEnglish: false,
    };
  } catch (error) {
    logAIError("translatePaperContent", error);
    captureAIGeneration({
      provider, modelId,
      feature: "translate_paper_content",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
      input: `${title}\n\n${abstract}`,
      output: "",
      isError: true,
      errorMessage: extractErrorMessage(error),
    });
    throw new Error(`Translation failed: ${extractErrorMessage(error)}`);
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

    const model = createAIModel(provider, apiKey, modelId);

    // Create dynamic schema based on questions
    const schema = createScreeningResponsesSchema(questions);
    const startTime = performance.now();

    const { object, usage } = await generateObject({
      model,
      schema,
      experimental_repairText: async ({ text, error }) => repairJSON(text, error),
      providerOptions: STANDARD_PROVIDER_OPTIONS,
      temperature: 0.1, // Lower temperature for more consistent screening decisions
      system: `You are an expert systematic review researcher conducting literature screening.

CRITICAL: You MUST respond with valid JSON matching the required schema with "responses" object and "confidence" number.

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

    const latencyMs = performance.now() - startTime;
    addCostFromUsage(provider, modelId, usage);
    captureAIGeneration({
      provider, modelId,
      feature: "generate_screening_responses",
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      latencyMs,
      input: `${title}\n\n${abstract}`,
      output: JSON.stringify(object),
      metadata: { question_count: questions.length },
    });

    return {
      responses: object.responses as Record<string, boolean | null>,
      confidence: object.confidence,
    };

  } catch (error) {
    logAIError("generateScreeningResponses", error);
    captureAIGeneration({
      provider, modelId,
      feature: "generate_screening_responses",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
      input: `${title}\n\n${abstract}`,
      output: "",
      isError: true,
      errorMessage: extractErrorMessage(error),
      metadata: { question_count: questions.length },
    });
    throw new Error(extractErrorMessage(error));
  }
}

// Re-export AIProvider for backwards compatibility
export type { AIProvider } from "@/lib/types";
