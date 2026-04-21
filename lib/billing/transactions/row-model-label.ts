const DROP_SUFFIXES = new Set(["preview", "beta", "latest", "stable", "exp"]);

const VENDOR_ACRONYMS = new Set(["gpt", "llm", "api", "ai", "xl", "xs"]);

export function humanizeModelId(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  const trimmed = modelId.trim();
  if (!trimmed) return null;
  const bare = trimmed.includes("/") ? (trimmed.split("/").pop() ?? "") : trimmed;
  const tokens = bare
    .split(/[-_]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !/^\d+(?:\.\d+)?$/.test(t))
    .filter((t) => !DROP_SUFFIXES.has(t.toLowerCase()));
  if (tokens.length === 0) return bare || null;
  return tokens
    .map((t) => {
      const lower = t.toLowerCase();
      if (VENDOR_ACRONYMS.has(lower)) return lower.toUpperCase();
      return t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join(" ");
}
