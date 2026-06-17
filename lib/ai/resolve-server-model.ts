/**
 * Pure decision logic for the per-user server-model choice (the credits path).
 *
 * `serverModelId` is STICKY: it remembers the user's last custom pick and is
 * only consulted when `serverPreset === "custom"`. Switching to a named preset
 * leaves `serverModelId` untouched, so toggling Balanced → Fast → Custom restores
 * the remembered model. The caller turns the returned decision into a concrete
 * `models` row (preset key → aiModelConfig → models table; custom → that id).
 */

export type PresetKey = "fast" | "balanced" | "intelligent";
export type ServerPreset = PresetKey | "custom";

export interface UserServerChoice {
  serverPreset: ServerPreset;
  serverModelId?: string | null;
}

export type ServerModelDecision =
  | { kind: "preset"; preset: PresetKey }
  | { kind: "custom"; modelId: string };

export function resolveServerModelChoice(
  choice: UserServerChoice | null | undefined,
  defaultPreset: PresetKey,
): ServerModelDecision {
  if (!choice) {
    return { kind: "preset", preset: defaultPreset };
  }
  if (choice.serverPreset === "custom") {
    // Custom selected → use the remembered model, else fall back to the default preset.
    return choice.serverModelId
      ? { kind: "custom", modelId: choice.serverModelId }
      : { kind: "preset", preset: defaultPreset };
  }
  // serverPreset is now narrowed to a named PresetKey.
  return { kind: "preset", preset: choice.serverPreset };
}
