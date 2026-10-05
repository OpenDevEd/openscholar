import { describe, expect, it } from "vitest";
import { draftSegments, mentionSegments, openMention, stillNamed, uniqueLabel, withTokens, type Mention } from "@/lib/assistant/mentions";

const coaching: Mention = { kind: "collection", id: "k1", label: "Teacher coaching" };
const coachingCost: Mention = { kind: "search", id: "s-9", label: "Teacher coaching (cost) [Kenya]?" };

describe("assistant mentions", () => {
  it("sends each picked @name as a token the chat reads back as the same record", () => {
    const sent = withTokens("compare @Teacher coaching (cost) [Kenya]? with @Teacher coaching please", [coaching, coachingCost]);
    expect(mentionSegments(sent)).toEqual([
      "compare ",
      { ...coachingCost, label: "Teacher coaching (cost) (Kenya)?" },
      " with ",
      coaching,
      " please",
    ]);
  });

  it("leaves a name edited after it was picked as plain text", () => {
    expect(draftSegments("see @Teacher coachin", [coaching])).toEqual(["see @Teacher coachin"]);
    expect(withTokens("see @Teacher coachin", [coaching])).toBe("see @Teacher coachin");
    expect(withTokens("see @Teacher coachingX", [coaching])).toBe("see @Teacher coachingX");
  });

  it("names a second record of the same name apart, so each name sends its own ID", () => {
    const search: Mention = { kind: "search", id: "s-1", label: "Teacher coaching" };
    const picked = [coaching, { ...search, label: uniqueLabel(search, "search", [coaching]) }];
    expect(mentionSegments(withTokens("@Teacher coaching vs @Teacher coaching (search)", picked))).toEqual([coaching, " vs ", picked[1]]);
  });

  it("keeps only the picks a draft still names", () => {
    expect(stillNamed("about @Teacher coaching", [coaching, coachingCost])).toEqual([coaching]);
  });

  it("opens the picker only on an @ that starts a word and isn't a finished mention", () => {
    expect(openMention("ask @teach", 10, [])).toEqual({ start: 4, query: "teach" });
    expect(openMention("mail me@home", 12, [])).toBeNull();
    expect(openMention("@Teacher coaching", 17, [coaching])).toBeNull();
  });
});
