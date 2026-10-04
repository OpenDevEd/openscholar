/**
 * The assistant's agent (#324). Each reply names its own model (./replies.ts), so the
 * model here only fills the constructor.
 */
import { Agent } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { defaultLanguageModel } from "../chat/agent";

export const assistant: Agent = new Agent(components.agent, {
  name: "Assistant",
  languageModel: defaultLanguageModel,
  // Its tools arrive with #327; until then it only talks, and it says so.
  instructions:
    "You are the research assistant in OpenScholar, an app for finding, screening and extracting data from academic papers. " +
    "Answer plainly and briefly. You can't search, open pages or change anything in the app yet. " +
    "When someone asks you to, say so, and never claim to have done it.",
  // The conversation goes to the model as it was sent, tool messages included, so the
  // provider's cache of it stays valid from one reply to the next. #326 bounds it.
  contextOptions: { recentMessages: 400, excludeToolMessages: false },
  storageOptions: { saveMessages: "promptAndOutput" },
});
