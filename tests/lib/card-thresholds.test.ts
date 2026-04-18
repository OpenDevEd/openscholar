/**
 * Unit tests for the threshold -> color role mapping.
 *
 * These replace the removed className assertions in summary-cards.test.tsx.
 * The component is responsible for applying whatever CSS corresponds to
 * a color role; the threshold logic is a pure function and belongs here.
 */
import { describe, it, expect } from "vitest";
import {
  getCardColor,
  getConfidenceColor,
  CARD_THRESHOLDS,
  CONFIDENCE_THRESHOLDS,
} from "@/lib/extraction/card-thresholds";

describe("getCardColor('completion', ...)", () => {
  const { green, yellow } = CARD_THRESHOLDS.completion;

  it("returns 'green' at or above the green threshold", () => {
    expect(getCardColor("completion", green)).toBe("green");
    expect(getCardColor("completion", green + 0.01)).toBe("green");
    expect(getCardColor("completion", 1)).toBe("green");
  });

  it("returns 'yellow' between the yellow and green thresholds", () => {
    expect(getCardColor("completion", yellow)).toBe("yellow");
    expect(getCardColor("completion", green - 0.01)).toBe("yellow");
  });

  it("returns 'red' below the yellow threshold", () => {
    expect(getCardColor("completion", yellow - 0.01)).toBe("red");
    expect(getCardColor("completion", 0)).toBe("red");
  });
});

describe("getCardColor('quality', ...)", () => {
  const { green, yellow } = CARD_THRESHOLDS.quality;

  it("returns 'green' at or above the green threshold", () => {
    expect(getCardColor("quality", green)).toBe("green");
    expect(getCardColor("quality", 1)).toBe("green");
  });

  it("returns 'yellow' between the yellow and green thresholds", () => {
    expect(getCardColor("quality", yellow)).toBe("yellow");
    expect(getCardColor("quality", green - 0.01)).toBe("yellow");
  });

  it("returns 'red' below the yellow threshold", () => {
    expect(getCardColor("quality", yellow - 0.01)).toBe("red");
    expect(getCardColor("quality", 0)).toBe("red");
  });
});

describe("getConfidenceColor", () => {
  const { green, yellow } = CONFIDENCE_THRESHOLDS;

  it("returns 'green' at or above the green threshold", () => {
    expect(getConfidenceColor(green)).toBe("green");
    expect(getConfidenceColor(1)).toBe("green");
  });

  it("returns 'yellow' between the yellow and green thresholds", () => {
    expect(getConfidenceColor(yellow)).toBe("yellow");
    expect(getConfidenceColor(green - 0.01)).toBe("yellow");
  });

  it("returns 'red' below the yellow threshold", () => {
    expect(getConfidenceColor(yellow - 0.01)).toBe("red");
    expect(getConfidenceColor(0)).toBe("red");
  });
});
