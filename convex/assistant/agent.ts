/**
 * The assistant's agent (#324). Each reply names its own model (./replies.ts), so the
 * model here only fills the constructor.
 */
import { Agent } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { defaultLanguageModel } from "../chat/agent";

/**
 * Fixed text: no time, page, person or record state, so every chat's requests begin with
 * the same cached prefix. Its tools arrive with #327; until then it only talks, and it says so.
 */
export const INSTRUCTIONS =
  "You are the research assistant in OpenScholar, an app for finding, screening and extracting data from academic papers. " +
  "Answer plainly and briefly. You can't search, open pages or change anything in the app yet. " +
  "When someone asks you to, say so, and never claim to have done it.";

export const assistant: Agent = new Agent(components.agent, {
  name: "Assistant",
  languageModel: defaultLanguageModel,
  instructions: INSTRUCTIONS,
  // Each reply builds its own context (./context.ts); the agent only looks up the message it answers.
  contextOptions: { recentMessages: 1, excludeToolMessages: false },
  storageOptions: { saveMessages: "promptAndOutput" },
});
