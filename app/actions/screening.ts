
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
  GOOGLE_MODEL,
  PRICING
} from '@/lib/screening-utils';
import { downloadPDFFromURL } from './pdf-download';
import { buildZoteroHeaders, isZoteroFileUrl } from '@/lib/zotero-utils';
import { getZoteroFullText } from './zotero';
import { assertWithinBudget, addCostFromUsage } from '@/lib/ai-cost';

export type AIProvider = 'openai' | 'google';

// Centralized PDF download with local-first fallback
async function downloadPDFWithFallback(url: string, documentId: string, document?: ScreeningDocument, zoteroAuth?: { apiKey: string; groupId: string }): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
  console.log(`Attempting PDF download for document ${documentId} from: ${url}`);
  
  const isZoteroApiUrl = isZoteroFileUrl(url);
  
  // Try local/direct download first (faster)
  try {
    let headers: Record<string, string> = {
      'Accept': 'application/pdf,application/octet-stream,*/*',
      ...buildZoteroHeaders(),
    };

    // Add Zotero auth headers if this is a Zotero URL and we have auth info
    if (isZoteroApiUrl && zoteroAuth?.apiKey) {
      headers = {
        ...headers,
        ...buildZoteroHeaders(zoteroAuth.apiKey),
      };
      console.log(`Using Zotero auth for local download of document ${documentId}`);
    }

    // For Zotero URLs, first do HEAD request to get final URL
    if (isZoteroApiUrl) {
      const headResponse = await fetch(url, {
        method: 'HEAD',
        headers,
        redirect: 'follow',
      });

      // Handle rate limiting
      if (headResponse.status === 429) {
        const retryAfter = headResponse.headers.get('Retry-After');
        throw new Error(`Rate limited by Zotero API. Retry after ${retryAfter} seconds`);
      }

      // Handle backoff requests
      const backoff = headResponse.headers.get('Backoff');
      if (backoff) {
        console.warn(`Zotero API requests backoff of ${backoff} seconds for document ${documentId}`);
      }

      if (!headResponse.ok) {
        throw new Error(`Failed to get Zotero file URL. Status: ${headResponse.status} ${headResponse.statusText}`);
      }

      // For Zotero URLs, we got the final URL from HEAD request, now do GET
      const pdfResponse = await fetch(headResponse.url, {
        headers,
        redirect: 'follow',
      });

      // Handle rate limiting for GET request
      if (pdfResponse.status === 429) {
        const retryAfter = pdfResponse.headers.get('Retry-After');
        throw new Error(`Rate limited by Zotero API. Retry after ${retryAfter} seconds`);
      }

      if (!pdfResponse.ok) {
        throw new Error(`PDF fetch failed. Status: ${pdfResponse.status}`);
      }

      const arrayBuffer = await pdfResponse.arrayBuffer();
      console.log(`Direct PDF download successful for document ${documentId}`);
      return {
        success: true,
        data: arrayBuffer,
      };
    } else {
      // Non-Zotero URL - simple GET request
      const directResponse = await fetch(url, {
        headers,
        redirect: 'follow',
      });

      if (!directResponse.ok) {
        throw new Error(`Direct fetch failed. Status: ${directResponse.status}`);
      }

      const arrayBuffer = await directResponse.arrayBuffer();
      console.log(`Direct PDF download successful for document ${documentId}`);
      return {
        success: true,
        data: arrayBuffer,
      };
    }
  } catch (directError) {
    console.warn(`Direct PDF download failed for ${documentId}, using server action:`, directError);
    
    // Fall back to server action
    const serverResult = await downloadPDFFromURL(
      isZoteroApiUrl && zoteroAuth?.apiKey ? `${url}${url.includes('?') ? '&' : '?'}key=${zoteroAuth.apiKey}` : url,
      `${documentId}.pdf`
    );
    if (serverResult.success && serverResult.data) {
      console.log(`Server PDF download successful for document ${documentId}`);
      return {
        success: true,
        data: serverResult.data,
      };
    } else {
      return {
        success: false,
        error: serverResult.error || 'Both direct and server downloads failed',
      };
    }
  }
}

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
  apiKey: string,
  usePdfs: boolean = false,
  zoteroAuth?: { apiKey: string; groupId: string }
) {
  const model = createModel(provider, apiKey);

  // ---- budget guard ----------------------------------------------
  assertWithinBudget();
  const schema = createScreeningSchema(questions);
  
  // Track PDF status separately from screening success
  let pdfIncluded = false;
  let pdfError = false;
  let pdfErrorMessage: string | undefined = undefined;
  
  try {
    const systemPrompt = generateSystemPrompt(questions);
    
    // Build messages array with proper structure
    const messages = [];
    
    // Add system message
    messages.push({
      role: 'system' as const,
      content: systemPrompt,
    });
    
    // Build user message content
    const userContent = [];
    
    // Add text content
    userContent.push({
      type: 'text' as const,
      text: generateUserPrompt(document, questions, false), // Don't include PDF URL in text
    });
    
    // Add PDF file if requested and available
    if (usePdfs && document.open_access?.oa_url) {
      try {
        const pdfResult = await downloadPDFWithFallback(document.open_access.oa_url, document.id, document, zoteroAuth);

        if (pdfResult.success && pdfResult.data) {
          userContent.push({
            type: 'file' as const,
            data: pdfResult.data,
            mimeType: 'application/pdf',
            filename: `${document.id}.pdf`,
          });
          pdfIncluded = true;
          console.log(`PDF downloaded & included for document ${document.id}`);
        } else {
          // Attempt Zotero full-text fallback (only available for Zotero-origin docs)
          if (zoteroAuth && document.source === 'zotero' && (document.originalWork as any)?.key) {
            const text = await getZoteroFullText({
              groupId: zoteroAuth.groupId,
              itemKey: (document.originalWork as any).key,
              apiKey: zoteroAuth.apiKey,
            });

            if (text) {
              userContent.push({
                type: 'text' as const,
                text,
              });
              console.log(`Used Zotero full-text fallback for document ${document.id}`);
            } else {
              throw new Error(pdfResult.error || 'PDF & full-text download failed');
            }
          } else {
            throw new Error(pdfResult.error || 'PDF download failed');
          }
        }
      } catch (error) {
        pdfError = true;
        pdfErrorMessage = error instanceof Error ? error.message : 'PDF fetch error';
        console.warn(`PDF/full-text fetch error for ${document.id}:`, pdfErrorMessage);
        // Continue without PDF/full-text – AI will rely on metadata text
      }
    }
    
    // Add user message
    messages.push({
      role: 'user' as const,
      content: userContent,
    });

    try {
      const { object, usage } = await generateObject({
        model,
        schema,
        messages,
        maxRetries: 2, // Retry on failures
        ...(provider === 'google' && {
          providerOptions: {
            google: {
              structuredOutputs: false,
            },
          },
        }),
      });

      // ---- cost tracking ------------------------------------------------
      const cost = addCostFromUsage(provider, usage);

      return {
        ...object,
        documentId: document.id,
        pdfIncluded,
        pdfError,
        pdfErrorMessage,
        cost,
      };
    } catch (aiError) {
      // If AI call fails and we were trying to use PDF, try again without PDF
      if (pdfIncluded && !pdfError) {
        console.warn(`AI call failed with PDF for document ${document.id}, retrying with metadata only:`, aiError);
        
        // Retry without PDF
        const fallbackUserContent = [{
          type: 'text' as const,
          text: generateUserPrompt(document, questions, false),
        }];
        
        const fallbackMessages = [
          {
            role: 'system' as const,
            content: systemPrompt,
          },
          {
            role: 'user' as const,
            content: fallbackUserContent,
          }
        ];

        try {
          const { object, usage } = await generateObject({
            model,
            schema,
            messages: fallbackMessages,
            maxRetries: 2,
            ...(provider === 'google' && {
              providerOptions: {
                google: {
                  structuredOutputs: false,
                },
              },
            }),
          });

          // cost tracking for fallback
          const cost = addCostFromUsage(provider, usage);

          return {
            ...object,
            documentId: document.id,
            pdfIncluded: false,
            pdfError: true,
            pdfErrorMessage: 'AI call failed with PDF attachment, fallback to metadata',
            cost,
          };
        } catch (fallbackError) {
          // If even the fallback fails, throw the original error
          throw aiError;
        }
      } else {
        // If we weren't using PDF or already had PDF error, just throw
        throw aiError;
      }
    }
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
      pdfIncluded: false,
      pdfError: pdfError || (usePdfs && document.open_access?.oa_url),
      pdfErrorMessage,
    };
  }
}

// Process documents in batches with parallel requests
async function processBatch(
  documents: ScreeningDocument[],
  questions: ScreeningQuestion[],
  provider: AIProvider,
  apiKey: string,
  onProgress?: (completed: number, total: number) => void,
  usePdfs: boolean = false,
  zoteroAuth?: { apiKey: string; groupId: string }
) {
  const results: any[] = [];
  
  // Process documents in smaller parallel chunks
  for (let i = 0; i < documents.length; i += MAX_PARALLEL_REQUESTS) {
    const chunk = documents.slice(i, i + MAX_PARALLEL_REQUESTS);

    // Process chunk in parallel, capturing individual failures
    const settled = await Promise.allSettled(
      chunk.map((doc) => screenDocument(doc, questions, provider, apiKey, usePdfs, zoteroAuth))
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
          pdfIncluded: false,
          pdfError: usePdfs && doc.open_access?.oa_url, // Mark PDF error if we were trying to use it
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
  onProgress?: (completed: number, total: number, currentBatch: number, totalBatches: number) => void,
  usePdfs: boolean = false,
  zoteroAuth?: { apiKey: string; groupId: string }
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
        },
        usePdfs,
        zoteroAuth
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
    const isScreeningError = response.status === 'error' || (response.flags && response.flags.includes('screening_error'));
    const document = documents.find(d => d.id === response.documentId);
    
    // Determine PDF status based on actual PDF processing results
    let pdfStatus: 'used' | 'metadata' | 'error' = 'metadata';
    if (usePdfs) {
      if (response.pdfError || (document?.open_access?.oa_url && !response.pdfIncluded && !isScreeningError)) {
        // PDF was requested but failed to load/process, or screening failed while trying to use PDF
        pdfStatus = 'error';
      } else if (response.pdfIncluded && !response.pdfError) {
        // PDF was successfully included in the screening
        pdfStatus = 'used';
      } else {
        // PDF not available or not requested for this document
        pdfStatus = 'metadata';
      }
    }
    
    return {
      documentId: response.documentId,
      answers: response.responses,
      status: isScreeningError ? 'error' : 'completed',
      completedAt: new Date().toISOString(),
      pdfStatus,
      pdfErrorMessage: response.pdfErrorMessage,
      aiMetadata: {
        reasoning: response.reasoning,
        confidence: response.confidence,
        flags: response.flags,
        provider,
        model: provider === 'openai' ? OPENAI_MODEL : GOOGLE_MODEL,
        processedAt: new Date().toISOString(),
      },
      cost: response.cost, // Include cost in the result
    } as ScreeningResult;
  });

  return screeningResults;
}

 