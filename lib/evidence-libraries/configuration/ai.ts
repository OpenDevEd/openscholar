import {
  credentialKeyFor,
  writeOnlyPatternFor,
} from "./credential-paths";
import catalogs from "./generated/library-config.catalogs.json";

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
