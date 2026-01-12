"use server";

import type { AIModel } from '@/lib/types/ai.types';

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
  architecture: {
    tokenizer: string;
  };
}

export async function fetchOpenRouterModels(): Promise<AIModel[]> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {},
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch OpenRouter models: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.data) {
      return [];
    }

    return data.data.map((model: OpenRouterModel): AIModel => ({
      id: model.id,
      name: model.name,
      provider: 'openrouter',
      description: model.description,
      contextWindow: model.context_length,
      pricing: {
        input: parseFloat(model.pricing.prompt) * 1_000_000,
        output: parseFloat(model.pricing.completion) * 1_000_000,
      },
      category: model.architecture.tokenizer,
    }));
  } catch (error) {
    console.error('Error fetching OpenRouter models:', error);
    return [];
  }
}
