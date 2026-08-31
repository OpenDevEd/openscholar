import catalogs from "./generated/library-config.client.catalogs.json";

/** Stable historical ids for configuration fixtures. Not used by the app. */
export const TEST_AI_MODELS =
  (
    catalogs.options.aiProviders as readonly {
      provider: string;
      active: readonly string[];
    }[]
  ).find((entry) => entry.provider === "openrouter")?.active ?? [];
