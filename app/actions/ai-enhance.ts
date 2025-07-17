import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { GOOGLE_MODEL, OPENAI_MODEL } from '@/lib/screening-utils';
import { assertWithinBudget, addCostFromUsage } from '@/lib/ai-cost';

export type AIProvider = 'openai' | 'google';

const queryEnhancementSchema = z.object({
  enhancedQuery: z.string().describe('The enhanced search query with synonyms, AND/OR operators, and parentheses for proper grouping'),
  explanation: z.string().describe('A brief explanation of how the query was enhanced and what improvements were made'),
});

export async function enhanceSearchQuery(
  query: string,
  provider: AIProvider,
  apiKey: string
) {
  if (!apiKey) {
    throw new Error('API key is required');
  }

  if (!query.trim()) {
    throw new Error('Query is required');
  }

  try {
    assertWithinBudget();

    let model;
    
    if (provider === 'openai') {
      const openai = createOpenAI({ apiKey });
      model = openai(OPENAI_MODEL);
    } else {
      const google = createGoogleGenerativeAI({ apiKey });
      model = google(GOOGLE_MODEL);
    }

    const { object, usage } = await generateObject({
      model,
      schema: queryEnhancementSchema,
      system: `You are an Elasticsearch Query String Query optimization expert for academic search. Your task is to enhance queries following Elasticsearch syntax rules while maximizing character efficiency.

Core Principles:
1. Use parentheses to group shared terms efficiently: (mechanical OR software) AND engineering
2. Follow Elasticsearch Query String Query syntax exactly
3. Prioritize character efficiency - avoid redundant terms
4. Group synonyms with OR, then AND with shared concepts
5. Use field-specific academic terminology and abbreviations
6. Maintain search precision while improving recall

Elasticsearch Rules:
- Use AND, OR, NOT operators (case sensitive)
- Group with parentheses for precedence
- Use quotes for exact phrases: "machine learning"
- Wildcards: algorithm* for variations
- Field searches: title:"deep learning"

Character Optimization Examples:
- Instead of: "mechanical engineering" OR "software engineering"
- Use: (mechanical OR software) AND engineering
- Instead of: "artificial intelligence" OR "machine learning" OR "deep learning"  
- Use: (artificial OR machine OR deep) AND (intelligence OR learning)

Focus on creating compact, precise queries that follow Elasticsearch syntax.`,
      prompt: `Enhance this academic search query using Elasticsearch Query String Query syntax. Prioritize parentheses for efficient grouping and character optimization:

Original query: "${query}"

Requirements:
1. Use parentheses to group shared terms: (term1 OR term2) AND shared_term
2. Follow Elasticsearch syntax exactly (AND, OR, NOT in caps)
3. Minimize character count while maximizing search coverage
4. Add relevant academic synonyms and abbreviations
5. Group efficiently to avoid redundant terms

Provide a character-efficient enhanced query that captures more relevant academic papers.`,
    });

    addCostFromUsage(provider, usage);

    return {
      enhancedQuery: object.enhancedQuery,
      explanation: object.explanation,
    };
  } catch (error) {
    console.error('Error enhancing query:', error);
    throw new Error('Failed to enhance query. Please check your API key and try again.');
  }
} 