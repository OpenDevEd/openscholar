/**
 * A research area as its page in the app shows it (#323): what it covers, its keywords and
 * where it sits, from the kept copy of OpenAlex's topic (../topics/details.ts). Its papers
 * are a search filtered by it (./papers.ts).
 */
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { readTopicDetail } from "../topics/details";
import { topicKeywordsValidator, topicPathValidator } from "../topics/validators";
import { linkLabel } from "../assistant/links";

const topicValidator = v.object({ id: v.string(), name: v.string(), description: v.string(), keywords: topicKeywordsValidator, within: topicPathValidator, papers: v.number(), link: v.string() });

export const getAction = defineUserAction({
  path: "research/topics:get",
  description:
    "Reads a research area by its ID, such as T10011, as research/lookup:find gives it with kind researchArea: its name, what it covers, its keywords, the subfield, field and domain it sits under, and how many papers it has, with its page in the app. " +
    "Its papers are research/papers:search with `researchAreas`. It costs nothing against the person's OpenAlex allowance.",
  args: { id: v.string() },
  returns: topicValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, _actor, { id }) => {
    const asked = /^(?:https:\/\/openalex\.org\/)?(T[1-9]\d*)$/i.exec(id.trim())?.[1]?.toUpperCase();
    if (!asked) throw createError("VALIDATION_ERROR", "A research area is read by its topic ID, such as T10011.");
    const topic = await readTopicDetail(ctx, { id: asked });
    return { id: topic.id, name: topic.name, description: topic.description, keywords: topic.keywords, within: topic.path, papers: topic.worksCount, link: `[${linkLabel(topic.name)}](/topics/${topic.id})` };
  },
});
export const get = userAction(getAction);
export const getForAssistant = assistantAction(getAction);
