import { describe, it, expect } from "vitest";
import {
  getConfidenceColor,
  getCardColor,
  CONFIDENCE_THRESHOLDS,
  CARD_THRESHOLDS,
  BADGE_COLOR_CLASSES,
  BORDER_COLOR_CLASSES,
} from "../lib/extraction/card-thresholds";

describe("getConfidenceColor", () => {
  it("returns green for values above the green threshold (0.90)", () => {
    expect(getConfidenceColor(0.9)).toBe("green");
  });

  it("returns green at the green boundary (0.85)", () => {
    expect(getConfidenceColor(0.85)).toBe("green");
  });

  it("returns yellow for values between yellow and green thresholds (0.75)", () => {
    expect(getConfidenceColor(0.75)).toBe("yellow");
  });

  it("returns yellow at the yellow boundary (0.60)", () => {
    expect(getConfidenceColor(0.6)).toBe("yellow");
  });

  it("returns red just below the yellow threshold (0.59)", () => {
    expect(getConfidenceColor(0.59)).toBe("red");
  });

  it("returns red at zero (0)", () => {
    expect(getConfidenceColor(0)).toBe("red");
  });

  it("returns red for values just below green threshold (0.84)", () => {
    expect(getConfidenceColor(0.84)).toBe("yellow");
  });
});

describe("getCardColor - completion metric", () => {
  it("returns green at and above 0.75 (0.80)", () => {
    expect(getCardColor("completion", 0.8)).toBe("green");
  });

  it("returns green at the green boundary (0.75)", () => {
    expect(getCardColor("completion", 0.75)).toBe("green");
  });

  it("returns yellow between 0.50 and 0.74 (0.60)", () => {
    expect(getCardColor("completion", 0.6)).toBe("yellow");
  });

  it("returns yellow at the yellow boundary (0.50)", () => {
    expect(getCardColor("completion", 0.5)).toBe("yellow");
  });

  it("returns red below 0.50 (0.30)", () => {
    expect(getCardColor("completion", 0.3)).toBe("red");
  });

  it("returns red at zero (0)", () => {
    expect(getCardColor("completion", 0)).toBe("red");
  });

  it("returns yellow just below green threshold (0.74)", () => {
    expect(getCardColor("completion", 0.74)).toBe("yellow");
  });

  it("returns red just below yellow threshold (0.49)", () => {
    expect(getCardColor("completion", 0.49)).toBe("red");
  });
});

describe("getCardColor - quality metric", () => {
  it("returns green at and above 0.70 (0.75)", () => {
    expect(getCardColor("quality", 0.75)).toBe("green");
  });

  it("returns green at the green boundary (0.70)", () => {
    expect(getCardColor("quality", 0.7)).toBe("green");
  });

  it("returns yellow between 0.50 and 0.69 (0.55)", () => {
    expect(getCardColor("quality", 0.55)).toBe("yellow");
  });

  it("returns yellow at the yellow boundary (0.50)", () => {
    expect(getCardColor("quality", 0.5)).toBe("yellow");
  });

  it("returns red below 0.50 (0.40)", () => {
    expect(getCardColor("quality", 0.4)).toBe("red");
  });

  it("returns red at zero (0)", () => {
    expect(getCardColor("quality", 0)).toBe("red");
  });

  it("returns yellow just below green threshold (0.69)", () => {
    expect(getCardColor("quality", 0.69)).toBe("yellow");
  });

  it("returns red just below yellow threshold (0.49)", () => {
    expect(getCardColor("quality", 0.49)).toBe("red");
  });
});

describe("CONFIDENCE_THRESHOLDS constants", () => {
  it("exports green threshold of 0.85", () => {
    expect(CONFIDENCE_THRESHOLDS.green).toBe(0.85);
  });

  it("exports yellow threshold of 0.60", () => {
    expect(CONFIDENCE_THRESHOLDS.yellow).toBe(0.6);
  });
});

describe("CARD_THRESHOLDS constants", () => {
  it("exports completion green threshold of 0.75", () => {
    expect(CARD_THRESHOLDS.completion.green).toBe(0.75);
  });

  it("exports completion yellow threshold of 0.50", () => {
    expect(CARD_THRESHOLDS.completion.yellow).toBe(0.5);
  });

  it("exports quality green threshold of 0.70", () => {
    expect(CARD_THRESHOLDS.quality.green).toBe(0.7);
  });

  it("exports quality yellow threshold of 0.50", () => {
    expect(CARD_THRESHOLDS.quality.yellow).toBe(0.5);
  });
});

describe("BADGE_COLOR_CLASSES", () => {
  it("exports badge class for green", () => {
    expect(BADGE_COLOR_CLASSES.green).toContain("emerald");
  });

  it("exports badge class for yellow", () => {
    expect(BADGE_COLOR_CLASSES.yellow).toContain("amber");
  });

  it("exports badge class for red", () => {
    expect(BADGE_COLOR_CLASSES.red).toContain("red");
  });
});

describe("BORDER_COLOR_CLASSES", () => {
  it("exports border class for green", () => {
    expect(BORDER_COLOR_CLASSES.green).toContain("emerald");
  });

  it("exports border class for yellow", () => {
    expect(BORDER_COLOR_CLASSES.yellow).toContain("amber");
  });

  it("exports border class for red", () => {
    expect(BORDER_COLOR_CLASSES.red).toContain("red");
  });
});
