/**
 * Custom Ollama embedding model wrapper for AI SDK v2 compatibility.
 * 
 * The @convex-dev/rag component uses AI SDK v5 which requires v2 model specs.
 * This wrapper calls Ollama's embed API directly using fetch (no Node.js deps)
 * and returns embeddings in the format expected by AI SDK v2.
 */

// Ollama API configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://host.docker.internal:11434";

/**
 * Create an AI SDK v2 compatible embedding model that uses Ollama.
 * Uses fetch directly to avoid Node.js-only dependencies.
 * 
 * @param modelId - The Ollama model to use (e.g., "nomic-embed-text")
 * @returns An embedding model compatible with AI SDK v2
 */
export function createOllamaEmbeddingModel(modelId: string = "nomic-embed-text") {
  return {
    // AI SDK v2 model specification
    specificationVersion: "v2" as const,
    provider: "ollama",
    modelId,

    // The doEmbed function is called by AI SDK to generate embeddings
    async doEmbed({ values }: { values: string[] }): Promise<{
      embeddings: number[][];
      usage?: { tokens: number };
    }> {
      const embeddings: number[][] = [];
      let totalTokens = 0;

      // Process each text value
      for (const text of values) {
        try {
          const response = await fetch(`${OLLAMA_HOST}/api/embed`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: modelId,
              input: text,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama API error (${response.status}): ${errorText}`);
          }

          const data = await response.json();

          // Handle embedding response
          if (data.embeddings && data.embeddings.length > 0) {
            embeddings.push(data.embeddings[0]);
          } else if (data.embedding) {
            // Some versions return 'embedding' instead of 'embeddings'
            embeddings.push(data.embedding);
          } else {
            throw new Error("No embeddings returned from Ollama");
          }

          // Estimate tokens (rough approximation)
          totalTokens += Math.ceil(text.length / 4);
        } catch (error: any) {
          // Check if it's a connection error
          if (error.cause?.code === "ECONNREFUSED" || error.message?.includes("fetch failed")) {
            throw new Error(
              `Cannot connect to Ollama at ${OLLAMA_HOST}. ` +
              `Make sure Ollama is running (ollama serve) and the model is pulled (ollama pull ${modelId})`
            );
          }
          console.error(`[Ollama Embed] Error embedding text:`, error.message);
          throw new Error(
            `Failed to generate embedding with Ollama: ${error.message}. ` +
            `Make sure Ollama is running (ollama serve) and the model is pulled (ollama pull ${modelId})`
          );
        }
      }

      return {
        embeddings,
        usage: { tokens: totalTokens },
      };
    },

    // Required by AI SDK v2
    get maxEmbeddingsPerCall() {
      return 100; // Ollama can handle batches
    },

    // Required by AI SDK v2
    get supportsParallelCalls() {
      return false; // Process sequentially to avoid overwhelming local Ollama
    },
  };
}

/**
 * Pre-configured nomic-embed-text model (768 dimensions)
 */
export const nomicEmbedText = createOllamaEmbeddingModel("nomic-embed-text");

/**
 * Get embedding dimension for a given Ollama model
 */
export function getOllamaEmbeddingDimension(modelId: string): number {
  const dimensions: Record<string, number> = {
    "nomic-embed-text": 768,
    "mxbai-embed-large": 1024,
    "all-minilm": 384,
    "snowflake-arctic-embed": 1024,
  };
  return dimensions[modelId] || 768;
}
