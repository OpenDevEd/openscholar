export type ChatMessageTextPart = {
  type: string;
  text?: string;
};

export type ChatMessageTextSource = {
  text?: string | null;
  parts?: readonly ChatMessageTextPart[] | null;
};

function isTextPart(
  part: ChatMessageTextPart,
): part is ChatMessageTextPart & { type: "text"; text: string } {
  return part.type === "text" && typeof part.text === "string";
}

export function getChatMessageText(message: ChatMessageTextSource): string {
  if (typeof message.text === "string" && message.text.length > 0) {
    return message.text;
  }
  return (message.parts ?? []).filter(isTextPart).map((part) => part.text).join("");
}
