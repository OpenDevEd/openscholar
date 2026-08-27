import { describe, expect, it } from "vitest";
import {

  tagRuleIssue,
} from "@/components/evidence-libraries/configuration/sections/tag-rules";

describe("tagRuleIssue", () => {
  it("requires at least one publish tag and caps the others", () => {
    expect(tagRuleIssue("publish", [])).toBe("publishEmpty");
    expect(tagRuleIssue("hidden", [])).toBeNull();
    expect(tagRuleIssue("hidden", Array.from({ length: 11 }, (_, i) => `t${i}`))).toBe("tooMany");
    expect(tagRuleIssue("hidden", ["x".repeat(129)])).toBe("tooLong");
    expect(tagRuleIssue("publish", ["_publish"])).toBeNull();
  });
});
