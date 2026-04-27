import { describe, expect, it } from "vitest";
import {
  ABORT_ERROR_STRING,
  isAbortErrorString,
  isAbortLike,
} from "./abort-signal";

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

describe("isAbortLike", () => {
  it("recognizes a DOMException-style Error with name AbortError", () => {
    const err = Object.assign(new Error("Operation was aborted"), {
      name: "AbortError",
    });
    expect(isAbortLike(err)).toBe(true);
  });

  it("recognizes new Error(stringifiedAbortSentinel) — the extraction onComplete shape", () => {
    // convex/extraction/mutations/internal/onComplete.ts wraps stored
    // error strings into Error instances. When the stored string is the
    // agent's serialized abort sentinel, the resulting Error has name
    // "Error" (not "AbortError") and the sentinel only as message.
    expect(isAbortLike(new Error(ABORT_ERROR_STRING))).toBe(true);
  });

  it("recognizes the agent message-update wrapper inside an Error message", () => {
    expect(
      isAbortLike(
        new Error(
          `Trying to update a message that failed: msg_42, error: ${ABORT_ERROR_STRING}`,
        ),
      ),
    ).toBe(true);
  });

  it("recognizes plain Record-shaped abort sentinels", () => {
    expect(isAbortLike({ name: "AbortError" })).toBe(true);
    expect(isAbortLike({ message: ABORT_ERROR_STRING })).toBe(true);
  });

  it("recognizes the bare sentinel string", () => {
    expect(isAbortLike(ABORT_ERROR_STRING)).toBe(true);
  });

  it("rejects nullish, primitive, and unrelated error shapes", () => {
    expect(isAbortLike(null)).toBe(false);
    expect(isAbortLike(undefined)).toBe(false);
    expect(isAbortLike(42)).toBe(false);
    expect(isAbortLike(new Error("Provider 503"))).toBe(false);
    expect(isAbortLike({ message: "rate limited" })).toBe(false);
    expect(
      isAbortLike(
        "Trying to update a message that failed: msg_1, error: Provider 503",
      ),
    ).toBe(false);
  });
});
