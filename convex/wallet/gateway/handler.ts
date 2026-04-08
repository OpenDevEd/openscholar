import { httpAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { streamText, generateText } from "ai";
import { getProviderModel } from "../../../lib/ai/server/providers";
import { parseAndValidateRequest, convertToAISdkParams } from "./parseRequest";
import {
  generateResponseId,
  formatNonStreamingResponse,
  createStreamingResponse,
} from "./formatResponse";
import { buildReasoningProviderOptions } from "./reasoning";
import {
  calculateEnhancedModelCost,
  creditsFromCost,
  extractEnhancedUsage,
  type EnhancedUsage,
} from "./cost";
import type { AIProvider } from "../../../lib/types/ai.types";
import type { Id, Doc } from "../../_generated/dataModel";

// ─── CORS helpers ───────────────────────────────────────────

function corsHeaders(origin: string = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function corsJson(body: unknown, status = 200, origin = "*"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function openAIError(
  message: string,
  type: string,
  status: number,
  origin = "*",
): Response {
  return corsJson(
    { error: { message, type, param: null, code: null } },
    status,
    origin,
  );
}

// ─── Auth helpers ───────────────────────────────────────────

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

// ─── POST /api/wallet/v1/chat/completions ───────────────────

export const handleChatCompletions = httpAction(async (ctx, request) => {
  // 1. Auth
  const rawKey = extractBearerToken(request);
  if (!rawKey) {
    return openAIError(
      "Missing Authorization: Bearer <api_key> header",
      "invalid_request_error",
      401,
    );
  }

  const keyResult: {
    userId: Id<"users">;
    walletKeyId: Id<"walletKeys">;
    appName: string;
    redirectOrigin: string;
  } | null = await ctx.runAction(internal.wallet.nodeActions.validateKey, {
    rawKey,
  });
  if (!keyResult) {
    return openAIError("Invalid or revoked API key", "invalid_request_error", 401);
  }

  // 2. Origin enforcement
  const requestOrigin = request.headers.get("origin");
  let allowedOrigin = "*";

  if (keyResult.redirectOrigin !== "manual") {
    if (!requestOrigin) {
      return openAIError(
        "Origin header required for this key",
        "invalid_request_error",
        403,
      );
    }
    if (requestOrigin !== keyResult.redirectOrigin) {
      return openAIError(
        "Origin mismatch: this key is not authorized for this origin",
        "invalid_request_error",
        403,
        requestOrigin,
      );
    }
    allowedOrigin = requestOrigin;
  } else if (requestOrigin) {
    allowedOrigin = requestOrigin;
  }

  // 3. Rate limit
  try {
    await ctx.runMutation(internal.lib.rateLimit.consume, {
      name: "wallet-generate" as const,
      key: keyResult.userId,
    });
  } catch {
    return openAIError(
      "Rate limited. Try again shortly.",
      "rate_limit_error",
      429,
      allowedOrigin,
    );
  }

  // 4. Balance check
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
    return openAIError(
      "Insufficient credits",
      "insufficient_quota",
      402,
      allowedOrigin,
    );
  }

  // 5. Parse request
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return openAIError("Invalid JSON body", "invalid_request_error", 400, allowedOrigin);
  }

  const parsed = parseAndValidateRequest(body);
  if (!parsed.ok) {
    return openAIError(parsed.error, "invalid_request_error", 400, allowedOrigin);
  }
  const req = parsed.request;

  // 6. Resolve model
  const walletModel: Doc<"models"> | null = await ctx.runQuery(
    internal.models.queries.getServedByModelId,
    { modelId: req.model },
  );
  if (!walletModel) {
    return openAIError(
      `Model "${req.model}" is not available. GET /api/wallet/v1/models for the list.`,
      "invalid_request_error",
      400,
      allowedOrigin,
    );
  }

  // 7. Build provider model — all served models route through OpenRouter
  //    Append :online suffix when web search is requested (OpenRouter-native web search)
  //    Suffix stacking is valid: :free:online keeps the free tier, web search has its own cost
  let routedModelId = walletModel.modelId;
  if (req.web_search_options) {
    routedModelId = `${routedModelId}:online`;
  }

  let model;
  try {
    model = await getProviderModel(
      "openrouter",
      undefined,
      routedModelId,
    );
  } catch (e) {
    console.error("[gateway] Provider model creation failed:", e);
    return openAIError(
      "Failed to initialize model provider",
      "server_error",
      502,
      allowedOrigin,
    );
  }

  // 8. Convert request to AI SDK params
  const aiSdkParams = convertToAISdkParams(req);

  // 9. Build provider options (reasoning + pass-through)
  let providerOptions: Record<string, Record<string, unknown>> | undefined;
  if (req.reasoning_effort) {
    providerOptions = buildReasoningProviderOptions(
      walletModel.provider,
      req.reasoning_effort,
      walletModel,
    );
  }
  if (req.provider_options) {
    providerOptions = { ...providerOptions, ...req.provider_options };
  }

  // 10. Execute
  const responseId = generateResponseId();
  const shouldStream = req.stream !== false; // default true
  const callOptions = buildCallOptions(model, aiSdkParams, providerOptions);
  const deduct = makeDeductFn(ctx, walletModel, keyResult);

  try {
    if (shouldStream) {
      return handleStreaming({
        callOptions,
        responseId,
        walletModel,
        includeUsage: req.stream_options?.include_usage ?? false,
        allowedOrigin,
        deduct,
      });
    }
    return await handleNonStreaming({
      callOptions,
      responseId,
      walletModel,
      allowedOrigin,
      deduct,
    });
  } catch (e) {
    console.error("[gateway] Generation failed:", e);
    const errMsg = e instanceof Error ? e.message : "";
    const hint = req.web_search_options
      ? " This model may not support web search — try without web_search_options or use a different model."
      : "";
    return openAIError(
      `AI generation failed.${hint}${errMsg ? ` (${errMsg.slice(0, 200)})` : ""}`,
      "server_error",
      502,
      allowedOrigin,
    );
  }
});

// ─── Credit deduction helper ────────────────────────────────

type DeductFn = (
  usage: EnhancedUsage,
  finishReason: string,
) => Promise<void>;

function makeDeductFn(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  walletModel: Doc<"models">,
  keyResult: { userId: Id<"users">; appName: string },
): DeductFn {
  return async (usage, finishReason) => {
    const costDollars = calculateEnhancedModelCost(usage, walletModel);
    const credits = Math.max(
      1,
      creditsFromCost(costDollars, walletModel.costMarkup),
    );

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: keyResult.userId,
      amount: credits,
      description: `Wallet API: ${walletModel.name}`,
      metadata: {
        source: "wallet_api",
        appName: keyResult.appName,
        model: walletModel.modelId,
        provider: walletModel.provider,
        inputTokens: String(usage.inputTokens),
        outputTokens: String(usage.outputTokens),
        reasoningTokens: String(usage.reasoningTokens),
        cacheReadTokens: String(usage.cacheReadTokens),
        webSearchRequests: String(usage.webSearchRequests),
        finishReason,
      },
    });
  };
}

// ─── Build AI SDK call options ──────────────────────────────

type AISdkCallOptions = Parameters<typeof streamText>[0];

function buildCallOptions(
  model: Awaited<ReturnType<typeof getProviderModel>>,
  aiSdkParams: ReturnType<typeof convertToAISdkParams>,
  providerOptions?: Record<string, Record<string, unknown>>,
): AISdkCallOptions {
  const { messages, tools, toolChoice, output, ...scalarParams } = aiSdkParams;

  return {
    model,
    messages: messages as AISdkCallOptions["messages"],
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { toolChoice } : {}),
    ...(output ? { output } : {}),
    ...scalarParams,
    ...(providerOptions ? { providerOptions } : {}),
  } as AISdkCallOptions;
}

// ─── Streaming path ─────────────────────────────────────────

function handleStreaming(params: {
  callOptions: AISdkCallOptions;
  responseId: string;
  walletModel: Doc<"models">;
  includeUsage: boolean;
  allowedOrigin: string;
  deduct: DeductFn;
}): Response {
  const { callOptions, responseId, walletModel, includeUsage, allowedOrigin, deduct } =
    params;

  let capturedFinishReason = "stop";
  let capturedSourceCount = 0;

  const streamResult = streamText(callOptions);

  const sseStream = createStreamingResponse({
    id: responseId,
    model: walletModel.modelId,
    fullStream:
      streamResult.fullStream as unknown as AsyncIterable<
        Record<string, unknown>
      >,
    includeUsage,
    onUsage: () => {
      /* usage captured via totalUsage promise below */
    },
    onFinishReason: (reason) => {
      capturedFinishReason = reason;
    },
    onSourceCount: (count) => {
      capturedSourceCount = count;
    },
  });

  // Fire-and-forget credit deduction after stream completes
  void (async () => {
    try {
      const totalUsage = await streamResult.totalUsage;
      const enhanced = extractEnhancedUsage(totalUsage);
      enhanced.webSearchRequests = capturedSourceCount;
      await deduct(enhanced, capturedFinishReason);
    } catch (e) {
      console.error("[gateway] Credit deduction failed:", e);
    }
  })();

  return new Response(sseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...corsHeaders(allowedOrigin),
    },
  });
}

// ─── Non-streaming path ─────────────────────────────────────

async function handleNonStreaming(params: {
  callOptions: AISdkCallOptions;
  responseId: string;
  walletModel: Doc<"models">;
  allowedOrigin: string;
  deduct: DeductFn;
}): Promise<Response> {
  const { callOptions, responseId, walletModel, allowedOrigin, deduct } = params;

  const result = await generateText(
    callOptions as Parameters<typeof generateText>[0],
  );

  // Extract sources for annotations + web search costing
  const sources = ((result as { sources?: Array<{ url: string; title?: string }> }).sources ?? [])
    .filter((s: { url?: string }) => s.url)
    .map((s: { url: string; title?: string }) => ({
      url: s.url,
      title: s.title,
    }));

  // Deduct credits
  const enhanced = extractEnhancedUsage(result.usage);
  enhanced.webSearchRequests = sources.length;
  await deduct(enhanced, result.finishReason);

  // Format tool calls — AI SDK v6 uses `input` not `args`
  const toolCalls = (result.toolCalls ?? []).map(
    (tc: { toolCallId: string; toolName: string; input: unknown }) => ({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      args: tc.input,
    }),
  );

  const response = formatNonStreamingResponse({
    id: responseId,
    model: walletModel.modelId,
    text: result.text,
    toolCalls,
    finishReason: result.finishReason,
    usage: enhanced,
    sources,
  });

  return corsJson(response, 200, allowedOrigin);
}

// ─── GET /api/wallet/v1/models ──────────────────────────────

export const handleModelsV1 = httpAction(async (ctx) => {
  const models = await ctx.runQuery(internal.models.queries.listServed);

  const data = models.map((m: Doc<"models">) => {
    // All models support web search via OpenRouter :online suffix (even :free models)
    const baseCaps =
      m.supportedParameters?.filter((p: string) =>
        [
          "tools",
          "reasoning",
          "structured_outputs",
          "temperature",
        ].includes(p),
      ) ?? [];
    const capabilities = [...baseCaps, "web_search"];

    return {
      id: m.modelId,
      object: "model" as const,
      created: Math.floor(m.createdAt / 1000),
      owned_by: m.provider,
      name: m.name,
      description: m.description,
      context_window: m.contextLength,
      max_completion_tokens: m.maxCompletionTokens,
      capabilities,
      category: m.category,
      pricing: {
        input_per_million_tokens: m.inputPricePerMillion * m.costMarkup,
        output_per_million_tokens: m.outputPricePerMillion * m.costMarkup,
        reasoning_per_million_tokens: m.reasoningPricePerMillion
          ? m.reasoningPricePerMillion * m.costMarkup
          : undefined,
        currency: "credits",
      },
    };
  });

  return corsJson({ object: "list", data });
});

// ─── GET /api/wallet/balance ────────────────────────────────

export const handleBalance = httpAction(async (ctx, request) => {
  const rawKey = extractBearerToken(request);
  if (!rawKey) {
    return openAIError(
      "Missing Authorization: Bearer <api_key> header",
      "invalid_request_error",
      401,
    );
  }

  const keyResult: {
    userId: Id<"users">;
    walletKeyId: Id<"walletKeys">;
    appName: string;
    redirectOrigin: string;
  } | null = await ctx.runAction(internal.wallet.nodeActions.validateKey, {
    rawKey,
  });
  if (!keyResult) {
    return openAIError("Invalid or revoked API key", "invalid_request_error", 401);
  }

  const requestOrigin = request.headers.get("origin");
  let allowedOrigin = "*";
  if (keyResult.redirectOrigin !== "manual") {
    if (!requestOrigin) {
      return openAIError(
        "Origin header required for this key",
        "invalid_request_error",
        403,
      );
    }
    if (requestOrigin !== keyResult.redirectOrigin) {
      return openAIError(
        "Origin mismatch: this key is not authorized for this origin",
        "invalid_request_error",
        403,
        requestOrigin,
      );
    }
    allowedOrigin = requestOrigin;
  } else if (requestOrigin) {
    allowedOrigin = requestOrigin;
  }

  const balance: {
    free: number;
    paid: number;
    total: number;
    lifetimeUsed: number;
  } | null = await ctx.runQuery(
    internal.credits.internal.getBalanceByUserId,
    { userId: keyResult.userId },
  );

  if (!balance) {
    return corsJson({ free: 0, paid: 0, total: 0 }, 200, allowedOrigin);
  }

  return corsJson(
    { free: balance.free, paid: balance.paid, total: balance.total },
    200,
    allowedOrigin,
  );
});

// ─── OPTIONS preflight ──────────────────────────────────────

export const handleCors = httpAction(async (_ctx, request) => {
  const origin = request.headers.get("origin") || "*";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
});
