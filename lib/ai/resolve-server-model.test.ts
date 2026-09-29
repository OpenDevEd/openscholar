import { describe, it, expect } from "vitest";
import { resolveServerModelChoice } from "./resolve-server-model";

describe("resolveServerModelChoice", () => {
  it("routes by task when there is no stored choice or Recommended is chosen", () => {
    expect(resolveServerModelChoice(null)).toEqual({ kind: "recommended" });
    expect(resolveServerModelChoice(undefined)).toEqual({ kind: "recommended" });
    expect(resolveServerModelChoice({ serverPreset: "recommended", serverModelId: "m_123" })).toEqual({ kind: "recommended" });
  });

  it("uses the chosen preset", () => {
    expect(resolveServerModelChoice({ serverPreset: "fast" })).toEqual({ kind: "preset", preset: "fast" });
    expect(resolveServerModelChoice({ serverPreset: "intelligent" })).toEqual({ kind: "preset", preset: "intelligent" });
  });

  it("uses the remembered custom model when custom is chosen", () => {
    expect(resolveServerModelChoice({ serverPreset: "custom", serverModelId: "m_123" })).toEqual({ kind: "custom", modelId: "m_123" });
  });

  it("routes by task when custom is chosen but no model was ever picked", () => {
    expect(resolveServerModelChoice({ serverPreset: "custom", serverModelId: null })).toEqual({ kind: "recommended" });
    expect(resolveServerModelChoice({ serverPreset: "custom" })).toEqual({ kind: "recommended" });
  });

  it("keeps a remembered custom model while a preset is active", () => {
    expect(resolveServerModelChoice({ serverPreset: "balanced", serverModelId: "m_123" })).toEqual({ kind: "preset", preset: "balanced" });
  });
});
