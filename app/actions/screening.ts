
import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import type { ScreeningDocument, ScreeningQuestion, ScreeningResult } from '@/lib/store';
import { 
  DEFAULT_BATCH_SIZE, 
  MAX_PARALLEL_REQUESTS, 
  generateSystemPrompt, 
  generateUserPrompt,
  OPENAI_MODEL,
  GOOGLE_MODEL
} from '@/lib/screening-utils';

export type AIProvider = 'openai' | 'google';

// Create dynamic Zod schema based on questions
function createScreeningSchema(questions: ScreeningQuestion[]) {
  const responseProperties: Record<string, any> = {};
  
  for (const question of questions) {
    switch (question.type) {
      case 'string':
        responseProperties[question.key] = z.string().describe(question.question);
        break;
      case 'boolean':
        responseProperties[question.key] = z.boolean().describe(question.question);
        break;
      case 'array':
        responseProperties[question.key] = z.array(z.string()).describe(question.question);
        break;
      case 'number':
        responseProperties[question.key] = z.number().describe(question.question);
        break;
    }
  }
  
  return z.object({
    responses: z.object(responseProperties),
    reasoning: z.string().describe('Brief explanation of the screening decisions'),
    confidence: z.number().min(0).max(1).describe('Confidence level in the screening (0-1)'),
    flags: z.array(z.string()).describe('Any red flags or concerns identified'),
  });
}

// Create AI model instance based on provider
function createModel(provider: AIProvider, apiKey: string) {
  switch (provider) {
    case 'openai':
      const openai = createOpenAI({ apiKey });
      return openai(OPENAI_MODEL);
    case 'google':
      const google = createGoogleGenerativeAI({ apiKey });
      return google(GOOGLE_MODEL);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}



// Screen a single document
async function screenDocument(
  document: ScreeningDocument,
  questions: ScreeningQuestion[],
  provider: AIProvider,
  apiKey: string
) {
  const model = createModel(provider, apiKey);
  const schema = createScreeningSchema(questions);
  
  try {
    const { object } = await generateObject({
      model,
      schema,
      system: generateSystemPrompt(questions),
      prompt: generateUserPrompt(document, questions),
      maxRetries: 2, // Retry on failures
      ...(provider === 'google' && {
        providerOptions: {
          google: {
            structuredOutputs: false,
          },
        },
      }),
    });

    return {
      ...object,
      documentId: document.id,
    };
  } catch (error) {
    console.error(`Error screening document ${document.id}:`, error);
    
    // Return a fallback response on error
    const fallbackResponses: Record<string, any> = {};
    questions.forEach(q => {
      switch (q.type) {
        case 'boolean':
          fallbackResponses[q.key] = false;
          break;
        case 'number':
          fallbackResponses[q.key] = 0;
          break;
        case 'string':
          fallbackResponses[q.key] = 'Error during screening';
          break;
        case 'array':
          fallbackResponses[q.key] = [];
          break;
      }
    });

    return {
      documentId: document.id,
      responses: fallbackResponses,
      reasoning: `Error occurred during AI screening: ${error instanceof Error ? error.message : 'Unknown error'}`,
      confidence: 0,
      flags: ['screening_error', 'requires_manual_review'],
      status: 'error',
    };
  }
}

// Process documents in batches with parallel requests
async function processBatch(
  documents: ScreeningDocument[],
  questions: ScreeningQuestion[],
  provider: AIProvider,
  apiKey: string,
  onProgress?: (completed: number, total: number) => void
) {
  const results: any[] = [];
  
  // Process documents in smaller parallel chunks
  for (let i = 0; i < documents.length; i += MAX_PARALLEL_REQUESTS) {
    const chunk = documents.slice(i, i + MAX_PARALLEL_REQUESTS);

    // Process chunk in parallel, capturing individual failures
    const settled = await Promise.allSettled(
      chunk.map((doc) => screenDocument(doc, questions, provider, apiKey))
    );

    settled.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        results.push(res.value);
      } else {
        console.error('AI screening error:', res.reason);
        // Fallback result for this document
        const doc = chunk[idx];
        const fallbackResponses: Record<string, any> = {};
        questions.forEach((q) => {
          switch (q.type) {
            case 'boolean':
              fallbackResponses[q.key] = false;
              break;
            case 'number':
              fallbackResponses[q.key] = 0;
              break;
            case 'string':
              fallbackResponses[q.key] = 'Error during screening';
              break;
            case 'array':
              fallbackResponses[q.key] = [];
              break;
          }
        });

        results.push({
          documentId: doc.id,
          responses: fallbackResponses,
          reasoning: 'Failed to generate response',
          confidence: 0,
          flags: ['screening_error', 'requires_manual_review'],
          status: 'error',
        });
      }
    });

    // Report progress
    if (onProgress) {
      onProgress(results.length, documents.length);
    }
  }
  
  return results;
}

// Main screening function with batching and progress tracking
export async function performScreening(
  documents: ScreeningDocument[],
  questions: ScreeningQuestion[],
  provider: AIProvider,
  apiKey: string,
  batchSize: number = DEFAULT_BATCH_SIZE,
  onProgress?: (completed: number, total: number, currentBatch: number, totalBatches: number) => void
): Promise<ScreeningResult[]> {
  if (!documents.length || !questions.length) {
    throw new Error('Documents and questions are required for screening');
  }

  if (!apiKey) {
    throw new Error('API key is required for AI screening');
  }

  const totalBatches = Math.ceil(documents.length / batchSize);
  const allResults: any[] = [];

  // Process documents in batches
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIndex = batchIndex * batchSize;
    const endIndex = Math.min(startIndex + batchSize, documents.length);
    const batch = documents.slice(startIndex, endIndex);

    console.log(`Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} documents)`);

    try {
      const batchResults = await processBatch(
        batch,
        questions,
        provider,
        apiKey,
        (completed, total) => {
          const globalCompleted = allResults.length + completed;
          if (onProgress) {
            onProgress(globalCompleted, documents.length, batchIndex + 1, totalBatches);
          }
        }
      );

      allResults.push(...batchResults);
    } catch (error) {
      console.error(`Error processing batch ${batchIndex + 1}:`, error);
      // Continue with next batch
    }

    // Add a small delay between batches to be respectful to API rate limits
    if (batchIndex < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Convert AI responses to ScreeningResult format
  const screeningResults: ScreeningResult[] = allResults.map((response) => {
    const isError = response.status === 'error' || (response.flags && response.flags.includes('screening_error'));
    return {
      documentId: response.documentId,
      answers: response.responses,
      status: isError ? 'error' : 'completed',
      completedAt: new Date().toISOString(),
      aiMetadata: {
        reasoning: response.reasoning,
        confidence: response.confidence,
        flags: response.flags,
        provider,
        model: provider === 'openai' ? OPENAI_MODEL : GOOGLE_MODEL,
        processedAt: new Date().toISOString(),
      },
    } as ScreeningResult;
  });

  return screeningResults;
}

 