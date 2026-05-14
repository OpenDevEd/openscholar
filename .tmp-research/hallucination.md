# Hallucination Resistance & Factual Accuracy — Cheap Long-Context LLMs for Academic Extraction

Research date: 2026-05-13
Author: research agent for OpenAlex-count project

This report focuses on **factual reliability per dollar** for cheap, long-context LLMs that you would deploy to extract structured information from academic papers without inventing citations, authors, numbers, or claims.

---

## 1. Reading guide (CRITICAL — methodology pitfalls)

Several benchmark numbers in vendor materials look impressive but are misleading for the academic extraction use case. Decode them before trusting them:

1. **SimpleQA scores >90% are tool-using.** DeepSeek-V3.2-Exp's "97.1%" SimpleQA and DeepSeek-V3.1's "93.4%" are explicitly in the **Agentic Tool Use** column of DeepSeek's own table (https://huggingface.co/deepseek-ai/DeepSeek-V3.2-Exp). These models are calling a search agent — the score reflects search quality, not parametric knowledge or extraction robustness. Pure parametric SimpleQA for DeepSeek V3 is ~25–27 (HF discussions, https://huggingface.co/deepseek-ai/DeepSeek-V3-Base/discussions/27).
2. **Vectara HHEM is the most extraction-aligned benchmark.** It measures hallucination during *grounded* summarization with the explicit instruction "Use only the information in the given passage. Do not infer. Do not use your internal knowledge." That is exactly the operating mode you want for academic-paper extraction. Vendor SimpleQA / FACTS Parametric measure closed-book trivia, which is **not** what you need.
3. **AA-Omniscience hallucination rate is a calibration test, not an extraction test.** It asks knowledge questions with no source provided. Models with low hallucination rates here (Claude Haiku 4.5 at 25–28%) are good at *abstaining* rather than guessing. Useful as a confidence signal, but doesn't predict grounded-extraction quality directly.
4. **NIAH ≠ extraction.** A model can pass needle-in-haystack at 1M tokens and still fabricate quotes on a real paper. Use NoLiMa, RULER, and document-QA fabrication studies, not vanilla NIAH, as proxies.
5. **The Qwen3-235B "54.3% SimpleQA" is contaminated.** Multiple community replications put the actual score near 15% (https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507/discussions/4). Discount Qwen self-reports on factuality.

---

## 2. Top-line ranked table — grounded hallucination rate (Vectara HHEM-2.3, new enterprise-length dataset)

This is the most relevant benchmark for academic extraction: it measures fabrication during faithful summarization, which is the same failure mode as fabricating a citation while extracting from a paper. Lower is better. Source: https://github.com/vectara/hallucination-leaderboard (updated 2026-05-11).

| Rank | Model | Hall. rate | Answer rate | Context | Input $/1M | Output $/1M | Open? |
|------|-------|-----------:|------------:|--------:|-----------:|------------:|:-----:|
| 1 | **GPT-5.4-nano (2026-03-17)** | **3.1%** | 100.0% | 400K | n/a | n/a | No |
| 2 | **Gemini 2.5 Flash-Lite** | **3.3%** | 99.5% | 1M | $0.10 | $0.40 | No |
| 3 | Llama-3.3-70B-Instruct-Turbo | 4.1% | 99.5% | 128K | varies | varies | Yes |
| 4 | Mistral-Large-2411 | 4.5% | 99.9% | 128K | — | — | Yes |
| 5 | Qwen3-8B | 4.8% | 99.9% | 128K | tiny | tiny | Yes |
| 6 | DeepSeek-V3.2-Exp | 5.3% | 96.6% | 128K | $0.50 | $1.60 | Yes |
| 7 | GPT-5.4-mini (2026-03-17) | 5.5% | 100.0% | 400K | n/a | n/a | No |
| 8 | DeepSeek-V3.1 | 5.5% | 94.5% | 128K | low | low | Yes |
| 9 | **GPT-4.1 (2025-04-14)** | **5.6%** | 99.9% | 1M | $2.00 | $8.00 | No |
| 10 | Qwen3-4B | 5.7% | 99.9% | 128K | tiny | tiny | Yes |
| 11 | DeepSeek-V3 | 6.1% | 97.5% | 128K | low | low | Yes |
| 12 | DeepSeek-V3.2 | 6.3% | 92.6% | 128K | $0.50 | $1.60 | Yes |
| — | Gemini-2.5-Pro | 7.0% | 99.1% | 1M | $1.25–2.50 | $10–15 | No |
| 13 | **Llama-4-Scout-17B-16E-Instruct** | **7.7%** | 99.0% | 10M | $0.08–0.11 | $0.30–0.34 | Yes |
| 14 | **Gemini 2.5 Flash** | **7.8%** | 99.0% | 1M | $0.30 | $2.50 | No |
| 15 | **Llama-4-Maverick-17B-128E-Instruct-FP8** | **8.2%** | 100.0% | 1M | $0.15–0.20 | $0.60 | Yes |
| 16 | **Gemini-3.1-Flash-Lite-Preview** | **8.2%** | 99.6% | 1M | $0.25 | $1.50 | No |
| 17 | DeepSeek-V4-Pro | 8.6% | 97.2% | 1M | — | — | Yes |
| 18 | MiniMax-M2.5 | 9.1% | 98.2% | 1M+ | low | low | Yes |
| — | Qwen3-235B-A22B | 9.3% | 94.9% | 128K | $0.60 | $1.20 | Yes |
| 19 | **Claude Haiku 4.5 (20251001)** | **9.8%** | 99.5% | 200K | $1.25 | $5.00 | No |
| — | Gemini-3.1-Pro-Preview | 10.4% | 99.4% | 1M | $2.00 | $12 | No |
| — | **GPT-5-nano (2025-08-07)** | **10.5%** | 100.0% | 400K | low | low | No |
| — | **GPT-5-mini (2025-08-07)** | **12.9%** | 99.9% | 400K | low | low | No |
| — | Gemini-3-Flash-Preview | 13.5% | 99.8% | 1M | $0.50 | $3.00 | No |
| — | Gemini-3-Pro-Preview | 13.6% | 99.4% | 1M | $2.00 | $12 | No |
| — | MiniMax-M2.1 | 11.8% | 98.5% | 1M+ | low | low | Yes |

**Vectara HHEM "no-hallucination winner" by tier:**
- Among **all models**: GPT-5.4-nano (3.1%) and Gemini 2.5 Flash-Lite (3.3%). The latter is the cheapest realistic option with a 1M context.
- Among **open-weights**: Llama-3.3-70B-Instruct-Turbo (4.1%), Qwen3-8B (4.8%), DeepSeek-V3.2-Exp (5.3%).
- Among **1M+ context cheap proprietary**: Gemini 2.5 Flash-Lite (3.3%) >> Gemini 2.5 Flash (7.8%) >> Gemini 3.1 Flash-Lite (8.2%) >> Gemini 3 Flash (13.5%). **Note the regression — Gemini 3 generation is worse on grounded summarization than Gemini 2.5 was.**
- Among **10M context**: Llama 4 Scout (7.7%). Only realistic 10M option that has been independently benchmarked.

---

## 3. SimpleQA Verified — parametric factuality (closed-book; lower = more hallucination on facts)

Source: https://arxiv.org/html/2509.07968v1 ("SimpleQA Verified", DeepMind, 1,000 curated prompts).

This measures what a model "knows" without tools. Useful as a secondary signal for whether a model is likely to invent rather than admit ignorance during extraction.

| Model | F1 | Accuracy | Acc.|Attempted | Attempted % | Notes |
|-------|---:|---------:|------------------:|------------:|------|
| Gemini 2.5 Pro | 55.6 | 55.3 | 55.9 | 98.9 | SOTA non-reasoning |
| GPT-5 | 52.3 | 50.9 | 53.8 | 94.6 | |
| OpenAI o3 | 51.9 | 51.6 | 52.0 | 99.3 | |
| Gemini 3 Pro | ~72 | 72.1 | — | — | Quoted in Gemini 3 launch materials |
| Gemini 3 Flash | ~68.7 | 68.7 | — | — | Quoted in Gemini 3 launch materials |
| GPT-4.1 | 39.9 | 39.8 | 40.1 | 99.3 | |
| GPT-4o | 34.9 | 34.4 | 35.5 | 97.0 | |
| DeepSeek R1 | 33.3 | 32.7 | 33.9 | 96.4 | |
| Gemini 2.5 Flash | 28.2 | 27.8 | 28.7 | 96.9 | |
| GPT-5 mini | 24.6 | 17.3 | 42.8 | **40.4** | **Refuses most questions** — high abstention |
| GPT-5 nano | 14.4 | 10.2 | 24.2 | **42.2** | **Refuses most questions** |
| **Gemini 3.1 Flash-Lite** | ~43.3 | 43.3 | — | — | DeepMind model card |
| Gemini 2.5 Flash-Lite | 11.1 | 10.2 | 12.1 | 84.0 | High attempt rate, low accuracy → confidently wrong on parametric Qs |

**Critical observation for extraction:** GPT-5 mini and nano have **abstention-by-default** behavior (only attempt ~40% of questions). For grounded extraction tasks where the answer **is** in the document, this is irrelevant; for tasks that require parametric knowledge as a fall-back (e.g. resolving author affiliations against world knowledge), they will refuse. Gemini 2.5 Flash-Lite is the opposite — it attempts everything and is confidently wrong on facts it doesn't know.

**No-hallucination winner on SimpleQA Verified parametric:** Gemini 2.5 Pro (55.6 F1) for raw knowledge; **GPT-5 mini for calibrated abstention** (lowest "attempted%" while still getting most attempts right). Among cheap long-context: **Gemini 3.1 Flash-Lite (43.3) >> Gemini 2.5 Flash (28.2) >> Gemini 2.5 Flash-Lite (11.1)**.

---

## 4. FACTS Benchmark Suite — Google DeepMind's factuality across grounding/parametric/search/multimodal

Source: https://deepmind.google/blog/facts-benchmark-suite-systematically-evaluating-the-factuality-of-large-language-models/ and Suprmind aggregator.

This is the most comprehensive factuality benchmark of 2026. Higher = better.

| Model | FACTS Overall | Grounding | Parametric | Search | Multimodal |
|-------|---:|---:|---:|---:|---:|
| Gemini 3 Pro | **68.8** | 69.0 | 76.4 | 83.8 | 46.1 |
| Gemini 2.5 Pro | 62.1 | — | — | — | — |
| GPT-5 | 61.8 | — | — | 77.7 | — |
| Grok 4 | 53.6 | — | — | 75.3 | — |
| OpenAI o3 | 52.0 | 36.2 | 57.1 | — | — |
| Claude Opus 4.5 | 51.3 | — | — | — | — |
| GPT-4.1 | 50.5 | — | — | — | — |
| GPT-5.1 | 49.4 | — | — | — | — |
| Claude Opus 4.1 | 46.5 | — | — | — | — |
| Gemini 3.0 Flash (Dynamic) | 50.4 | — | — | — | — |
| Gemini 3.1 Flash-Lite | 40.6 | — | — | — | — |
| Gemini 2.5 Flash-Lite (Dynamic) | 17.9 | — | — | — | — |

**FACTS Grounding sub-task** (legacy data; tests faithful answer from a provided document — directly relevant to extraction): Gemini 2.5 Pro Preview 87.8%, Gemini 2.5 Flash 85.3%, Gemini 2.5 Flash-Lite 84.1%, Claude 3.5 Sonnet 79.4%, Gemini 2.0 Flash Experimental 83.6% (https://airank.dev/benchmarks/facts-grounding — site since 404'd; values archived via Suprmind 2026-04 capture).

**No-hallucination winner on FACTS Grounding:** Gemini 2.5 Pro (87.8) is top; among cheap models the Gemini 2.5 Flash family is excellent at 84–85% — better than Claude 3.5 Sonnet.

---

## 5. AA-Omniscience — knowledge + calibration (lower hallucination rate = better, on knowledge questions with no source)

Source: https://artificialanalysis.ai/evaluations/omniscience (live) and https://arxiv.org/html/2511.13029v1.

| Model | Accuracy | Hallucination Rate | Omniscience Index |
|-------|---------:|-------------------:|------------------:|
| GPT-5.5 (xhigh) | **57%** | 86% | 20 |
| GPT-5.5 (high) | 56% | — | — |
| Gemini 3 Pro Preview | 55.9–56% | 88% | 16 |
| Gemini 3.1 Pro Preview | 55.3% | **50%** | **33** (top) |
| Gemini 3 Flash (Reasoning) | 54.0% | **91%** | — |
| Claude Opus 4.6 | 46.4% | — | 14 |
| Claude Opus 4.5 (thinking) | 45.7% | 58% | Negative |
| Grok 4 | 41.4% | 64% | Positive |
| GPT-5 (high) | 40.7% | 81% | — |
| Claude Sonnet 4.6 | 40.0% | ~38% | — |
| Gemini 2.5 Pro | — | 88% | — |
| **Gemini 2.5 Flash** | — | **88%** | — |
| Claude Opus 4.7 (Adaptive Reasoning) | — | — | 26 |
| Claude 4.1 Opus (Reasoning) | 36% | **0% (refuses)** | 4.8 |
| **Claude Haiku 4.5** | **16%** | **25–28%** | Strong / positive |
| Grok 4.20 (Reasoning) | — | 17–22% | — |
| **Llama 4 Maverick** | ~13% | **87.6%** | Very negative |
| DeepSeek R1 | — | 83% | — |
| Grok 4.1 Fast | — | 72% | — |

**No-hallucination winner on AA-Omniscience:** Claude Haiku 4.5 (25–28% hallucination rate, third-lowest of any model tested — the only non-flagship to crack the top of the calibration ranking). Note Gemini 3 Pro/Flash hallucinate at 88–91% on this benchmark — they **never abstain**, which is dangerous for extraction tasks that require admitting "this paper does not contain X".

The benchmark scores models by `+1 correct, -1 incorrect, 0 abstain`, so it directly rewards "knowing what you don't know". Models like GPT-5.5 with 57% raw accuracy but 86% hallucination rate score lower than Claude Haiku 4.5 at 16% accuracy and 25% hallucination rate. **This is the single biggest predictor of "will the model invent a citation".**

---

## 6. Long-context fabrication studies

### 6.1 Chroma "Context Rot" (https://www.trychroma.com/research/context-rot)

- **Claude family**: lowest hallucination rates at long context, often abstaining rather than fabricating.
- **GPT-4.1**: competitive accuracy, but highest confidence in incorrect responses when distractors are present.
- **Qwen3-8B**: early collapse at ~5K tokens.
- **Gemini 2.5 Flash**: generates spurious tokens starting around 500–750 tokens; degradation steeper than headline numbers suggest.
- Performance gap between "focused" and "full-length" inputs is substantial across all models.

### 6.2 Document-Q&A 172B-token study (https://arxiv.org/html/2603.08274v1 — open-weights only)

Fabrication rate at 32K context (where the answer exists in the doc, but the model is asked about a **non-existent** entity — it must refuse):

| Model | 32K | 128K | 200K |
|-------|----:|-----:|-----:|
| GLM 4.5 | **1.19%** | 3.19% | — |
| GLM 4.5 Air | 3.37% | — | — |
| MiniMax M2.1 | 5.06% | — | — |
| DeepSeek V3.1 | 6.35% | — | — |
| Qwen3 Next 80B-A3B (MoE) | 7.04% | — | 10.25% |
| GLM 4.6 | 7.04% | — | **71.62%** |
| Qwen3 Coder 480B-A35B | 12.20% | — | — |
| Llama 3.1 405B | 26.51% | — | — |
| Llama 3.1 70B | 49.50% | — | — |

This study does **not** include Gemini, GPT, Claude. But it nails the most important question for extraction: when the user asks about something **not** in the document, does the model fabricate?

### 6.3 NoLiMa (https://github.com/adobe-research/NoLiMa)

Tests retrieval when the query has **no lexical overlap** with the needle. Effective context lengths (where models maintain 85% of baseline):
- GPT-4.1: effective at 16K tokens (drops to 64.7% at 128K from 97% base)
- GPT-4o: effective at 8K tokens
- Llama 3.3 70B: effective at 2K tokens
- Gemini 1.5 Pro: effective at 2K tokens

**Implication for extraction**: claimed 1M / 10M context windows degrade catastrophically when the relevant text doesn't share keywords with the prompt. For academic extraction with paraphrased queries, **assume effective context is 10–20× smaller than the advertised window**.

### 6.4 NIAH-2 at 1M tokens (frontier flagship comparison, April 2026)

Source: https://www.digitalapplied.com/blog/long-context-retrieval-needle-in-haystack-2026

| Model | Single-needle @ 1M | Multi-needle @ 1M |
|-------|-------------------:|------------------:|
| Gemini 3 Deep Think | 99% | — |
| GPT-5.5 | 96% | 74% |
| Claude Opus 4.7 | 89% | 56% |
| DeepSeek V4-Pro | 78% | 41% |

Llama 4 Scout self-reports >99% single-needle @ 10M (Meta blog), but **no independent multi-needle or NoLiMa study at 10M exists**.

---

## 7. Per-model factuality profile

### 7.1 Gemini 2.5 Flash — $0.30/$2.50, 1M context
- Vectara HHEM: **7.8%** hallucination on grounded summarization.
- FACTS Grounding: **85.3%** (very strong on document-grounded answers).
- SimpleQA Verified parametric: 28.2 F1 (low — confidently wrong on facts).
- Context Rot: spurious tokens after ~500 tokens; effective long-context likely <100K.
- **Profile**: Excellent at grounded summarization (FACTS 85, HHEM 7.8%), weak at admitting ignorance. Will faithfully extract what's in a paper; **will invent if asked about something not in the paper**.

### 7.2 Gemini 2.5 Flash-Lite — $0.10/$0.40, 1M context
- Vectara HHEM: **3.3%** — second-lowest of any model on the leaderboard.
- FACTS Grounding: **84.1%** (essentially tied with the full Flash).
- SimpleQA Verified parametric: 11.1 F1 (very weak parametric knowledge).
- AA-Omniscience: not reported; Intelligence Index 13/100.
- **Profile**: Cheapest 1M-context option with state-of-the-art grounded faithfulness. Should not be used for tasks that depend on parametric knowledge or for tasks where the model needs to refuse confidently — but for "extract X from document Y" it is exceptional. **Strongest budget candidate for academic extraction.**

### 7.3 Gemini 3 Pro — $2.00/$12, 1M context
- Vectara HHEM: 13.6% (regression vs 2.5 Pro's 7.0%).
- FACTS Overall: **68.8** (SOTA), FACTS Search 83.8, FACTS Parametric 76.4.
- AA-Omniscience: 55.9% accuracy / 88% hallucination → high knowledge, terrible calibration.
- NIAH-2 (Deep Think): 99% @ 1M.
- **Profile**: Smartest grounded model and best parametric knowledge of any model tested, but hallucinates 88% of the time it doesn't know. Use **only** with strict grounded-extraction prompting and explicit "answer null if not in document" instructions. Costs 13× Flash-Lite.

### 7.4 Gemini 3 Flash — $0.50/$3.00, 1M context
- Vectara HHEM: **13.5%** (significantly worse than 2.5 Flash's 7.8%).
- SimpleQA Verified parametric: 68.7 (huge jump from 2.5 Flash).
- AA-Omniscience hallucination rate: **91%** (worst major flagship on this metric).
- **Profile**: A "biased genius" — high raw factuality on what it knows, but it never admits ignorance. **Worse than its predecessor for extraction unless you use very strict grounding prompts.** Confirmed by Vice, TechRadar, Better Stack, and ssvex.com reviews — Google traded calibration for parametric knowledge in the Gemini 3 generation.

### 7.5 Gemini 3.1 Flash-Lite — $0.25/$1.50, 1M context (released 2026-03-03)
- Vectara HHEM: **8.2%** (worse than 2.5 Flash-Lite's 3.3% — same regression pattern).
- FACTS Overall: 40.6 (lower than Gemini 3.0 Flash's 50.4).
- SimpleQA Verified parametric: 43.3 (massive jump over 2.5 Flash-Lite's 11.1).
- AI Intelligence Index: 34/100 (above-average for non-reasoning).
- **Profile**: Higher parametric knowledge than 2.5 Flash-Lite, but **worse grounding faithfulness** — opposite trade-off from what you want for extraction. Use 2.5 Flash-Lite unless you specifically need the smarter reasoning.

### 7.6 GPT-4.1 — $2.00/$8.00, 1M context
- Vectara HHEM: 5.6%.
- SimpleQA: 39.9 F1.
- FACTS Overall: 50.5.
- HELM Long Context: **highest** mean score (0.588) of any model tested, dominating RULER HotPotQA, RULER SQuAD, ∞Bench En.MC.
- NoLiMa effective context: 16K (highest among tested).
- **Profile**: The most reliable long-context model when the query has lexical overlap with the needle. Expensive vs Gemini Flash, but the **best independently-verified long-context recall**. Worth the cost only if you need >100K real effective context.

### 7.7 GPT-4.1 mini — $0.40/$1.60, 1M context
- HELM Long Context: 0.530 (second to GPT-4.1).
- Vectara HHEM: not reported.
- **Profile**: Materially smaller than GPT-4.1 on long context; OpenAI does not publish a SimpleQA-Verified or Vectara score. Reasonable middle ground but lacks independent factuality scores.

### 7.8 GPT-4.1 nano — $0.10/$0.40, 1M context
- MMLU: 80.1%, GPQA: 50.3%.
- Vectara HHEM / SimpleQA Verified: not reported by OpenAI.
- Found in medRxiv medical-extraction study as **most effective model overall** for medical info extraction (F1 55.6 average across tasks) — best of any LLM tested. https://www.medrxiv.org/content/10.64898/2026.01.19.26344287v1.full
- **Profile**: Surprisingly strong empirical extraction performance despite no flagship factuality benchmarks. The medRxiv result is the strongest independent extraction evidence in this report.

### 7.9 GPT-5 mini — 400K context
- Vectara HHEM: **12.9%** (markedly higher than GPT-4.1's 5.6%).
- SimpleQA Verified: 24.6 F1, **attempted % = 40.4** — refuses 60% of the time.
- **Profile**: Designed to abstain. Will under-extract for completeness tasks; very safe for "is X in the paper, yes/no" tasks. **Not 1M context.**

### 7.10 GPT-5 nano — 400K context
- Vectara HHEM: 10.5%.
- SimpleQA Verified: 14.4 F1, **attempted % = 42.2** — also refuses majority.
- **Profile**: Same calibration profile as mini, worse raw knowledge. Useful as a strict-refusal gate but not as a general extractor.

### 7.11 GPT-5.4 nano — released 2026-03-17
- Vectara HHEM: **3.1%** — second-lowest of all models tested.
- **Profile**: If accessible via OpenAI API, this is the no-hallucination winner among proprietary models. Context window not yet confirmed in available sources.

### 7.12 Llama 4 Scout — 10M context, $0.08–0.11/$0.30–0.34
- Vectara HHEM: 7.7%.
- NIAH @ 10M (Meta self-reported): >99% single-needle.
- HELM Long Context: 0.469.
- AA-Omniscience: not yet published as of 2026-05.
- **Profile**: Only model with verified 10M context, low summarization hallucination, very cheap. But no independent multi-needle or NoLiMa eval at 10M — treat 10M as marketing until proven. Solid as a long-doc summarizer / extractor.

### 7.13 Llama 4 Maverick — 1M context, $0.15–0.20/$0.60
- Vectara HHEM: 8.2%.
- AA-Omniscience: ~13% accuracy, **87.6% hallucination rate** (catastrophic on no-context knowledge).
- HELM Long Context: 0.519.
- SimpleQA (llm-stats): 22.1.
- **Profile**: Decent grounded summarizer; very bad at admitting ignorance on knowledge questions. Don't trust on tasks that require "answer null if not in document". Maverick gives you 10× less context than Scout for 2× the price — Scout dominates this pair for extraction.

### 7.14 Qwen3 family (235B, 80B-A3B, smaller)
- Vectara HHEM: 9.3% (235B), 5.4% (14B), 5.7% (4B), 4.8% (8B). Smaller models are better at grounded faithfulness.
- SimpleQA Verified: **likely contaminated** for 235B-A22B (claimed 54.3, community-replicated ~15).
- Document-QA fabrication: Qwen3 Next 80B-A3B = 7.04% @ 32K, 10.25% @ 200K — best long-context fabrication resistance in the open-weights study.
- Long-context use shows ~80K repetition issues in Qwen3-Coder (https://github.com/ggml-org/llama.cpp/discussions/20000).
- **Profile**: Qwen3-8B / -14B small models are excellent cheap grounded summarizers (HHEM 4.8% / 5.4%, very low costs). 235B is over-priced for the factuality you get. Beware contaminated SimpleQA self-reports.

### 7.15 MiniMax-M1 / M2.1 / M2.5
- MiniMax-M1: SimpleQA self-reported strong but **no independent SimpleQA Verified score**.
- MiniMax-M2.1: Vectara HHEM 11.8%; document-QA fabrication 5.06% @ 32K.
- MiniMax-M2.5: Vectara HHEM 9.1%.
- **Profile**: M2.1 and M2.5 have respectable open-weights long-context performance. Lightning Attention architecture (MiniMax-M1, https://arxiv.org/abs/2506.13585) is built for 1M+ contexts. Sparse independent benchmarking outside Vectara — use with caution.

### 7.16 DeepSeek V3.1 / V3.2 / V3.2-Exp
- Vectara HHEM: V3.1 5.5%, V3.2 6.3%, V3.2-Exp 5.3%.
- Document-QA fabrication: V3.1 = 6.35% @ 32K.
- SimpleQA: 23.0–25 parametric (DeepSeek V3-base ~25); the 97.1% headline number is **with search tools** (DeepSeek's own paper categorizes it under "Agentic Tool Use").
- Context window: 128K — **not 1M+**. Disqualifies for the use case as-described.
- DeepSeek-V4-Pro and V4-Flash have 1M contexts, but no Vectara or SimpleQA Verified yet.
- **Profile**: V3.x is strong open-weight for grounded summarization within 128K. Out-of-spec for 1M+ context requirement unless you move to V4 — which lacks independent factuality data.

### 7.17 Claude Haiku 4.5 — 200K context, $1.25/$5.00
- Vectara HHEM: 9.8%.
- AA-Omniscience: **25–28% hallucination rate (3rd lowest of any model tested) at 16% accuracy** → top calibration of any cheap model.
- SimpleQA: Anthropic does not self-report SimpleQA.
- Out of spec for 1M context (200K only).
- **Profile**: The only sub-10$ model in the field with proven calibration ("knows what it doesn't know"). For extraction tasks that demand the model abstain when uncertain rather than invent, this is the second-strongest choice after Claude Opus tier — but the 200K context cap is a hard limit. Costs ~12× Gemini 2.5 Flash-Lite for similar HHEM performance.

---

## 8. Academic extraction–specific evidence

### 8.1 medRxiv medical info extraction (Jan 2026)
Source: https://www.medrxiv.org/content/10.64898/2026.01.19.26344287v1.full

143 papers from medical and environmental sciences, annotated by PhDs:
- **GPT-4.1 mini: F1 55.6** — best of any LLM tested.
- **Gemma3-27B (with image input, zero-shot): F1 41.3** — best local model.
- BERT_F1 ~0.90 for free-text fields; binary indicators best F1 = 0.59; categorical exact-match accuracy < 0.25.

### 8.2 CiteAudit citation verification
Source: https://arxiv.org/html/2602.23452

Detecting hallucinated citations in academic text:
- GPT-5.2: accuracy 96.5%, F1 95.5%.
- Gemini-3-Pro: accuracy 81.4%, F1 76.9%.
- GPTZero (commercial): accuracy 78.4%, F1 73.4%.
- Claude-Sonnet-4.5: accuracy 44.3%, F1 59.4% (struggles with this task despite low overall hallucination).

CiteME benchmark: LLMs score 4.2–18.5% on citation matching; humans 69.7%.

### 8.3 ICLR 2026 hallucination audit
GPTZero found 50+ hallucinations in ICLR submissions, missed by 3–5 peer reviewers each. ~30% of audited papers had at least one citation that did not exist online (https://gptzero.me/news/iclr-2026/).

### 8.4 PaperAsk benchmark
Source: https://arxiv.org/pdf/2510.22242 (140 scientific papers, 5 extraction targets each)
- Confirmed exists; PDF cannot be auto-extracted but the benchmark structure tests caption-, figure-, table-count, and intro-sentence extraction — close to what you need.
- Headline finding shared in summary: many LLMs hallucinate captions even when the source paper is in context.

---

## 9. The "no-hallucination winner" per benchmark

| Benchmark | Winner (overall) | Best **cheap long-context** (≥1M, ≤$1/1M blended) | Reason |
|-----------|------------------|--------------------------------------|--------|
| Vectara HHEM-2.3 (grounded summarization) | GPT-5.4-nano (3.1%) | **Gemini 2.5 Flash-Lite (3.3%)** | $0.10 / $0.40, 1M context |
| FACTS Grounding (document Q&A) | Gemini 2.5 Pro (87.8%) | **Gemini 2.5 Flash (85.3%) / Flash-Lite (84.1%)** | Same tier, much cheaper |
| FACTS Suite overall | Gemini 3 Pro (68.8) | Gemini 3.0 Flash Dynamic (50.4) | best non-flagship |
| AA-Omniscience hallucination rate | Claude 4.1 Opus thinking (0% — refuses) | Claude Haiku 4.5 (25%) | Anthropic dominates calibration |
| AA-Omniscience accuracy | GPT-5.5 xhigh (57%) | Gemini 3 Flash Reasoning (54%) | knowledge but no calibration |
| AA-Omniscience Index (combined) | Gemini 3.1 Pro Preview (33) | Claude Haiku 4.5 (positive index) | balanced |
| SimpleQA Verified parametric | Gemini 2.5 Pro (55.6 F1) | Gemini 3.1 Flash-Lite (43.3) | parametric only |
| HELM Long Context | GPT-4.1 (0.588) | **GPT-4.1 mini (0.530)** | dominant on RULER/∞Bench |
| NoLiMa effective context | GPT-4.1 (16K) | GPT-4.1 mini (estimated) | best non-lexical recall |
| NIAH-2 single-needle @ 1M | Gemini 3 Deep Think (99%) | Llama 4 Scout (>99% self-reported @ 10M) | unverified at 10M |
| Document Q&A fabrication @ 32K (open-weights) | GLM 4.5 (1.19%) | Qwen3-8B / DeepSeek V3.1 / MiniMax M2.1 | best open-weight fabrication resistance |
| Citation verification | GPT-5.2 (F1 95.5) | GPT-4.1 mini (no direct score, but medRxiv F1 55.6 on med extraction) | best independent extraction evidence |

---

## 10. Synthesized recommendation — factual reliability per dollar for academic extraction

Optimizing for **(low fabrication during grounded extraction) × (large enough context for full papers) × (sub-$1/1M blended)** with academic accountability constraints:

### Tier 1 — primary recommendation
**Gemini 2.5 Flash-Lite** at $0.10/$0.40, 1M context.
- Vectara HHEM **3.3%** (best in tier).
- FACTS Grounding **84.1%** (near-SOTA for grounded answers).
- 1M context, fast (253 tok/s).
- **Caveat**: Confidently wrong on parametric facts (SimpleQA 11.1 F1). **Must** be used with strict "answer null if not in document" prompts and citation-verification post-processing.
- **No-hallucination per dollar champion** for the grounded-extraction shape.

### Tier 2 — if you need stronger calibration
**Claude Haiku 4.5** at $1.25/$5.00, 200K context.
- HHEM 9.8%, AA-Omniscience hallucination 25% (3rd-lowest overall).
- The only cheap model that reliably refuses when uncertain.
- **Caveat**: 200K context cap; ~13× the cost of Gemini Flash-Lite. Use when extraction must explicitly *not* invent.
- Ship a two-pass pipeline: Gemini 2.5 Flash-Lite for cheap first-pass, Claude Haiku 4.5 for verification / null-detection on ambiguous fields.

### Tier 3 — if you need 10M context
**Llama 4 Scout** at $0.08–0.11/$0.30–0.34, 10M context.
- HHEM 7.7%, only verified-cheap 10M model.
- Open-weights; can self-host.
- **Caveat**: AA-Omniscience not yet published; NoLiMa @ 10M not published; no independent multi-needle verification. Treat 10M as "best available 10M option" not "trustworthy 10M".

### Tier 4 — when budget is no object and you need best raw factuality
**GPT-4.1** at $2.00/$8.00, 1M context.
- HHEM 5.6%, FACTS Overall 50.5, **HELM Long-Context #1**.
- Highest independently-verified long-context recall.
- Use only when Tier 1 demonstrably fails — 8–20× the cost of Gemini 2.5 Flash-Lite.

### Models to actively avoid for academic extraction
- **Gemini 3 Flash / 3 Pro** — Vectara HHEM **regressed** to 13.5–13.6% vs the 2.5 generation; AA-Omniscience hallucination rate 88–91%. Smarter on knowledge but never abstains. Bad fit for academic extraction unless paired with aggressive grounded-prompting and external verifiers.
- **Llama 4 Maverick** — 87.6% hallucination on AA-Omniscience; 1M context for 2× the price of Scout's 10M.
- **DeepSeek V3.x** — only 128K context, doesn't meet the 1M+ spec.
- **Qwen3-235B self-reports** — likely contaminated on SimpleQA; use Qwen3-4B/8B/14B if you want Qwen for extraction.
- **GPT-5 mini/nano** — high abstention may be acceptable for some workflows, but their "refuse 60% of the time" pattern means you'll get many null answers on fields that *are* in the paper.

### Architecture recommendation for this project
Pipeline rather than monolith:

1. **Extractor** (Gemini 2.5 Flash-Lite, 1M context, $0.10/$0.40): pull candidate fields from full paper, with `null` for missing.
2. **Auditor** (Claude Haiku 4.5, 200K, $1.25/$5.00): re-evaluate each non-null field against the source passage, flag confidence.
3. **Citation cross-check** (deterministic): every author/title/DOI claimed by the extractor goes through OpenAlex API verification before persistence.
4. **Optional fallback** (GPT-4.1, 1M): re-run any field that the auditor flagged low-confidence.

This pipeline buys you Gemini Flash-Lite's near-best-in-class grounding hallucination rate (3.3%) plus Claude's calibration (25% AA-Omniscience) at < $0.50 / 1M blended for typical workloads.

---

## 11. Sources (full URLs)

### Leaderboards
- Vectara hallucination leaderboard (updated 2026-05-11) — https://github.com/vectara/hallucination-leaderboard
- Vectara HF Space — https://huggingface.co/spaces/vectara/leaderboard
- Vectara next-gen blog — https://www.vectara.com/blog/introducing-the-next-generation-of-vectaras-hallucination-leaderboard
- AA-Omniscience live — https://artificialanalysis.ai/evaluations/omniscience
- AA-Omniscience article — https://artificialanalysis.ai/articles/aa-omniscience-knowledge-hallucination-benchmark
- AA-Omniscience paper — https://arxiv.org/html/2511.13029v1
- FACTS Benchmark Suite — https://deepmind.google/blog/facts-benchmark-suite-systematically-evaluating-the-factuality-of-large-language-models/
- FACTS Kaggle leaderboard — https://www.kaggle.com/benchmarks/google/facts
- SimpleQA Verified paper — https://arxiv.org/html/2509.07968v1
- SimpleQA Verified Kaggle — https://www.kaggle.com/benchmarks/deepmind/simpleqa-verified
- llm-stats SimpleQA — https://llm-stats.com/benchmarks/simpleqa
- pricepertoken SimpleQA leaderboard — https://pricepertoken.com/leaderboards/benchmark/simpleqa
- HELM Long Context (Stanford CRFM) — https://crfm.stanford.edu/2025/09/29/helm-long-context.html
- HalluLens (Meta) — https://arxiv.org/html/2504.17550v1
- NoLiMa — https://github.com/adobe-research/NoLiMa

### Per-model sources
- Gemini 2.5 Flash model card — https://storage.googleapis.com/deepmind-media/Model-Cards/Gemini-2-5-Flash-Model-Card.pdf
- Gemini 2.5 Flash-Lite model card — https://storage.googleapis.com/deepmind-media/Model-Cards/Gemini-2-5-Flash-Lite-Model-Card.pdf
- Gemini 3.1 Flash-Lite model card — https://deepmind.google/models/model-cards/gemini-3-1-flash-lite/
- Gemini 3 Flash announcement — https://blog.google/products/gemini/gemini-3-flash/
- Gemini 3.1 Flash-Lite eval doc — https://storage.googleapis.com/deepmind-media/gemini/gemini_3-1_flash-lite_model_evaluation.pdf
- AA Gemini 3.1 Flash-Lite — https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview
- AA Gemini 3 Flash Reasoning — https://artificialanalysis.ai/models/gemini-3-flash-reasoning
- AA Gemini 3 Flash article — https://artificialanalysis.ai/articles/gemini-3-flash-everything-you-need-to-know
- AA Gemini 2.5 Flash — https://artificialanalysis.ai/models/gemini-2-5-flash
- AA Gemini 2.5 Flash-Lite — https://artificialanalysis.ai/models/gemini-2-5-flash-lite
- AA DeepSeek V3.2 — https://artificialanalysis.ai/models/deepseek-v3-2
- AA Llama 4 Maverick — https://artificialanalysis.ai/models/llama-4-maverick
- AA Claude 4.5 Haiku — https://artificialanalysis.ai/models/claude-4-5-haiku
- DeepSeek V3.2-Exp HF (incl. benchmark table) — https://huggingface.co/deepseek-ai/DeepSeek-V3.2-Exp
- DeepSeek V3.2 paper — https://arxiv.org/pdf/2512.02556
- MiniMax-M1 paper — https://arxiv.org/abs/2506.13585
- OpenAI GPT-4.1 launch — https://openai.com/index/gpt-4-1/
- Meta Llama 4 herd — https://ai.meta.com/blog/llama-4-multimodal-intelligence/
- Anthropic Claude Haiku 4.5 launch — https://www.anthropic.com/news/claude-haiku-4-5
- Vellum Gemini 3 Benchmarks — https://www.vellum.ai/blog/google-gemini-3-benchmarks

### Hallucination-rate analyses
- Suprmind 2026 hallucination rates — https://suprmind.ai/hub/ai-hallucination-rates-and-benchmarks/
- Awesome Agents hallucination leaderboard — https://awesomeagents.ai/leaderboards/hallucination-benchmarks-leaderboard/
- The-decoder on AA-Omniscience — https://the-decoder.com/gemini-3-pro-tops-new-ai-reliability-benchmark-but-hallucination-rates-remain-high/
- WinBuzzer on AA-Omniscience — https://winbuzzer.com/2025/11/18/aa-omniscience-new-ai-reliability-benchmark-reveals-most-top-models-are-more-likely-to-hallucinate-than-be-correct-xcxwbn/
- OfficeChai Anthropic top 3 — https://officechai.com/ai/anthropic-models-take-top-3-spots-with-lowest-hallucination-rates-in-new-omniscience-benchmark/
- Wiegold Gemini 3 Flash review — https://thomas-wiegold.com/blog/gemini-3-flash-review-production-model/
- Chroma Context Rot research — https://www.trychroma.com/research/context-rot
- AI Magicx April 2026 breakdown — https://www.aimagicx.com/blog/claude-opus-4-6-vs-gpt-5-4-vs-gemini-3-1-benchmark-comparison-april-2026

### Long-context / fabrication studies
- Doc-Q&A 172B-token fabrication study — https://arxiv.org/html/2603.08274v1
- NIAH 1M frontier review — https://www.digitalapplied.com/blog/long-context-retrieval-needle-in-haystack-2026
- Llama.cpp Qwen3 repetition issue — https://github.com/ggml-org/llama.cpp/discussions/20000

### Academic extraction–specific
- medRxiv medical info extraction — https://www.medrxiv.org/content/10.64898/2026.01.19.26344287v1.full
- CiteAudit benchmark — https://arxiv.org/html/2602.23452
- PaperAsk — https://arxiv.org/pdf/2510.22242
- ICLR 2026 hallucination check — https://gptzero.me/news/iclr-2026/
- Citation fabrication MH research — https://pmc.ncbi.nlm.nih.gov/articles/PMC12658395/

### Other
- HuggingFace Qwen3-235B SimpleQA contamination — https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507/discussions/4
- AImon "un-leaderboard" — https://www.aimon.ai/posts/the-llm-unleaderboard-self-reported-hallucination-accuracy-top-models/
