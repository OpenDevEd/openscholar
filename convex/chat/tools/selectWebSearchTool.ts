/**
 * Single decision point for which web-search path the chat agent should
 * take on a given turn. Pure logic — the env read for `hasTavilyKey`
 * happens at the call site (convex/chat/messages.ts) so this helper
 * stays trivially testable.
 *
 * Decision rules:
 *   - Toggle off OR capability missing → null (silent no-op).
 *   - Toggle on AND Tavily key set     → "tavily"     (Path B: visible streaming + per-call cost).
 *   - Toggle on AND no Tavily key      → "openrouter" (Path A: server-side, source-url chips only).
 */
export type WebSearchPath = "tavily" | "openrouter" | null;

export function pickWebSearchTool(args: {
  enabled: boolean | undefined;
  modelSupportsWebSearch: boolean;
  hasTavilyKey: boolean;
}): WebSearchPath {
  if (!args.enabled) return null;
  if (!args.modelSupportsWebSearch) return null;
  if (args.hasTavilyKey) return "tavily";
  return "openrouter";
}
