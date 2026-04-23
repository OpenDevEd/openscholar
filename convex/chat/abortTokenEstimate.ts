/**
 * Heuristic token estimation for aborted chat turns.
 *
 * OpenRouter's `/api/v1/generation?id=...` lookup does not publish
 * records for cancelled streams routed to providers outside OpenRouter's
 * cancellation-support whitelist (Google, Groq, HuggingFace, Mistral…).
 * For those turns we cannot reconcile authoritative cost, so we bill
 * from a local estimate: the user's prompt text as input tokens, and
 * the text that actually streamed before the abort as output tokens.
 *
 * gpt-tokenizer is a pure-JS `cl100k_base`-family tokenizer — the same
 * BPE family OpenAI/Anthropic use. Gemini's tokenizer is slightly
 * different (SentencePiece-based), but for billing purposes cl100k is
 * close enough (typically ≤ 10% off) and avoids pulling in a
 * model-specific tokenizer per provider.
 *
 * Caveat: input tokens here only cover the user's latest prompt
 * message, NOT the full context (thread history + system prompt +
 * included paper abstracts). That means aborted turns are
 * systematically under-charged relative to happy-path turns. That is
 * acceptable policy — the user was cut off mid-response.
 */

import { encode } from "gpt-tokenizer";

export function estimateTokenCount(text: string): number {
  if (!text || text.length === 0) return 0;
  try {
    return encode(text).length;
  } catch {
    // Fall back to a conservative char/4 heuristic if the tokenizer
    // throws on weird inputs. Keeps billing going rather than failing
    // the whole abort path.
    return Math.ceil(text.length / 4);
  }
}

type MessageDocLike = {
  text?: string | null;
  message?: {
    content?:
      | string
      | Array<{ type?: string; text?: string } | null | undefined>
      | null;
  } | null;
} | null | undefined;

/**
 * Extracts the plain text of a MessageDoc returned by
 * `components.agent.messages.getMessagesByIds`. The agent library
 * writes a flat `text` convenience field for simple messages, but
 * multi-part user messages can store an array of parts in
 * `message.content`. We concatenate the text parts so vision-style
 * prompts still contribute their text to the input-token estimate.
 */
export function extractMessageText(doc: MessageDocLike): string {
  if (!doc) return "";
  if (typeof doc.text === "string" && doc.text.length > 0) {
    return doc.text;
  }
  const content = doc.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && part.type === "text"
          ? (part.text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

export function errorToLogString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}
