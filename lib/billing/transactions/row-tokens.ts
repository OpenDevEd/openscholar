export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.trunc(n));
  if (n < 10_000) {
    const v = n / 1000;
    const s = v.toFixed(1).replace(/\.0$/, "");
    return `${s}K`;
  }
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  const m = n / 1_000_000;
  const s = m.toFixed(1).replace(/\.0$/, "");
  return `${s}M`;
}

export interface TokenUsage {
  input?: number | null;
  output?: number | null;
}

export function formatTokenUsageSummary(usage: TokenUsage): string | null {
  const input = toFiniteNonneg(usage.input);
  const output = toFiniteNonneg(usage.output);
  if (input === null && output === null) return null;
  const parts: string[] = [];
  if (input !== null && input > 0) parts.push(`${formatTokenCount(input)} in`);
  if (output !== null && output > 0) parts.push(`${formatTokenCount(output)} out`);
  if (parts.length === 0) return null;
  return parts.join(" / ");
}

function toFiniteNonneg(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) return null;
  if (v < 0) return null;
  return v;
}

export function parseTokensFromMetadata(
  metadata: Record<string, string> | null | undefined,
): TokenUsage {
  if (!metadata) return { input: null, output: null };
  return {
    input: parseNonNegInt(metadata.inputTokens),
    output: parseNonNegInt(metadata.outputTokens),
  };
}

function parseNonNegInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
