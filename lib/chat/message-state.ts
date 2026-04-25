import { isAbortErrorString } from "./abort-signal";

type ChatMessageStateInput = {
  id: string;
  role?: string;
  status?: string;
  error?: string;
  aborted?: boolean;
};

function isAssistantMessage(message: ChatMessageStateInput): boolean {
  return message.role == null || message.role === "assistant";
}

function isStreamBackedAbortedMessage(message: ChatMessageStateInput): boolean {
  return (
    isAssistantMessage(message) &&
    message.id.startsWith("stream:") &&
    message.status === "failed" &&
    !message.error
  );
}

export function isAbortedChatMessageState(
  message: ChatMessageStateInput,
): boolean {
  return (
    message.aborted === true ||
    (typeof message.error === "string" && isAbortErrorString(message.error)) ||
    isStreamBackedAbortedMessage(message)
  );
}

export function normalizeChatUIMessage<T extends ChatMessageStateInput>(
  message: T,
): T & { aborted?: boolean; error?: string } {
  if (!isAbortedChatMessageState(message)) {
    return message as T & { aborted?: boolean; error?: string };
  }

  const { error: _error, ...withoutError } = message;
  return { ...withoutError, aborted: true } as T & {
    aborted: boolean;
    error?: string;
  };
}

export function selectChatMessageError(
  errors: Array<string | undefined>,
): string | undefined {
  const present = errors.filter((error): error is string => Boolean(error));
  return present.find(isAbortErrorString) ?? present.at(-1);
}
