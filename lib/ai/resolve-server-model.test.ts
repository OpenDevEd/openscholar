import { describe, it, expect } from "vitest";
import { resolveServerModelChoice } from "./resolve-server-model";

const DEFAULT = "balanced" as const;

describe("resolveServerModelChoice", () => {
  it("falls back to the default preset when there is no stored choice", () => {
    expect(resolveServerModelChoice(null, DEFAULT)).toEqual({ kind: "preset", preset: "balanced" });
    expect(resolveServerModelChoice(undefined, DEFAULT)).toEqual({ kind: "preset", preset: "balanced" });
  });

  it("uses the chosen preset", () => {
    expect(resolveServerModelChoice({ serverPreset: "fast" }, DEFAULT)).toEqual({ kind: "preset", preset: "fast" });
    expect(resolveServerModelChoice({ serverPreset: "intelligent" }, DEFAULT)).toEqual({ kind: "preset", preset: "intelligent" });
  });

  it("uses the remembered custom model when preset is custom", () => {
    expect(resolveServerModelChoice({ serverPreset: "custom", serverModelId: "m_123" }, DEFAULT)).toEqual({ kind: "custom", modelId: "m_123" });
  });

  it("falls back to the default preset when custom is selected but no model was ever picked", () => {
    expect(resolveServerModelChoice({ serverPreset: "custom", serverModelId: null }, DEFAULT)).toEqual({ kind: "preset", preset: "balanced" });
    expect(resolveServerModelChoice({ serverPreset: "custom" }, DEFAULT)).toEqual({ kind: "preset", preset: "balanced" });
  });

  it("ignores (but does not require clearing) a remembered custom model while a preset is active — stickiness", () => {
    // serverModelId is retained in storage; it just isn't used unless preset === "custom".
    expect(resolveServerModelChoice({ serverPreset: "balanced", serverModelId: "m_123" }, DEFAULT)).toEqual({ kind: "preset", preset: "balanced" });
  });
});
