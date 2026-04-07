import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { streamText } from "ai";
import { getProviderModel } from "../../lib/ai/server/providers";
import { DEFAULT_CREDITS_PER_USD } from "../lib/creditTopups";
import type { AIProvider } from "../../lib/types/ai.types";
import type { Id, Doc } from "../_generated/dataModel";

// ─── CORS helpers ────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function corsError(error: string, status: number): Response {
  return corsJson({ error }, status);
}

// ─── Credit calculation ──────────────────────────────────────

function creditsFromCost(
  dollars: number,
  markup: number,
): number {
  const creditsPerUsd =
    Number(process.env.CREDITS_PER_USD) || DEFAULT_CREDITS_PER_USD;
  const raw = dollars * markup * creditsPerUsd;
  return raw > 0 ? Math.ceil(raw) : 0;
}

function calculateModelCost(
  inputTokens: number,
  outputTokens: number,
  model: Doc<"walletModels">,
): number {
  const inputCost = (inputTokens / 1_000_000) * model.inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * model.outputPricePerMillion;
  return inputCost + outputCost;
}

// ─── Helpers ─────────────────────────────────────────────────

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

// ─── GET /api/wallet/models ──────────────────────────────────

export const handleModels = httpAction(async (ctx) => {
  const models = await ctx.runQuery(internal.wallet.models.listActive);

  const response = models.map((m) => ({
    id: m.modelId,
    name: m.name,
    provider: m.provider,
    description: m.description,
    contextWindow: m.contextWindow,
    capabilities: m.capabilities,
    category: m.category,
    pricing: {
      inputPerMillionTokens: m.inputPricePerMillion * m.costMarkup,
      outputPerMillionTokens: m.outputPricePerMillion * m.costMarkup,
      currency: "credits",
    },
  }));

  return corsJson({ models: response });
});

// ─── POST /api/wallet/generate ───────────────────────────────

export const handleGenerate = httpAction(async (ctx, request) => {
  // 1. Extract API key
  const rawKey = extractBearerToken(request);
  if (!rawKey) {
    return corsError("Missing Authorization: Bearer <api_key> header", 401);
  }

  // 2. Validate key (internal action — hashes the key and looks it up)
  const keyResult: {
    userId: Id<"users">;
    walletKeyId: Id<"walletKeys">;
    appName: string;
    redirectOrigin: string;
  } | null = await ctx.runAction(internal.wallet.nodeActions.validateKey, {
    rawKey,
  });
  if (!keyResult) {
    return corsError("Invalid or revoked API key", 401);
  }

  // 2b. Enforce origin — key can only be used from its registered origin
  if (keyResult.redirectOrigin !== "manual") {
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin && requestOrigin !== keyResult.redirectOrigin) {
      return corsError("Origin mismatch: this key is not authorized for this origin", 403);
    }
  }

  // 3. Rate limit (internal mutation)
  try {
    await ctx.runMutation(internal.lib.rateLimit.consume, {
      name: "wallet-generate" as const,
      key: keyResult.userId,
    });
  } catch {
    return corsError("Rate limited. Try again shortly.", 429);
  }

  // 4. Check balance (internal query)
  const balance: {
    free: number;
    paid: number;
    total: number;
    lifetimeUsed: number;
  } | null = await ctx.runQuery(
    internal.credits.internal.getBalanceByUserId,
    { userId: keyResult.userId },
  );
  if (!balance || balance.total <= 0) {
    return corsError("Insufficient credits", 402);
  }

  // 5. Parse request body
  let body: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    max_tokens?: number;
  };
  try {
    body = await request.json();
  } catch {
    return corsError("Invalid JSON body", 400);
  }

  if (
    !body.model ||
    !Array.isArray(body.messages) ||
    body.messages.length === 0
  ) {
    return corsError(
      'Required fields: "model" (string), "messages" (non-empty array)',
      400,
    );
  }

  // 6. Validate model against DB catalog
  const walletModel = await ctx.runQuery(internal.wallet.models.getByModelId, {
    modelId: body.model,
  });
  if (!walletModel) {
    return corsError(
      `Model "${body.model}" is not available. GET /api/wallet/models for the list.`,
      400,
    );
  }

  // 7. Create AI model and stream
  try {
    const model = await getProviderModel(
      walletModel.provider as AIProvider,
      undefined,
      walletModel.modelId,
    );

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Fire-and-forget the streaming + credit deduction
    void (async () => {
      try {
        const result = streamText({
          model,
          messages: body.messages.map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          })),
          temperature: body.temperature ?? 0.7,
          ...(body.max_tokens ? { maxOutputTokens: body.max_tokens } : {}),
        });

        for await (const chunk of result.textStream) {
          await writer.write(encoder.encode(chunk));
        }

        // Stream complete — deduct credits using model's own pricing
        const usage = await result.usage;
        const costDollars = calculateModelCost(
          usage.inputTokens ?? 0,
          usage.outputTokens ?? 0,
          walletModel,
        );
        const credits = Math.max(1, creditsFromCost(costDollars, walletModel.costMarkup));

        await ctx.runMutation(internal.credits.internal.deductCredits, {
          userId: keyResult.userId,
          amount: credits,
          description: `Wallet API: ${walletModel.name}`,
          metadata: {
            source: "wallet_api",
            appName: keyResult.appName,
            model: walletModel.modelId,
            provider: walletModel.provider,
            inputTokens: String(usage.inputTokens ?? 0),
            outputTokens: String(usage.outputTokens ?? 0),
          },
        });
      } catch (e) {
        const errMsg =
          e instanceof Error ? e.message : "AI generation failed";
        await writer.write(encoder.encode(`\n\n[ERROR] ${errMsg}`));
        console.error("[wallet/generate] Stream error:", e);
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        ...CORS_HEADERS,
      },
    });
  } catch (e) {
    console.error("[wallet/generate] Setup error:", e);
    return corsError("AI generation failed. Please try again.", 502);
  }
});

// ─── OPTIONS preflight ───────────────────────────────────────

export const handleCors = httpAction(async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
});
