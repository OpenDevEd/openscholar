"use client";

import { Bot } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { getProviderIcon } from "@/components/icons/provider-icons";
import type { AIProvider } from "@/lib/types/ai.types";
import { cn } from "@/lib/utils";
import { XaiIcon } from "../social-icons";

export type CatalogModel = FunctionReturnType<typeof api.models.queries.listCatalogOptions>[number];

const ICON_PROVIDERS = new Set<AIProvider>(["openai", "google", "anthropic", "deepseek", "openrouter"]);

const NAMES: Record<string, string> = {
  openai: "OpenAI",
  google: "Google",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  "x-ai": "xAI",
  mistralai: "Mistral",
  "meta-llama": "Meta",
  qwen: "Qwen",
};

export const providerName = (provider: string) =>
  NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);

/** The app's provider icon when it has one; a neutral bot otherwise. */
export function ProviderMark({ provider, className }: { provider: string; className?: string }) {
  if (provider === "x-ai") return <XaiIcon className={className} />;
  if (ICON_PROVIDERS.has(provider as AIProvider)) {
    const Icon = getProviderIcon(provider as AIProvider);
    return <Icon className={className} />;
  }
  return <Bot className={cn("text-muted-foreground", className)} aria-hidden />;
}

export function formatPrice(input: number, output: number, free: string) {
  if (!input && !output) return free;
  return `$${input.toFixed(2)} / $${output.toFixed(2)}`;
}

export function formatContext(tokens: number | undefined) {
  if (!tokens) return "—";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}
