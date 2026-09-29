/**
 * Pure decision logic for the per-user server-model choice (the credits path).
 *
 * - "recommended" (and no stored choice at all): each task runs on the model an
 *   admin set for it.
 * - a named preset: every task runs on that preset's model.
 * - "custom": every task runs on the remembered model.
 *
 * `serverModelId` is STICKY: it remembers the user's last custom pick and is
 * only consulted when `serverPreset === "custom"`, so switching away and back
 * restores it.
 */

export const PRESET_KEYS = ["fast", "balanced", "intelligent"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];
export type ServerPreset = PresetKey | "custom" | "recommended";

export interface UserServerChoice {
  serverPreset: ServerPreset;
  serverModelId?: string | null;
}

export type ServerModelDecision =
  | { kind: "recommended" }
  | { kind: "preset"; preset: PresetKey }
  | { kind: "custom"; modelId: string };

export function resolveServerModelChoice(choice: UserServerChoice | null | undefined): ServerModelDecision {
  if (!choice || choice.serverPreset === "recommended") return { kind: "recommended" };
  if (choice.serverPreset === "custom") {
    // Custom selected but never picked → Recommended.
    return choice.serverModelId ? { kind: "custom", modelId: choice.serverModelId } : { kind: "recommended" };
  }
  return { kind: "preset", preset: choice.serverPreset };
}
