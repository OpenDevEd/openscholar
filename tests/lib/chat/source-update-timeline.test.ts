import { describe, expect, it } from "vitest";
import {
  isAssistantCitationDeprecated,
  shouldRenderSourceUpdateDividerAfterMessages,
  shouldRenderSourceUpdateDividerBeforeMessage,
} from "@/lib/chat/source-update-timeline";

describe("source update timeline helpers", () => {
  const boundary = { boundaryOrder: 2 };

  it("deprecates assistant citations before the latest source-update boundary", () => {
    expect(
      isAssistantCitationDeprecated(
        { role: "assistant", order: 1 },
        boundary,
      ),
    ).toBe(true);
  });

  it("does not deprecate user messages or assistant messages after the boundary", () => {
    expect(
      isAssistantCitationDeprecated({ role: "user", order: 1 }, boundary),
    ).toBe(false);
    expect(
      isAssistantCitationDeprecated(
        { role: "assistant", order: 2 },
        boundary,
      ),
    ).toBe(false);
  });

  it("inserts the divider before the first message in the new source segment", () => {
    expect(
      shouldRenderSourceUpdateDividerBeforeMessage({
        previous: { order: 1 },
        message: { order: 2 },
        boundary,
      }),
    ).toBe(true);
    expect(
      shouldRenderSourceUpdateDividerBeforeMessage({
        previous: { order: 2 },
        message: { order: 2 },
        boundary,
      }),
    ).toBe(false);
  });

  it("renders the divider after all messages when no newer turn exists yet", () => {
    expect(
      shouldRenderSourceUpdateDividerAfterMessages([
        { order: 0 },
        { order: 1 },
      ], boundary),
    ).toBe(true);
  });
});
