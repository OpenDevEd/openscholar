import {
  credentialKeyFor,
  writeOnlyPatternFor,
} from "./credential-paths";
import catalogs from "./generated/library-config.catalogs.json";
import type { ValidationIssue } from "./generated-validation";

/**
 * OpenScholar configures one AI provider: OpenRouter. The runtime accepts
 * more, but nothing else is offered, so nothing else is written.
 */
export const AI_PROVIDER = "openrouter";

/** Provider models the runtime decides. OpenScholar never writes them. */
export const PLATFORM_AI_MODEL_FIELDS = ["largeModel", "smallModel"] as const;

/**
 * Feature switches the platform decides, not the owner. AI search follows the
 * AI answers switch and deep research stays off until it is a decision of its
 * own, so a saved row must never carry either.
 */
export const PLATFORM_FEATURE_KEYS = ["aiSearch", "deepResearch"] as const;

/** Where the provider key sits in an assembled runtime configuration. */
export const AI_PROVIDER_KEY_PATH = "/ai/providers/0/apiKey";

/**
 * The models the runtime approves for OpenRouter, from the pinned catalog.
 * Empty until the contract is re-pinned to a `main` commit that carries the
 * `ai-modernization` merge; AI answers stay off until then.
 */
export const AI_MODELS: readonly string[] =
  (
    catalogs.options.aiProviders as readonly {
      provider: string;
      active: readonly string[];
    }[]
  ).find((entry) => entry.provider === AI_PROVIDER)?.active ?? [];

export const AI_PROVIDER_KEY_PATTERN = writeOnlyPatternFor(AI_PROVIDER_KEY_PATH);
if (!AI_PROVIDER_KEY_PATTERN) {
  throw new Error("The pinned contract has no AI provider key");
}

/** The credential row that holds this library's OpenRouter key. */
export const AI_PROVIDER_CREDENTIAL_KEY = credentialKeyFor(
  AI_PROVIDER_KEY_PATTERN,
  AI_PROVIDER,
);

export type AiProviderEntry = Record<string, unknown>;

/** Gives each enabled provider entry its stored key, at assembly time only. */
export type ApplyAiProviderKey = (
  providers: readonly AiProviderEntry[],
) => AiProviderEntry[];

export const passThroughAiProviderKey: ApplyAiProviderKey = (providers) =>
  providers.map((provider) => ({ ...provider }));

/**
 * The one shape OpenScholar saves: a single OpenRouter entry, switched on
 * exactly when AI answers are, carrying a model the runtime approves.
 *
 * The page cannot be trusted to be the only caller, so this runs on the
 * server twice: when a section is saved, and again when the configuration is
 * assembled for a library. Messages are the ones an owner reads.
 */
export function aiProviderIssues(
  providers: unknown,
  featuresAi: boolean | undefined,
  /**
   * Whether the library has an `ai` row at all. Only a library that never
   * saved one may have no provider; a row that is there holds exactly one.
   */
  rowSaved = true,
): ValidationIssue[] {
  const issue = (pointer: string, message: string): ValidationIssue => ({
    pointer,
    section: "ai",
    keyword: "aiProvider",
    message,
  });

  // No row at all is how a library that never used AI answers looks. With AI
  // answers on it is a problem; without them it is simply nothing.
  if (!rowSaved) {
    if (Array.isArray(providers) && providers.length > 0) {
      return [
        issue(
          "/ai/providers",
          "This library saves exactly one AI provider, OpenRouter.",
        ),
      ];
    }
    return featuresAi === true
      ? [issue("/ai/providers", "AI answers need one AI provider.")]
      : [];
  }
  if (!Array.isArray(providers) || providers.length !== 1) {
    return [
      issue(
        "/ai/providers",
        "This library saves exactly one AI provider, OpenRouter.",
      ),
    ];
  }
  const entry = providers[0] as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  if (entry?.provider !== AI_PROVIDER) {
    issues.push(
      issue(
        "/ai/providers/0/provider",
        "OpenRouter is the only AI provider this library can use.",
      ),
    );
  }
  if (featuresAi !== undefined && entry?.enabled !== featuresAi) {
    issues.push(
      issue(
        "/ai/providers/0/enabled",
        "The AI provider is on exactly when AI answers are on.",
      ),
    );
  }
  // The runtime picks the large and small models. Offering them would be a
  // setting OpenScholar does not show and cannot check.
  for (const field of PLATFORM_AI_MODEL_FIELDS) {
    if (entry?.[field] !== undefined) {
      issues.push(
        issue(
          `/ai/providers/0/${field}`,
          "Your library software chooses this model.",
        ),
      );
    }
  }
  const model = entry?.defaultModel;
  if (entry?.enabled === true && (typeof model !== "string" || model === "")) {
    issues.push(
      issue(
        "/ai/providers/0/defaultModel",
        "Choose the model that answers questions.",
      ),
    );
  } else if (typeof model === "string" && !AI_MODELS.includes(model)) {
    issues.push(
      issue(
        "/ai/providers/0/defaultModel",
        `${model} is not a model your library software offers.`,
      ),
    );
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* The platform search embedder                                        */
/* ------------------------------------------------------------------ */

/**
 * Meaning-based search needs an embedder, and the embedder is a platform
 * value: OpenScholar writes it, owners never see it. The block below is the
 * one the development libraries already run — Outline "08 — Development and
 * Verification Runbooks", checked 2026-08-20 on new-el `openscholar` — and
 * the runtime copies its fields straight through to Meilisearch
 * (`src/lib/search-index/embedder-settings.ts`).
 */
export const PLATFORM_EMBEDDING_URL = "https://openrouter.ai/api/v1/embeddings";
export const PLATFORM_EMBEDDING_MODEL = "perplexity/pplx-embed-v1-0.6b";
export const PLATFORM_EMBEDDING_DIMENSIONS = 1024;

/**
 * The embedder block for one library. `{{text}}` is the record Meilisearch
 * wants embedded and `{{embedding}}` is where it reads the numbers back;
 * `{{..}}` marks the part that repeats, so one call embeds a whole batch.
 * There are no headers: Meilisearch sends the key as `Authorization: Bearer`.
 */
export function platformSearchEmbedder(
  apiKey: string,
): Record<string, unknown> {
  return {
    source: "rest",
    url: PLATFORM_EMBEDDING_URL,
    apiKey,
    dimensions: PLATFORM_EMBEDDING_DIMENSIONS,
    request: { model: PLATFORM_EMBEDDING_MODEL, input: ["{{text}}", "{{..}}"] },
    response: { data: [{ embedding: "{{embedding}}" }, "{{..}}"] },
  };
}

/**
 * The platform's embedding key. A separate key keeps embedding spend apart
 * from answer spend; without it the shared OpenRouter key is used. Read on
 * the server only, at assembly time.
 */
export function platformEmbeddingKey(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return (
    env.EL_EMBEDDING_OPENROUTER_KEY?.trim() ||
    env.OPENROUTER_API_KEY?.trim() ||
    undefined
  );
}

export const PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE =
  "The platform has no embedding key yet.";

/** Whether a saved `features` row has AI answers switched on. */
export function featuresAiEnabled(payload: unknown): boolean {
  return (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).ai === true
  );
}
