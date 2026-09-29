/**
 * Convert an OpenRouter model id (`vendor/model[:variant]`) into the native id a
 * provider's own API — and the matching `@ai-sdk/<provider>` package — expects,
 * so the BYOK path can reuse the OpenRouter catalog ids when the user calls a
 * provider directly with their own key.
 *
 * Rules verified against live `/models` responses and the installed
 * `@ai-sdk/*` model-id type unions:
 *  - openai    : strip prefix; OpenRouter aliases chat models as `*-chat`,
 *                whereas the SDK/native id is `*-chat-latest`.
 *  - anthropic : strip prefix; OpenRouter uses dotted versions
 *                (`claude-sonnet-4.6`), native/SDK uses dashes
 *                (`claude-sonnet-4-6`, an undated alias).
 *  - google    : strip prefix; native/SDK ids keep dots (`gemini-2.5-pro`)
 *                and take NO `models/` prefix (the SDK adds nothing).
 *  - deepseek  : strip prefix.
 *
 * Every `@ai-sdk` provider types its model id as `'literal' | … | (string & {})`,
 * so unknown/newer derived ids still pass through to the provider API. Callers
 * should validate the result against the provider's `/models` on first use and
 * fall back to routing the model through OpenRouter on a miss.
 */

export type NativeProvider = "openai" | "anthropic" | "google" | "deepseek";

/** OpenRouter-only variants (`:free`, `:extended`) that a provider's own API doesn't offer. */
export const isVariant = (openRouterId: string) => openRouterId.includes(":");

/** Drop the leading `vendor/` segment and any OpenRouter `:variant` suffix. */
function baseId(openRouterId: string): string {
  const afterSlash = openRouterId.includes("/")
    ? openRouterId.slice(openRouterId.indexOf("/") + 1)
    : openRouterId;
  return afterSlash.split(":")[0] ?? afterSlash;
}

export function toNativeModelId(openRouterId: string, provider: NativeProvider): string {
  const id = baseId(openRouterId);

  switch (provider) {
    case "openai":
      // OpenRouter exposes the rolling chat alias as `*-chat`; OpenAI calls it `*-chat-latest`.
      return id.endsWith("-chat") ? `${id}-latest` : id;
    case "anthropic":
      // Dotted version → dashed undated alias (claude-sonnet-4.6 → claude-sonnet-4-6).
      return id.replaceAll(".", "-");
    case "google":
      // Native/SDK ids keep dots and take no `models/` prefix.
      return id;
    case "deepseek":
      return id;
  }
}
