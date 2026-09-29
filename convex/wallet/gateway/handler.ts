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
import { callOptions as providerCallOptions, clamp } from "../../../lib/ai/core/call-options";
import { pickProviderCostUsd } from "../../../lib/chat/pick-provider-cost";
import {
  calculateEnhancedModelCost,
  extractEnhancedUsage,
  type EnhancedUsage,
} from "./cost";
import type { AIProvider } from "../../../lib/types/ai.types";
import {
  convertUsdToCredits,
  WEB_SEARCH_ENGINE,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_USD,
} from "../../../lib/pricing";
import { autumn } from "../../billing/autumn";
import { reserveCredits, releaseCredits, settleCredits } from "../../billing/charge";
import type { Id, Doc } from "../../_generated/dataModel";
import { ESTIMATED_CREDITS_PER_WALLET_API_CALL } from "../../lib/constants";

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

  // 4. Parse request (moved before balance check — pre-flight needs
  //    `req.web_search_options` to estimate the additive grounding cost).
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

  // 7. Build provider model — all served models route through OpenRouter.
  const webSearch = Boolean(req.web_search_options);
  let model;
  try {
    model = await getProviderModel(
      "openrouter",
      undefined,
      walletModel.modelId,
      // Needed for OpenRouter to report the call's cost, which is what we charge.
      { openrouterUsageInclude: true },
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

  // 8. Hold the estimate, plus the search a web-search call runs.
  const requiredCredits =
    ESTIMATED_CREDITS_PER_WALLET_API_CALL +
    (webSearch ? convertUsdToCredits({ usd: WEB_SEARCH_USD, markup: walletModel.costMarkup }) : 0);
  const chargeId = `wallet:${crypto.randomUUID()}`;
  if (
    !(await reserveCredits(ctx, {
      userId: keyResult.userId,
      chargeId,
      credits: requiredCredits,
    }))
  ) {
    const account = await ctx.runQuery(internal.billing.accounts.forUser, {
      userId: keyResult.userId,
    });
    return openAIError(
      `Insufficient credits — need at least ${requiredCredits}, have ${account?.balance ?? 0}.`,
      "insufficient_quota",
      402,
      allowedOrigin,
    );
  }

  // 9. Convert request to AI SDK params
  const aiSdkParams = convertToAISdkParams(req);

  // 10. Provider options: the requested effort (models that reason, and never
  //     "none" where reasoning can't be turned off), then the caller's own.
  //     A level the model doesn't take rounds down to one it does.
  const levels = walletModel.reasoningEfforts ?? [];
  const effort = req.reasoning_effort && levels.length ? clamp(req.reasoning_effort, levels) : undefined;
  const ours = providerCallOptions(model, { effort });
  const theirs = req.provider_options?.openrouter;
  const plugins = webSearch ? withWebPlugin(theirs?.plugins) : undefined;
  const providerOptions: Record<string, Record<string, unknown>> = {
    ...ours,
    ...req.provider_options,
    // The caller's OpenRouter settings add to ours; a field they set themselves wins.
    openrouter: { ...ours.openrouter, ...theirs, ...(plugins ? { plugins } : {}) },
  };

  // 11. Execute
  const responseId = generateResponseId();
  const shouldStream = req.stream !== false; // default true
  const callOptions = buildCallOptions(model, aiSdkParams, providerOptions);
  const charge = makeChargeFn(ctx, walletModel, keyResult, chargeId, webSearch);

  try {
    if (shouldStream) {
      return handleStreaming({
        callOptions,
        responseId,
        walletModel,
        includeUsage: req.stream_options?.include_usage ?? false,
        allowedOrigin,
        charge,
      });
    }
    return await handleNonStreaming({
      callOptions,
      responseId,
      walletModel,
      allowedOrigin,
      charge,
    });
  } catch (e) {
    console.error("[gateway] Generation failed:", e);
    await charge.release();
    const errMsg = e instanceof Error ? e.message : "";
    return openAIError(
      `AI generation failed.${errMsg ? ` (${errMsg.slice(0, 200)})` : ""}`,
      "server_error",
      502,
      allowedOrigin,
    );
  }
});

/**
 * The caller's OpenRouter plugins plus the web plugin, which runs one search on
 * Exa before the model answers. A web plugin the caller configured wins.
 */
export function withWebPlugin(callerPlugins: unknown): unknown[] {
  const plugins = Array.isArray(callerPlugins) ? callerPlugins : [];
  const hasWeb = plugins.some((plugin) => (plugin as { id?: unknown } | null)?.id === "web");
  return hasWeb
    ? plugins
    : [...plugins, { id: "web", engine: WEB_SEARCH_ENGINE, max_results: WEB_SEARCH_MAX_RESULTS }];
}

// ─── Credit charge helper ───────────────────────────────────

/** OpenRouter's cost summed over every step, or null when any step didn't report one. */
function reportedCostUsd(stepMetadata: unknown[]): number | null {
  const costs = stepMetadata.map(pickProviderCostUsd);
  return costs.length > 0 && costs.every((cost) => cost !== null) ? costs.reduce<number>((sum, cost) => sum + cost!, 0) : null;
}

type ChargeFn = {
  /** `reportedUsd` is OpenRouter's cost for the call; tokens × price only when it's missing. */
  settle: (usage: EnhancedUsage, reportedUsd: number | null) => Promise<void>;
  release: () => Promise<void>;
};

function makeChargeFn(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  walletModel: Doc<"models">,
  keyResult: { userId: Id<"users">; appName: string },
  chargeId: string,
  webSearch: boolean,
): ChargeFn {
  return {
    settle: async (usage, reportedUsd) => {
      // OpenRouter's reported cost includes the search; the fallback adds it.
      const costUsd =
        reportedUsd ?? calculateEnhancedModelCost(usage, walletModel) + (webSearch ? WEB_SEARCH_USD : 0);
      await settleCredits(ctx, {
        userId: keyResult.userId,
        chargeId,
        credits: Math.max(1, convertUsdToCredits({ usd: costUsd, markup: walletModel.costMarkup })),
        usage: {
          kind: "wallet_api",
          description: `${keyResult.appName}: ${walletModel.name}`,
          model: walletModel.modelId,
          costUsd,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          reasoningTokens: usage.reasoningTokens,
        },
      });
    },
    release: () => releaseCredits(ctx, { userId: keyResult.userId, chargeId }),
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
  charge: ChargeFn;
}): Response {
  const { callOptions, responseId, walletModel, includeUsage, allowedOrigin, charge } =
    params;

  const streamResult = streamText(callOptions);

  const sseStream = createStreamingResponse({
    id: responseId,
    model: walletModel.modelId,
    fullStream:
      streamResult.fullStream as unknown as AsyncIterable<
        Record<string, unknown>
      >,
    includeUsage,
    // Charge before the response closes; release the hold if it fails.
    onDone: async () => {
      try {
        await charge.settle(extractEnhancedUsage(await streamResult.totalUsage), reportedCostUsd((await streamResult.steps).map((step) => step.providerMetadata)));
      } catch (e) {
        console.error("[gateway] Credit charge failed:", e);
        await charge.release().catch(() => undefined);
      }
    },
  });

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
  charge: ChargeFn;
}): Promise<Response> {
  const { callOptions, responseId, walletModel, allowedOrigin, charge } = params;

  const result = await generateText(
    callOptions as Parameters<typeof generateText>[0],
  );

  // Web search sources become url_citation annotations.
  const sources = ((result as { sources?: Array<{ url: string; title?: string }> }).sources ?? [])
    .filter((s: { url?: string }) => s.url)
    .map((s: { url: string; title?: string }) => ({
      url: s.url,
      title: s.title,
    }));

  // Deduct credits
  const enhanced = extractEnhancedUsage(result.totalUsage);
  await charge.settle(enhanced, reportedCostUsd(result.steps.map((step) => step.providerMetadata)));

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
    // Every model can search: OpenRouter's web plugin runs the search, not the model.
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

      // Architecture
      modality: m.modality,
      input_modalities: m.inputModalities,
      output_modalities: m.outputModalities,
      tokenizer: m.tokenizer,

      // Lifecycle
      knowledge_cutoff: m.knowledgeCutoff,
      is_moderated: m.isModerated,

      // Pricing
      pricing: {
        input_per_million_tokens: m.inputPricePerMillion * m.costMarkup,
        output_per_million_tokens: m.outputPricePerMillion * m.costMarkup,
        reasoning_per_million_tokens: m.reasoningPricePerMillion
          ? m.reasoningPricePerMillion * m.costMarkup
          : undefined,
        cache_read_per_million_tokens: m.cacheReadPricePerMillion
          ? m.cacheReadPricePerMillion * m.costMarkup
          : undefined,
        cache_write_per_million_tokens: m.cacheWritePricePerMillion
          ? m.cacheWritePricePerMillion * m.costMarkup
          : undefined,
        web_search_per_request: WEB_SEARCH_USD * m.costMarkup,
        currency: "USD",
      },

      // Defaults
      default_temperature: m.defaultTemperature,
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

  // Top-up credits are "paid"; plan and signup credits are "free".
  const balances = (await autumn.customer(keyResult.userId)).balances.credits?.breakdown ?? [];
  const paid = balances
    .filter((balance) => balance.plan_id === "top_up")
    .reduce((sum, balance) => sum + balance.remaining, 0);
  const total = balances.reduce((sum, balance) => sum + balance.remaining, 0);
  return corsJson({ free: total - paid, paid, total }, 200, allowedOrigin);
});

// ─── OPTIONS preflight ──────────────────────────────────────

export const handleCors = httpAction(async (_ctx, request) => {
  const origin = request.headers.get("origin") || "*";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
});
