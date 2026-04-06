import { describe, it, expect } from "vitest";
import { detectSearchMode } from "@/lib/search/detect-mode";

describe("detectSearchMode", () => {
  // ── Empty / trivial ─────────────────────────────────────────────────────
  it("returns 'search' for empty string", () => {
    expect(detectSearchMode("", "en-US")).toBe("search");
  });

  it("returns 'search' for whitespace-only", () => {
    expect(detectSearchMode("   ", "en-US")).toBe("search");
  });

  // ── Priority 1: Question punctuation ────────────────────────────────────
  describe("question punctuation (universal, no length gate)", () => {
    it("detects trailing '?'", () => {
      expect(detectSearchMode("test?", "en-US")).toBe("research");
    });

    it("detects trailing '?' with whitespace", () => {
      expect(detectSearchMode("  test?  ", "en-US")).toBe("research");
    });

    it("detects CJK fullwidth '？'", () => {
      expect(detectSearchMode("测试？", "zh")).toBe("research");
    });

    it("detects Arabic question mark '؟'", () => {
      expect(detectSearchMode("اختبار؟", "en-US")).toBe("research");
    });

    it("triggers even for single-word queries", () => {
      expect(detectSearchMode("WHO?", "en-US")).toBe("research");
    });
  });

  // ── Priority 2: Sentence-final particles ────────────────────────────────
  describe("sentence-final particles", () => {
    it("detects Japanese か (ka)", () => {
      expect(detectSearchMode("これは正しいか", "ja")).toBe("research");
    });

    it("detects Chinese 吗 (ma)", () => {
      expect(detectSearchMode("这是正确的吗", "zh")).toBe("research");
    });

    it("detects Chinese 呢 (ne)", () => {
      expect(detectSearchMode("怎么样呢", "zh")).toBe("research");
    });
  });

  // ── Priority 3: Question words (English) ────────────────────────────────
  describe("English question words", () => {
    const englishQuestions = [
      "what is the effect of CRISPR on gene therapy",
      "how does machine learning improve cancer detection",
      "why do systematic reviews fail to reproduce",
      "which interventions reduce hospital readmission",
      "when was CRISPR first used in human trials",
      "where is gene therapy most widely adopted",
      "who discovered the double helix structure",
      "does vitamin D supplementation reduce mortality",
      "is there a relationship between sleep and cognition",
      "are randomized controlled trials always necessary",
      "can machine learning predict drug resistance",
      "could CRISPR eliminate genetic diseases",
      "should meta-analyses include grey literature",
      "would early intervention improve stroke outcomes",
    ];

    for (const q of englishQuestions) {
      it(`detects: "${q.slice(0, 50)}..."`, () => {
        expect(detectSearchMode(q, "en-US")).toBe("research");
      });
    }

    it("works with en-GB locale too", () => {
      expect(
        detectSearchMode("what is the effect of tea on health", "en-GB")
      ).toBe("research");
    });
  });

  // ── Priority 3: Question words (French) ─────────────────────────────────
  describe("French question words", () => {
    it("detects 'comment'", () => {
      expect(
        detectSearchMode("comment l'IA améliore-t-elle le diagnostic", "fr")
      ).toBe("research");
    });

    it("detects 'pourquoi'", () => {
      expect(
        detectSearchMode("pourquoi les revues systématiques échouent", "fr")
      ).toBe("research");
    });

    it("detects 'quel'", () => {
      expect(
        detectSearchMode("quel est l'impact de la vaccination", "fr")
      ).toBe("research");
    });

    it("detects 'est-ce que'", () => {
      expect(
        detectSearchMode("est-ce que la vitamine D réduit la mortalité", "fr")
      ).toBe("research");
    });

    it("detects 'combien'", () => {
      expect(
        detectSearchMode("combien de patients sont nécessaires pour une étude", "fr")
      ).toBe("research");
    });
  });

  // ── Priority 3: Question words (Chinese) ────────────────────────────────
  describe("Chinese question words", () => {
    it("detects 什么", () => {
      expect(detectSearchMode("什么是机器学习的最新进展", "zh")).toBe("research");
    });

    it("detects 如何", () => {
      expect(detectSearchMode("如何提高癌症检测的准确率", "zh")).toBe("research");
    });

    it("detects 为什么", () => {
      expect(detectSearchMode("为什么系统综述结果不一致", "zh")).toBe("research");
    });
  });

  // ── Priority 3: Question words (Hindi) ──────────────────────────────────
  describe("Hindi question words", () => {
    it("detects क्या", () => {
      expect(detectSearchMode("क्या मशीन लर्निंग कैंसर का पता लगा सकती है", "hi")).toBe(
        "research"
      );
    });

    it("detects कैसे", () => {
      expect(detectSearchMode("कैसे एआई चिकित्सा निदान में सुधार करती है", "hi")).toBe(
        "research"
      );
    });
  });

  // ── Priority 3: Question words (Japanese) ───────────────────────────────
  describe("Japanese question words", () => {
    it("detects なぜ", () => {
      expect(detectSearchMode("なぜ系統的レビューは再現に失敗するのか", "ja")).toBe(
        "research"
      );
    });

    it("detects どう", () => {
      expect(detectSearchMode("どう機械学習ががん検出を改善するか", "ja")).toBe(
        "research"
      );
    });
  });

  // ── Priority 4: Relational bridge phrases ───────────────────────────────
  describe("relational bridge phrases (English)", () => {
    it("detects 'effect of...on'", () => {
      expect(
        detectSearchMode("effect of sleep deprivation on memory consolidation", "en-US")
      ).toBe("research");
    });

    it("detects 'relationship between'", () => {
      expect(
        detectSearchMode("relationship between diet and cardiovascular risk", "en-US")
      ).toBe("research");
    });

    it("detects 'impact of'", () => {
      expect(
        detectSearchMode("impact of remote learning on student outcomes", "en-US")
      ).toBe("research");
    });

    it("detects 'role of'", () => {
      expect(
        detectSearchMode("role of gut microbiome in immune response", "en-US")
      ).toBe("research");
    });

    it("detects 'association between'", () => {
      expect(
        detectSearchMode("association between smoking and lung cancer", "en-US")
      ).toBe("research");
    });

    it("detects 'difference between'", () => {
      expect(
        detectSearchMode("difference between RCTs and observational studies", "en-US")
      ).toBe("research");
    });
  });

  describe("relational bridge phrases (French)", () => {
    it("detects 'effet de'", () => {
      expect(
        detectSearchMode("effet de la privation de sommeil sur la mémoire", "fr")
      ).toBe("research");
    });

    it("detects 'relation entre'", () => {
      expect(
        detectSearchMode("relation entre alimentation et risque cardiovasculaire", "fr")
      ).toBe("research");
    });
  });

  // ── False positive resistance ───────────────────────────────────────────
  describe("false positive resistance", () => {
    it("does NOT trigger on keyword searches", () => {
      expect(detectSearchMode("machine learning cancer detection", "en-US")).toBe(
        "search"
      );
    });

    it("does NOT trigger on 'CRISPR gene editing 2024'", () => {
      expect(detectSearchMode("CRISPR gene editing 2024", "en-US")).toBe("search");
    });

    it("does NOT trigger on 'systematic review methodology'", () => {
      expect(detectSearchMode("systematic review methodology", "en-US")).toBe(
        "search"
      );
    });

    it("does NOT trigger on 'COVID-19 vaccine efficacy meta-analysis'", () => {
      expect(
        detectSearchMode("COVID-19 vaccine efficacy meta-analysis", "en-US")
      ).toBe("search");
    });

    it("does NOT trigger on single word 'WHO' (acronym, length gate)", () => {
      expect(detectSearchMode("WHO", "en-US")).toBe("search");
    });

    it("does NOT trigger on 'WHO guidelines malaria' (2 tokens, below gate)", () => {
      expect(detectSearchMode("WHO guidelines", "en-US")).toBe("search");
    });

    it("does NOT trigger on short queries even with question-like word", () => {
      expect(detectSearchMode("how to", "en-US")).toBe("search");
    });

    it("does NOT trigger French words in English locale", () => {
      // "comment" in English is a noun, not a question word
      expect(detectSearchMode("comment section analysis paper", "en-US")).toBe(
        "search"
      );
    });
  });

  // ── Locale scoping ─────────────────────────────────────────────────────
  describe("locale scoping", () => {
    it("uses English words for en-US", () => {
      expect(
        detectSearchMode("what is the best treatment for diabetes", "en-US")
      ).toBe("research");
    });

    it("uses French words for fr locale", () => {
      expect(
        detectSearchMode("comment traiter le diabète efficacement", "fr")
      ).toBe("research");
    });

    it("falls back to language code from compound locale", () => {
      // "en-AU" should still work since lang = "en"
      expect(
        detectSearchMode("what is the best treatment for diabetes", "en-AU")
      ).toBe("research");
    });

    it("returns 'search' for unknown locale with no question markers", () => {
      expect(
        detectSearchMode("machine learning cancer", "xx-XX")
      ).toBe("search");
    });

    it("still detects '?' for unknown locale", () => {
      expect(detectSearchMode("test?", "xx-XX")).toBe("research");
    });
  });

  // ── Case insensitivity ─────────────────────────────────────────────────
  describe("case insensitivity", () => {
    it("detects 'What' (capital)", () => {
      expect(
        detectSearchMode("What is the effect of exercise on aging", "en-US")
      ).toBe("research");
    });

    it("detects 'HOW' (all caps)", () => {
      expect(
        detectSearchMode("HOW does AI improve radiology outcomes", "en-US")
      ).toBe("research");
    });

    it("detects 'EFFECT OF' (bridge phrase, all caps)", () => {
      expect(
        detectSearchMode("EFFECT OF caffeine on sleep quality", "en-US")
      ).toBe("research");
    });
  });
});
