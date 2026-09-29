import { openrouter } from "@openrouter/ai-sdk-provider";
import {
  CHAT_WEB_SEARCHES_PER_REPLY,
  WEB_SEARCH_ENGINE,
  WEB_SEARCH_MAX_RESULTS,
} from "@/lib/pricing";

/**
 * OpenRouter's `openrouter:web_search` server tool. OpenRouter runs the
 * searches, so the reply streams only the sources, and their fee is in the
 * call's reported cost. The provider's factory sends its options at the tool's
 * top level, where OpenRouter ignores them, so they go in `parameters` here.
 */
export function buildOpenRouterWebSearchTool() {
  return Object.assign(openrouter.tools.webSearch({}), {
    args: {
      parameters: {
        engine: WEB_SEARCH_ENGINE,
        max_results: WEB_SEARCH_MAX_RESULTS,
        max_uses: CHAT_WEB_SEARCHES_PER_REPLY,
      },
    },
  });
}
