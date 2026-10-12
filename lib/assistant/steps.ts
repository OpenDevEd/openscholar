/**
 * Steps of one exchange a page of the chat lists: the newest, when a reply ran more. The
 * panel reads the ones before them a page at a time (`assistant/replies:steps`).
 */
export const STEPS_SHOWN = 150;

/** Characters of an action's arguments, of what reverses it, and of why it failed, that a step keeps. */
export const STEP_TEXT_MAX = 16_000;

/**
 * What a change that returns nothing tells the model. Nothing at all read, to a weaker model,
 * as not done yet: after the person allowed a deletion and it ran, the reply said it was
 * still waiting for them.
 */
export const DONE = { done: true } as const;
