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

const AI_PROVIDER_KEY_PATTERN = writeOnlyPatternFor(AI_PROVIDER_KEY_PATH);
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
): ValidationIssue[] {
  const issue = (pointer: string, message: string): ValidationIssue => ({
    pointer,
    section: "ai",
    keyword: "aiProvider",
    message,
  });

  // No provider at all is how a library that never used AI answers looks.
  // With AI answers on it is a problem; without them it is simply nothing.
  if (providers === undefined || (Array.isArray(providers) && providers.length === 0)) {
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
