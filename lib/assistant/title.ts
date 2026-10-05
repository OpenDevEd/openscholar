import { plainMentions } from "./mentions";

/** What a chat is called until its first message names it. */
export const NEW_CHAT_TITLE = "New chat";
/** Characters of a chat's title that its first message gives it. */
const TITLE_MAX = 60;

/** A chat is named after its first message's first line, cut between characters, never inside one. */
export function titleFrom(text: string) {
  const line = [...plainMentions(text).trim().split("\n")[0]!.replace(/\s+/g, " ")];
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).join("").trimEnd()}…` : line.join("");
}
