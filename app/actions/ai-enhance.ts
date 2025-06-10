'use server';

import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

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
    let model;
    
    if (provider === 'openai') {
      const openai = createOpenAI({ apiKey });
      model = openai('gpt-4-turbo', {
        structuredOutputs: true,
      });
    } else {
      const google = createGoogleGenerativeAI({ apiKey });
      model = google('gemini-1.5-flash');
    }

    const result = await generateObject({
      model,
      schema: queryEnhancementSchema,
      system: `You are an academic search query optimization expert. Your task is to enhance search queries for academic papers and research articles to make them more comprehensive and effective.

Guidelines for enhancement:
1. Add relevant synonyms and alternative terms using OR operators
2. Group related concepts with AND operators
3. Use parentheses for proper logical grouping
4. Maintain academic and scientific terminology
5. Consider field-specific jargon and common variations
6. Keep the enhanced query readable and not overly complex
7. Preserve the original intent and scope of the query

Focus on improving recall while maintaining precision for academic search engines.`,
      prompt: `Enhance this academic search query to improve search results by adding synonyms, alternative terms, and proper boolean operators:

Original query: "${query}"

Provide an enhanced version that maintains the original intent but captures more relevant papers through strategic use of synonyms and boolean logic.`,
    });

    return {
      enhancedQuery: result.object.enhancedQuery,
      explanation: result.object.explanation,
    };
  } catch (error) {
    console.error('Error enhancing query:', error);
    throw new Error('Failed to enhance query. Please check your API key and try again.');
  }
} 