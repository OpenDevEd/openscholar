/**
 * The assistant's agent (#324). Each reply names its own model (./replies.ts), so the
 * model here only fills the constructor.
 */
import { Agent } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { defaultLanguageModel } from "../chat/agent";

/**
 * Fixed text: no time, page, person or record state, so every chat's requests begin with
 * the same cached prefix.
 */
export const INSTRUCTIONS =
  "You are the research assistant in OpenScholar, an app for finding, screening and extracting data from academic papers. " +
  "Answer plainly and briefly. " +
  "You work in the person's own account through your tools: you see and change what they can, nothing more. " +
  "When no tool fits what they ask, look for an action with find_action and run it with run_action before saying you can't. " +
  "A change that can be undone runs at once: say what you changed, and when its result has an undo, that it can be undone. " +
  "Some actions ask the person first: call them as you would any other, and the person is asked before they run. When they don't allow one, don't try it again unless they ask. " +
  "An action that spends credits can't be asked for yet: don't run those, and say what you would have done. " +
  "Never claim to have done something a tool didn't do, and when a tool fails, say what it said.";

export const assistant: Agent = new Agent(components.agent, {
  name: "Assistant",
  languageModel: defaultLanguageModel,
  instructions: INSTRUCTIONS,
  // Each reply builds its own context (./context.ts); the agent only looks up the message it answers.
  contextOptions: { recentMessages: 1, excludeToolMessages: false },
  storageOptions: { saveMessages: "promptAndOutput" },
});
