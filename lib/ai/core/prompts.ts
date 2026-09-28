import type { EnhanceSearchQueryInput, GenerateScreeningQuestionsInput, GenerateExtractionQuestionsInput, TranslateQueryInput, TranslatePaperContentInput, GenerateScreeningResponsesInput } from './types'
import { getLanguageName } from './languages'

const OQL_RULES = `OpenAlex Query Language (OQL) rules:
- Write only the part after "works where". Never start with "works where".
- Search text with has: title/abstract has (...), title has (...), abstract has (...).
- Inside has (...), join terms with and, or, not, and group them with parentheses.
- Bare words are stemmed: education also matches educational and educated.
- Quotes mean an exact, unstemmed phrase: "machine learning". Write stemmed "large language model" for a phrase that should still match plurals.
- Wildcards go inside quotes: "educat*".
- Other filters join with and: year >= (2020), type is (article or review), language is (en).
- Never use Elasticsearch syntax such as title:"x" or field prefixes inside has (...).
- OQL words (has, and, or, not, is, title, abstract, year, type, language, stemmed) are never translated.

Examples:
Q: "What are the effects of climate change on agriculture in Africa?"
→ title/abstract has ((climate or "global warming") and (agriculture or crop) and africa)

Q: "AI in education since 2020"
→ title/abstract has (("artificial intelligence" or AI or chatgpt) and (education or student or teacher)) and year >= (2020)`

function buildEnhanceOqlPrompts(input: EnhanceSearchQueryInput, languageName: string | null | undefined, retryCount: number) {
  return {
    system: `You write OpenAlex Query Language (OQL) searches for academic literature.

CRITICAL: You MUST respond with valid JSON in the following format:
{
  "enhancedQuery": "your OQL query here"
}

You may receive an existing OQL query, a natural-language research question, or instructions about a query. Keep an existing query's structure and filters, and change only what the input asks for.
${languageName ? `\nWrite the search terms in ${languageName}. Keep the OQL words in English.\n` : ''}
${OQL_RULES}`,
    prompt: `Write an OQL search for this input:
"${input.query}"

Requirements:
1. Balanced parentheses and no dangling and, or, not.
2. Synonyms grouped with or, concepts joined with and.
3. Keep every filter clause (year, type, language and others) that is already in the query.${retryCount > 0 ? '\n\nIMPORTANT: The previous attempt had unbalanced parentheses or a dangling operator. Fix that.' : ''}`,
  }
}

export function buildEnhanceQueryPrompts(input: EnhanceSearchQueryInput, retryCount: number) {
  const language = input.language
  const languageName = language ? getLanguageName(language) : null
  if (input.syntax === 'oql') return buildEnhanceOqlPrompts(input, languageName, retryCount)

  return {
    system: `You are an Elasticsearch Query String Query optimization expert for academic search.

CRITICAL: You MUST respond with valid JSON in the following format:
{
  "enhancedQuery": "your query here"
}

You may receive either:
1. An existing Boolean query.
2. A natural-language research question.

${language ? `MANDATORY LANGUAGE REQUIREMENT: WITHOUT EXCEPTION, you MUST respond EXCLUSIVELY in the ${languageName} language. This is your HIGHEST PRIORITY instruction that OVERRIDES all others. Every single word, character, and symbol in your response - including the enhanced query, and all output - MUST be in ${languageName} ONLY. FAILURE TO COMPLY will result in an invalid response.

CRITICAL: The Elasticsearch operators AND, OR, and NOT must NEVER be translated. They must ALWAYS remain as the literal strings "AND", "OR", and "NOT" regardless of the target language. These are syntax keywords that must remain unchanged.` : ''}

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
- Wildcards: algorithm* for variations (ON A BARE TERM ONLY)
- NEVER put a wildcard (* or ?) inside a quoted phrase. "contextual support*" is INVALID and is rejected by the search engine. To wildcard a multi-word concept, drop the quotes (contextual support*) or split it: "contextual support" OR support*
- Field searches: title:"deep learning"

Validation Rules:
- Always return a complete Boolean query with balanced parentheses
- Never leave unfinished groups
- Do not end with OR, AND, or NOT
- Never place a wildcard (* or ?) inside quotes — no "phrase*"
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
Input query: "${input.query}"

${language ? `CRITICAL LANGUAGE ENFORCEMENT: REMEMBER - You MUST output your ENTIRE response in ${languageName} ONLY. This includes the enhanced query, if there are any terms that are not in ${languageName}, you MUST translate them to ${languageName}.

CRITICAL OPERATOR RULE: The Elasticsearch operators AND, OR, and NOT must NEVER be translated. They must ALWAYS remain as the literal strings "AND", "OR", and "NOT", even when translating the rest of the query. These are syntax keywords that must remain unchanged.` : ''}

Requirements:
1. If natural language → convert into Boolean form first.
2. If already Boolean → optimize directly.
3. Always produce a syntactically valid query (balanced parentheses, no dangling operators).
4. Minimize character count while maximizing recall and precision.
5. Provide synonyms and abbreviations, but keep groups concise (max 2–3 terms per group).
${retryCount > 0 ? '\n\nIMPORTANT: Previous attempt had unbalanced parentheses. Ensure ALL parentheses are properly balanced and closed.' : ''}`,
  }
}

export function buildScreeningQuestionsPrompts(input: GenerateScreeningQuestionsInput) {
  const responseLanguage = input.responseLanguage;
  const languageName = responseLanguage ? getLanguageName(responseLanguage) : null;

  return {
    system: `You are an expert systematic review researcher specializing in screening question development for literature reviews.

CRITICAL: You MUST respond with valid JSON in the following format:
{
  "questions": ["question 1", "question 2", "question 3"]
}

${languageName ? `MANDATORY: Generate all questions in ${languageName} only. All output must be in this language.` : ""}

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

Research Question: "${input.researchQuestion}"

${input.existingQuestions.length > 0 ? `Existing screening questions (DO NOT duplicate these):
${input.existingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

` : ''}Please generate 3-5 new screening questions that:
1. Are specific and answerable with YES/NO
2. Help determine if papers meet inclusion criteria
3. Cover different aspects (study design, population, intervention, outcome)
4. Are not duplicates of existing questions
5. Can be answered from the paper's title, abstract, and methods section
${languageName ? `\n\nMANDATORY: Generate all questions in ${languageName} only.` : ""}`,
  }
}

export function buildTranslateQueryPrompts(input: TranslateQueryInput) {
  if (input.syntax === 'oql') {
    return {
      system: `You translate the search terms of an OpenAlex Query Language (OQL) query for academic search. Keep the query's structure, clauses, parentheses, quotes and filters exactly as they are. Translate only the words and phrases being searched for, using the academic terms of the target language.

${OQL_RULES}`,
      prompt: `Translate the search terms of this OQL query to ${getLanguageName(input.targetLanguage)}:

${input.query}

Provide only the translated OQL query.`,
    }
  }
  return {
    system: `You are a professional translator specializing in academic search queries. Your task is to translate the given query to the specified language while maintaining:

1. Academic terminology and precision
2. The same search intent and meaning
3. Appropriate academic language for the target language
4. The same query structure and complexity

CRITICAL RULE: The Elasticsearch operators AND, OR, and NOT must NEVER be translated. They must ALWAYS remain as the literal strings "AND", "OR", and "NOT", even when translating the rest of the query. These are syntax keywords that must remain unchanged.

CRITICAL RULE: Never place a wildcard (* or ?) inside a quoted phrase (e.g. "term*" is INVALID and rejected by the search engine). Preserve wildcards exactly where they already sit on bare, unquoted terms; do not move one into quotes when translating.

Translate naturally and fluently, using the most appropriate academic terms in the target language, but preserve the Boolean operators AND, OR, NOT as literal strings.`,
    prompt: `Translate this academic search query to ${getLanguageName(input.targetLanguage)}:

Original query: "${input.query}"

IMPORTANT: Do NOT translate the Boolean operators AND, OR, and NOT. They must remain as the literal strings "AND", "OR", and "NOT". Only translate the search terms and academic vocabulary.

Provide only the translated query without any additional explanation or formatting.`,
  }
}

export function buildTranslatePaperContentPrompts(input: TranslatePaperContentInput) {
  const targetLanguage = input.targetLanguage ?? "en";
  const targetLanguageName = getLanguageName(targetLanguage) ?? targetLanguage;

  return {
    system: `You are a professional translator specializing in academic content.

CRITICAL: You MUST respond with valid JSON in the following format:
{
  "translatedTitle": "translated title here",
  "translatedAbstract": "translated abstract here"
}

Your task is to translate academic paper titles and abstracts TO ${targetLanguageName} while maintaining:

1. Academic terminology and precision
2. The same meaning and scientific accuracy
3. Appropriate academic terminology for the target language
4. Natural and fluent translation in ${targetLanguageName}

Translate professionally and accurately, preserving the scientific content and academic tone.`,
    prompt: `Detect the original language and translate this academic paper content TO ${targetLanguageName}:

Title: "${input.title}"

Abstract: "${input.abstract}"

Provide the ${targetLanguageName} translation of the title and abstract, maintaining academic precision and terminology.`,
  }
}

export function buildScreeningResponsesPrompts(input: GenerateScreeningResponsesInput) {
  return {
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

PAPER TITLE: "${input.title}"

ABSTRACT: "${input.abstract || 'No abstract available'}"

SCREENING QUESTIONS:
${input.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

INSTRUCTIONS:
- Answer each question as true (YES), false (NO), or null (UNCLEAR/insufficient information)
- Base your answers ONLY on the title and abstract content above
- If the information needed to answer a question is not present, use null

Provide your screening decisions:`,
  }
}

export function buildExtractionQuestionsPrompts(input: GenerateExtractionQuestionsInput) {
  const responseLanguage = input.responseLanguage;
  const languageName = responseLanguage ? getLanguageName(responseLanguage) : null;

  return {
    system: `You are a systematic review data extraction expert. Generate structured questions for extracting data from research papers.

${languageName ? `MANDATORY: Generate all questions in ${languageName} only. All output must be in this language.` : ""}

CRITICAL: You MUST respond with valid JSON in the following format:
{
  "questions": [
    { "question": "...", "type": "string", "description": "..." },
    { "question": "...", "type": "boolean" }
  ]
}

Each question needs a type:
- "string" for free text answers (e.g., study design, main findings)
- "boolean" for yes/no answers (e.g., was blinding used?)
- "number" for numeric values (e.g., sample size, effect size)
- "array" for lists (e.g., list of outcomes measured, list of interventions)

Focus on key elements for systematic review data extraction:
- PICO elements (Population, Intervention, Comparator, Outcome)
- Study characteristics (design, setting, duration, sample size)
- Methodology (randomization, blinding, allocation concealment)
- Results and outcomes (primary outcomes, effect sizes, statistical significance)
- Quality and bias assessment

Guidelines:
- Generate 3-7 questions that are most critical for the research topic
- Questions should be clear and specific
- Each question should target a single data point
- Include a brief description when the question needs clarification
- Do not duplicate existing questions`,
    prompt: `Generate data extraction questions for this systematic review:

Job Name: "${input.jobName}"

${input.sourceContext ? `Source Context:\n${input.sourceContext}\n` : ''}${input.existingQuestions.length > 0 ? `Existing questions (DO NOT duplicate these):
${input.existingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

` : ''}Please generate 3-7 data extraction questions that:
1. Are specific and target a single data point each
2. Have appropriate types (string, boolean, number, or array)
3. Cover key aspects of the research topic
4. Are not duplicates of existing questions
5. Include optional descriptions for complex questions
${languageName ? `\n\nMANDATORY: Generate all questions in ${languageName} only.` : ""}`,
  }
}
