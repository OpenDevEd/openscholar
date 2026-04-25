import { describe, expect, it } from "vitest";
import { ABORT_ERROR_STRING, isAbortErrorString } from "./abort-signal";

describe("chat abort sentinel classification", () => {
  it("accepts the direct agent abort sentinel", () => {
    expect(isAbortErrorString(ABORT_ERROR_STRING)).toBe(true);
  });

  it("accepts the agent message-update wrapper around the abort sentinel", () => {
    expect(
      isAbortErrorString(
        `Trying to update a message that failed: ks7fm4y0axy6ad5g8pfdmtq00x85f2m5, error: ${ABORT_ERROR_STRING}`,
      ),
    ).toBe(true);
  });

  it("rejects non-abort failed-message wrappers", () => {
    expect(
      isAbortErrorString(
        "Trying to update a message that failed: msg_1, error: Provider returned 503",
      ),
    ).toBe(false);
  });
});
