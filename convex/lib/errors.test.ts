import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { createError } from "./errors";

describe("createError", () => {
  it("returns a ConvexError with code and message when both provided", () => {
    const err = createError("VALIDATION_ERROR", "bad input");
    expect(err).toBeInstanceOf(ConvexError);
    expect(err.data).toEqual({
      code: "VALIDATION_ERROR",
      message: "bad input",
    });
  });

  it("returns a ConvexError with just code when message omitted", () => {
    const err = createError("NOT_FOUND");
    expect(err).toBeInstanceOf(ConvexError);
    expect(err.data).toEqual({ code: "NOT_FOUND" });
  });

  it("supports the CONFLICT code", () => {
    const err = createError("CONFLICT", "resource in use");
    expect(err.data.code).toBe("CONFLICT");
    expect(err.data.message).toBe("resource in use");
  });
});
