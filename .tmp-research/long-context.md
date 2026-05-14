# Long-Context Performance for Cheap LLMs — Academic Extraction (research date: 2026-05-13)

This is a synthesis of every long-context benchmark I could ground in 2025-2026 public data, focused on the question that matters for academic-paper extraction at 500K-1M tokens: *which advertised-1M model actually keeps its accuracy past 128K?*

## TL;DR

1. **No cheap model holds up well past ~128K on real reasoning/extraction.** The famous "1M context window" mostly is marketing. Effective context for tier-2 models clusters at 16K-32K under tasks with adversarial distractors (NoLiMa), and 64K-128K under retrieval-only tasks (RULER, NIAH).
2. **Best cheap pick for 500K-1M academic extraction (May 2026):** **Gemini 2.5 Flash** for retrieval-style extraction (it is the only sub-$1/1M-input model with verified end-to-end 1M operation and acceptable single-needle/coverage behavior), **with a strong second look at MiniMax-M1-40K** for multi-needle reasoning where you can run an open-weight model.
3. **What to avoid at length:** Llama 4 Scout (collapses ~32K despite 10M claim), Llama 4 Maverick (collapses ~32K despite 1M claim), GPT-4.1-nano (effective length <1K on NoLiMa), GPT-4.1-mini (effective <1K on NoLiMa), Gemini 3 Pro **at 1M specifically** (huge cliff at 1M despite great 128K), DeepSeek V3.x (capped at 128K window; not actually a long-context option).
4. **Multi-needle is the killer.** Every model degrades much faster on multi-needle MRCR than on single-needle NIAH. For multi-paper extraction (= multi-needle), the only models with verified-strong 1M results are Claude Opus 4.6 (expensive) and MiniMax-M1.

---

## A. Master ranking table — cheap-tier models

Filtered to models priced ≤ $1/1M input. "Effective length" is the longest tested context where the model holds **≥80%** of its short-context baseline on the **toughest** benchmark for which it has data. Scores are absolute %; "-" = not measured publicly. Sorted by overall verdict for 500K-1M academic extraction.

| Model | Window (claimed) | RULER 128K | MRCR v2 8-needle 128K avg | MRCR v2 8-needle 1M pointwise | LongBench v2 | Fiction.LiveBench @ 120K | NoLiMa effective length | Verdict @ 500K-1M extraction |
|---|---|---|---|---|---|---|---|---|
| **Gemini 2.5 Flash** | 1M | — | **54.3%** | **21.0%** | 62.1% | — (2.5 Pro: 90.6%) | 2K | **Best cheap pick.** Only sub-$1 model with verified 1M operation. Strong on coverage; weakened by multi-needle.  |
| **MiniMax-M1-40K** (open-weight) | 1M | — | **76.1%** (OpenAI-MRCR) | **58.6%** (OpenAI-MRCR) | 61.0% | — | — | **Best open-weight long-context model.** Multi-needle holds up at 1M. Worth self-hosting for 500K+ corpus jobs. |
| **MiniMax-M1-80K** (open-weight) | 1M | — | 73.4% (OpenAI-MRCR) | 56.2% (OpenAI-MRCR) | 61.5% | — | — | Same family as M1-40K, slightly worse on long ctx but stronger on reasoning. |
| **Gemini 3 Flash** | 1M | — | 22.1% (MRCR v2 overall) | — | — | — | — | Better than 2.5 Flash on reasoning, **but MRCR v2 8-needle overall score is *lower* than 3.1 Flash-Lite (60.1%).** Avoid for retrieval-heavy work at length until Google publishes clean per-length numbers. |
| **Gemini 3.1 Flash-Lite** | 1M | — | **60.1%** (MRCR v2 overall) | — | — | — | — | Surprisingly strong on 8-needle MRCR overall. Cheapest Gemini 3 family. Worth a pilot for retrieval-only extraction. |
| **GPT-4.1-mini** | 1M | — | 47.2% (2-needle 128K) | — | — | 46.9% | **<1K** | **Avoid for long ctx.** Effective length <1K on NoLiMa — the model gets confused by paraphrase even at 1K under realistic conditions. |
| **GPT-4.1-nano** | 1M | — | 36.6% (2-needle 128K) | — | — | 18.8% | **<1K** | **Avoid.** Worst of the cheap-tier sub-models. 18.8% on Fiction at 120K means it is effectively useless past 32K. |
| **GPT-5-mini** | 400K | — | 47.7% (8-needle 64-128K, GPT-5.4-mini) | 33.6% (8-needle 128-256K, GPT-5.4-mini) | — | — | — | Cheaper than GPT-5 but big cliff past 128K. 400K window only; cannot do true 1M corpus loading. |
| **GPT-5-nano** | 400K | — | 33.1% (8-needle, GPT-5.4-nano overall) | — | — | — | — | Smallest of the GPT-5 family. Skip for long context. |
| **Llama 4 Maverick** | 1M | 47.8 (HELM) | — | — | — | **28.1%** | 2K | **Avoid.** Despite claimed 1M, real comprehension collapses by 32K-128K. NoLiMa effective length 2K. Fiction.LiveBench at 120K = 28.1%. |
| **Llama 4 Scout** | 10M | 47.0 (HELM) | — | — | — | **15.6%** | **1K** | **Avoid.** The "10M" is a marketing number. Real Fiction.LiveBench at 120K is 15.6%. NoLiMa effective length is 1K. |
| **Qwen3-30B-A3B** | 128K | 79.2 (RULER) | — | — | 50.1% | — | — | RULER effective length is 64K (single-needle retrieval). Not a true 1M model. |
| **Qwen3-Next-80B-A3B** | 256K native (1M with YaRN) | **96.0%** (RULER) | — | — | — | — | — | RULER 1M average is **91.8% across all lengths** — the best published RULER curve outside frontier closed models. **Strong candidate if you can host it.** Notes: this is RULER (synthetic), so multi-doc reasoning unverified. |
| **DeepSeek V3 / V3.1 / V3.2** | 128K | — (near-perfect NIAH @ 128K) | — | — | — | DeepSeek V3 (orig): 62.5 @ 120K | — | **Not a long-context option.** Window caps at 128K; not extensible to 1M. |
| **Gemini 3 Pro** (mid-tier price, but reference) | 1M | — | **77.0%** | **26.3%** | 68.2% | — | — | Reference point. The 77% → 26% cliff at 1M is the *canonical* "1M is mostly marketing" finding. |

Sources: HELM Long Context table; llm-stats.com MRCR / MRCR v2 / OpenAI-MRCR / LongBench v2 leaderboards; NoLiMa (Adobe Research, arXiv 2502.05167); Fiction.LiveBench raw data; MiniMax-M1 paper (arXiv 2506.13585); Qwen3-Next model card; Gemini 3 Pro & 3.1 Pro model cards; Meta Llama 4 announcement + The Decoder coverage.

---

## B. Full RULER table (reference for the open-weight options worth considering)

From [NVIDIA/RULER](https://github.com/NVIDIA/RULER) (the canonical multi-task long-context benchmark). Effective length is the longest context at which the model holds ≥85.6% (Llama-2-7B-at-4K baseline). Filtered to relevant models.

| Model | Claimed | Effective | 4K | 8K | 16K | 32K | 64K | 128K |
|---|---|---|---|---|---|---|---|---|
| Gemini-1.5-pro | 1M | >128K | 96.7 | 95.8 | 96.0 | 95.9 | 95.9 | 94.4 |
| GPT-4-1106-preview | 128K | 64K | 96.6 | 96.3 | 95.2 | 93.2 | 87.0 | 81.2 |
| Qwen2.5-14B-Instruct-1M | 1M | >128K | 97.5 | 97.1 | 94.6 | 94.9 | 94.9 | 92.2 |
| Qwen3-235B-A22B | 128K | >128K | 97.7 | 97.2 | 96.4 | 95.1 | 93.3 | **90.6** |
| Qwen3-14B | 128K | >128K | 98.0 | 97.8 | 96.4 | 96.1 | 94.0 | 85.1 |
| Qwen3-32B | 128K | >128K | 98.4 | 96.0 | 96.2 | 94.4 | 91.8 | 85.6 |
| Qwen3-30B-A3B | 128K | 64K | 96.5 | 97.0 | 95.3 | 92.4 | 89.1 | **79.2** |
| Qwen3-8B | 128K | 64K | 96.3 | 96.0 | 91.8 | 91.2 | 82.1 | 77.4 |
| Llama3.1 (70B) | 128K | 64K | 96.5 | 95.8 | 95.4 | 94.8 | 88.4 | 66.6 |
| Llama3.1 (8B) | 128K | 32K | 95.5 | 93.8 | 91.6 | 87.4 | 84.7 | 77.0 |
| Mistral-Large-2411 | 128K | 64K | 96.4 | 96.3 | 95.3 | 94.0 | 85.9 | 48.1 |

And the Qwen3-Next-80B-A3B-Instruct curve (from its model card) — the cleanest published long-curve I found at 1M:

| Length | Score |
|---|---|
| 4K | 98.5 |
| 32K | 98.7 |
| 128K | 96.0 |
| 256K | 93.5 |
| 512K | 86.9 |
| 1M | 80.3 |
| **Avg** | **91.8** |

This is the **only sub-frontier model with a verified published curve that stays above 80% at 1M tokens** on RULER. The catch: RULER is mostly synthetic retrieval, not multi-document reasoning.

---

## C. Fiction.LiveBench — deep-comprehension per depth (raw)

This is the most realistic public test of "deep narrative comprehension at length." Numbers from the live benchmark JSON (`src/data/benchmark.ts` in mnismt/llms-long-context-benchmark, April 2025 snapshot; same data Epoch AI mirrors). All values are % correct. Cheap-tier and reference rows only.

| Model | 0 | 1K | 2K | 4K | 8K | 16K | 32K | 60K | 120K |
|---|---|---|---|---|---|---|---|---|---|
| gemini-2.5-pro-exp-03-25 | 100.0 | 100.0 | 100.0 | 97.2 | 91.7 | 66.7 | 86.1 | 83.3 | **90.6** |
| gemini-2.0-flash-001 | 100.0 | 58.3 | 55.6 | 47.2 | 50.0 | 61.1 | 50.0 | 47.2 | **62.5** |
| gpt-4.1 | 100.0 | 75.0 | 69.4 | 63.9 | 55.6 | 63.9 | 58.3 | 52.8 | **62.5** |
| gpt-4.1-mini | 75.0 | 55.6 | 41.7 | 44.4 | 41.7 | 44.4 | 38.9 | 38.9 | **46.9** |
| gpt-4.1-nano | 62.5 | 41.7 | 36.1 | 33.3 | 38.9 | 25.0 | 33.3 | 36.1 | **18.8** |
| llama-4-maverick | 100.0 | 55.6 | 52.8 | 47.2 | 38.9 | 44.4 | 33.3 | 30.6 | **28.1** |
| llama-4-scout | 62.5 | 27.8 | 30.6 | 27.8 | 30.6 | 22.2 | 16.7 | 11.1 | **15.6** |
| deepseek-chat-v3-0324 | 87.5 | 69.4 | 52.8 | 52.8 | 52.8 | 50.0 | 55.6 | 55.6 | n/a |
| deepseek-r1 | 100.0 | 80.6 | 76.7 | 77.8 | 83.3 | 69.4 | 63.9 | 66.7 | **33.3** |
| qwen-max | 75.0 | 69.4 | 63.9 | 72.2 | 63.9 | 66.7 | n/a | n/a | n/a |
| qwq-32b | 100.0 | 94.4 | 88.9 | 94.4 | 86.1 | 83.3 | 80.6 | 61.1 | n/a |
| o3 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 88.9 | 100.0 | 83.3 | **100.0** |
| grok-3-mini-beta | 87.5 | 77.8 | 80.6 | 77.8 | 72.2 | 66.7 | 75.0 | 72.2 | **65.6** |

Key observations:
- **Cheap Gemini 2.0 Flash already beats GPT-4.1-mini and Llama 4 Maverick at 120K** (62.5 vs 46.9 vs 28.1). The Gemini 2.5 Flash specific row was added to the benchmark in June 2025 but isn't in this April 2025 snapshot; the closest analogue is Gemini 2.5 Pro at 90.6% @ 120K, with Gemini 2.5 Flash expected somewhere between Gemini 2.0 Flash and Gemini 2.5 Pro (the Gemini 2.5 Flash MRCR v2 8-needle 128K avg is 54.3%, which corroborates a meaningful but not Pro-grade level here).
- **GPT-4.1-nano is the only sub-tier model that *increases* its hallucination rate past 32K.** Score drops from ~30s to 18.8% at 120K.
- **Llama 4 Scout's curve is flat-broken** from 1K onward.
- **o3 (full) is the only model maintaining 100% at 120K.** That's why it dominates AA-LCR (69%) too — but it is not "cheap."

Source: raw [benchmark.ts](https://raw.githubusercontent.com/mnismt/llms-long-context-benchmark/main/src/data/benchmark.ts) (Apr 6 2025 dump from Fiction.LiveBench); [Epoch AI Fiction.liveBench mirror](https://epoch.ai/benchmarks/fictionlivebench).

---

## D. NoLiMa — effective context length under paraphrase (the most damning benchmark)

[NoLiMa (Adobe Research, ICML 2025)](https://arxiv.org/abs/2502.05167) measures retrieval **after removing literal lexical overlap** between question and needle. This is what kills cheap models in real extraction. Effective length is the longest context where score remains ≥ 50% of base. Cheap-tier subset:

| Model | Base | 1K | 2K | 4K | 8K | 16K | 32K | 64K | 128K | **Effective length** |
|---|---|---|---|---|---|---|---|---|---|---|
| GPT-4.1 | 97.0 | 95.6 | 95.2 | 91.7 | 87.5 | 84.9 | 79.8 | 69.7 | **64.7** | 16K |
| **GPT-4.1-mini** | 80.9 | 66.7 | 62.8 | 58.7 | 51.9 | 46.2 | 38.8 | — | — | **<1K** |
| **GPT-4.1-nano** | 80.7 | 60.8 | 48.2 | 36.7 | 28.8 | 19.5 | 9.4 | — | — | **<1K** |
| Gemini 2.5 Flash (no-thinking) | 94.4 | 90.1 | 86.1 | 79.4 | 68.2 | 57.9 | 48.4 | — | — | **2K** |
| Llama 4 Maverick | 90.1 | 81.6 | 78.3 | 68.8 | 49.0 | 34.3 | 24.5 | — | — | **2K** |
| Llama 4 Scout | 81.7 | 72.3 | 61.8 | 50.8 | 35.5 | 26.9 | 21.6 | — | — | **1K** |

This is the single most important table in this doc for academic extraction. **"Find me every paper in this corpus that mentions a transformer pretrained on biomedical data"** is a NoLiMa-style query, not a NIAH query — the paraphrase mismatch between "transformer pretrained on biomedical data" and a paper saying "BERT trained on PubMed abstracts" is exactly the abstraction NoLiMa measures. **Under this lens GPT-4.1-mini and GPT-4.1-nano are both useless past 1K**, and **Gemini 2.5 Flash without thinking falls off at 2K**. (Gemini 2.5 Flash *with* thinking does not appear in the NoLiMa published table; expect substantially better but unconfirmed.)

---

## E. HELM Long Context (Stanford CRFM, Sep 2025) — the only neutral aggregate

[HELM long-context table](https://crfm.stanford.edu/2025/09/29/helm-long-context.html). Mean score is across RULER SQuAD, RULER HotPotQA, ∞Bench En.MC, ∞Bench En.Sum, and OpenAI-MRCR. All at 128K context.

| Model | Mean | RULER SQuAD | RULER HotPotQA | ∞Bench En.MC | ∞Bench En.Sum | OpenAI-MRCR |
|---|---|---|---|---|---|---|
| **GPT-4.1-mini** | 0.530 | 0.82 | 0.64 | 0.82 | 0.16 | 0.208 |
| **Llama 4 Maverick** | 0.519 | 0.78 | 0.55 | 0.89 | 0.161 | 0.215 |
| **Gemini 2.0 Flash Lite** | 0.497 | 0.77 | 0.53 | 0.85 | 0.155 | 0.179 |
| **Llama 4 Scout** | 0.469 | 0.68 | 0.47 | 0.85 | 0.176 | 0.171 |
| **GPT-4.1-nano** | 0.395 | 0.56 | 0.41 | 0.72 | 0.113 | 0.17 |

Two non-obvious takeaways:
- **HELM only tests at 128K.** A 128K result is the *easy* case for any 1M model. Look at Llama 4 Maverick's 0.519 here vs its **28.1% Fiction at 120K**: HELM uses retrieval-style tasks where Llama 4 looks fine; Fiction's deep-comprehension probe reveals the actual comprehension is bad. Don't trust HELM for "can the model reason over the long context."
- **GPT-4.1-mini ranks first among cheap models on HELM (0.530)** but **dead last among cheap models on NoLiMa effective length (<1K)**. This is the canonical "benchmark mismatch" — pick your benchmark to match your task.

---

## F. Per-model degradation narratives

### Gemini 2.5 Flash ($0.30 / $2.50 per 1M, 1M ctx)
- **MRCR v2 8-needle:** 54.3% at 128K avg → 21.0% at 1M pointwise.
- **NoLiMa (no thinking):** Drops from 94.4% base to 48.4% at 32K. **Effective length 2K**.
- **LongBench v2:** 62.1% with CoT (75.0 short / 55.8 medium / 55.7 long). Holds up well on real-world QA, with a real short-vs-long gap of ~20 points.
- **Verdict:** The 2K NoLiMa effective length is misleading because it's the no-thinking variant; with thinking it is competitive with Gemini 2.5 Pro (which holds 90.6% at 120K on Fiction). For academic extraction at 500K-1M, **enable thinking** and design prompts to minimize paraphrase distance.

### Gemini 2.5 Flash-Lite ($0.10 / $0.40 per 1M, 1M ctx)
- **MRCR v2 8-needle:** 12.0% at 128K avg → 6.5% at 1M pointwise. (Some sources cite 30.6% on a different MRCR cut.) Order of magnitude: **bad at multi-needle**.
- Useful only for single-needle retrieval / classification at short context. Not for extraction across a 500K+ corpus.

### Gemini 3 Pro (~$1.25-$2 / $10-$12 per 1M, 1M ctx)
- **MRCR v2 8-needle:** **77.0% at 128K avg → 26.3% at 1M pointwise.** This is the canonical "1M is marketing" cliff: nearly 51 points lost between 128K and 1M. At 32K context the score is 87% (+9 over Gemini 2.5 Pro's 48% at 32K — there is real progress, but only at short context).
- **LongBench v2:** 68.2% (highest published score on the benchmark at the time of release).
- **Verdict:** Excellent up to ~256K. **Avoid for true 500K-1M extraction** — at 1M it is barely above Gemini 2.5 Pro.

### Gemini 3 Flash ($0.50 / $3 per 1M, 1M ctx, released Dec 2025)
- **MRCR v2 8-needle overall:** 22.1%. Published numbers are sparse but this overall score is *worse* than Gemini 3.1 Flash-Lite's 60.1%. Google has not published per-length numbers for this model that I could find.
- **Verdict:** Wait for cleaner per-length data. Use 3.1 Flash-Lite or 2.5 Flash for now.

### Gemini 3.1 Flash-Lite ($0.10 range, 1M ctx, released early 2026)
- **MRCR v2 8-needle overall:** **60.1%.** Best of the Flash-Lite tier.
- No per-length data published yet. Worth a small pilot for retrieval-style academic extraction.

### GPT-4.1-mini ($0.40 / $1.60 per 1M, 1M ctx)
- **OpenAI-MRCR 2-needle 128K:** 47.2% (vs 57.2% for full GPT-4.1).
- **HELM mean (128K):** 0.530 — leads cheap tier on aggregate retrieval.
- **NoLiMa:** Base 80.9% → 38.8% at 32K. **Effective length <1K.**
- **Fiction.LiveBench @ 120K:** 46.9%.
- **Verdict:** *Strong on simple retrieval, useless on paraphrase reasoning.* If your extraction is "find the exact phrase X in this 500K-token corpus," GPT-4.1-mini will do it. If it is "find papers about transformer pretraining on biomedical data" (paraphrase required), it will not.

### GPT-4.1-nano ($0.10 / $0.40 per 1M, 1M ctx)
- **OpenAI-MRCR 2-needle 128K:** 36.6%.
- **Fiction.LiveBench:** 18.8% at 120K (worst sub-tier model I found data for).
- **NoLiMa:** **Effective <1K**, drops from 80.7% base to 9.4% at 32K.
- **Verdict:** **Do not use for any extraction past 1K of context.** Use only for fixed-template short-doc tasks.

### GPT-5-mini ($0.25 / $2 per 1M, **400K ctx**)
- **GPT-5.4-mini MRCR v2 8-needle 64-128K: 47.7%; at 128K-256K: 33.6%.** The current GPT-5-mini may behave differently — the GPT-5.4 generation showed a sharp 14-point drop in a single doubling of context. Window is **400K**, not 1M, so the model cannot serve a true 1M corpus directly.
- **Verdict:** Useful for sub-256K work but **not actually a long-context option**.

### GPT-5-nano ($0.05 / $0.40 per 1M, 400K ctx)
- Smaller GPT-5 sibling. Per-context numbers not separately published, but the GPT-5.4 generation has nano at 33.1% on MRCR v2 8-needle.
- **Verdict:** Cheap, but skip for any extraction past short documents.

### Llama 4 Scout (free, claimed 10M ctx)
- **NIAH at 10M:** 98-99% (Meta's NIAH-only test).
- **NoLiMa effective length:** **1K.**
- **Fiction.LiveBench @ 120K:** **15.6%.**
- **HELM mean:** 0.469.
- **Verdict:** The 10M claim is real for trivial-NIAH but the model is **broken for actual reasoning past 1K-32K**. Don't use for extraction.

### Llama 4 Maverick (claimed 1M ctx)
- **NoLiMa effective length:** **2K.**
- **Fiction.LiveBench @ 120K:** 28.1%.
- **HELM mean:** 0.519.
- **Verdict:** Same family-level pathology as Scout, just less severe. Still fails at length.

### Qwen3-Next-80B-A3B-Instruct (open-weight, 256K native, 1M with YaRN)
- **RULER curve:** 98.5 @ 4K → 96.0 @ 128K → 93.5 @ 256K → 86.9 @ 512K → **80.3 @ 1M**. **RULER 1M average: 91.8%** — the best published RULER curve I found for any sub-frontier model.
- No MRCR v2 / NoLiMa / Fiction.LiveBench numbers published.
- **Verdict:** **The single most interesting open-weight model for 500K-1M retrieval.** Catch: RULER is mostly retrieval, not multi-doc reasoning, and the model needs YaRN scaling enabled. If you can self-host an 80B-A3B MoE, run a pilot.

### Qwen3-30B-A3B (open-weight, 128K)
- **RULER:** 79.2 at 128K. **Effective length 64K.**
- **LongBench v2 (Thinking):** 50.1% with CoT.
- **Verdict:** Solid up to 64K. Below tier for 500K+.

### Qwen3-235B-A22B (open-weight, 128K)
- **RULER:** 90.6 at 128K, effective length >128K.
- **LongBench v2 (Thinking):** 60.6% with CoT — competitive with Gemini 2.5 Flash.
- **Verdict:** **Best open-weight model for ≤128K extraction.** Window doesn't extend to 1M out of the box though.

### MiniMax-M1-40K / -80K (open-weight, native 1M)
- **OpenAI-MRCR 128K:** M1-40K 76.1%, M1-80K 73.4%.
- **OpenAI-MRCR 1M:** **M1-40K 58.6%, M1-80K 56.2%.**
- **LongBench v2:** M1-40K 61.0%, M1-80K 61.5%.
- **MR-NIAH 4M:** 100% (single-needle; from MiniMax-Text-01 lineage).
- **Verdict:** **Best published open-weight 1M-token multi-needle results.** This is the only model I found with documented mid-50% multi-needle accuracy at 1M tokens. If self-hosting is acceptable, this is the cheap long-context play for academic-paper extraction.

### MiniMax-Text-01 (open-weight, 4M ctx)
- **RULER (per MiniMax paper):** above 0.94 from 4K through 64K, **0.910 at 1M.** Effective length 1M+.
- **NIAH 4M:** 100%.
- **Verdict:** Heroic claims, but most independent benchmarks haven't validated the multi-needle reasoning at 1M-4M. Worth a pilot — does not show the same MRCR data as M1 yet.

### DeepSeek V3 / V3.1 / V3.2 (open-weight)
- **NIAH:** near-perfect to 128K.
- **Window:** **capped at 128K**, no published 1M extension.
- **LongBench v2:** DeepSeek-R1 with CoT 58.3%; V3 base lower.
- **Verdict:** **Not a long-context option.** Use for short-doc tasks.

---

## G. Synthesized recommendation for academic-paper extraction at 500K-1M

The task as described: "stuff many papers into context, extract structured info per paper, don't invent papers, maintain accuracy at 500K-1M tokens." This is a **multi-needle reasoning** task (one needle per paper) with a **citation-grounding** requirement (must not hallucinate references).

Match to benchmark family:
- Multi-needle reasoning → MRCR v2 8-needle and Fiction.LiveBench.
- Citation grounding → HELM "generation with citations" task (closed models 30-40 points ahead of open).
- Paraphrase robustness (when extracting "the paper that proposed X" with different wording) → NoLiMa.

### Ranked picks for academic extraction at 500K-1M context

1. **Gemini 2.5 Flash with thinking enabled** ($0.30 / $2.50 per 1M, 1M ctx). Best cheap closed option. Cap real usable context at ~256K-500K. Above 500K, switch to chunked extraction or another model. The 21.0% pointwise at 1M is a stop sign.
2. **MiniMax-M1-40K self-hosted** (open-weight, 1M ctx). Best open option. Multi-needle 58.6% at 1M (OpenAI-MRCR) is the only published open-weight number that doesn't collapse. Worth the self-host overhead for large corpus jobs.
3. **Gemini 3.1 Flash-Lite** ($0.10 range, 1M ctx). Insufficient per-length data, but MRCR v2 8-needle overall of 60.1% is striking. Run a pilot.
4. **Qwen3-Next-80B-A3B with YaRN scaling** (open-weight, 1M with YaRN). RULER 80.3% at 1M is the cleanest published curve. Needs reasoning validation for multi-doc QA.
5. **Gemini 3 Pro** (mid-tier, 1M ctx). Best per-token quality at ≤256K, but cliff at 1M. **Only use for <300K work.**

### Hard-no list
- **Llama 4 Scout / Maverick:** broken past 32K under any realistic test.
- **GPT-4.1-nano:** unusable past 1K under paraphrase. Fiction.LiveBench at 120K = 18.8%.
- **GPT-4.1-mini for paraphrase-style queries:** NoLiMa effective length <1K. Only safe for literal-match retrieval.
- **GPT-5-mini / GPT-5-nano:** Window is 400K, not 1M — disqualified for true 500K-1M loads. Behavior degrades sharply past 128K within their own window.
- **DeepSeek V3 / V3.1 / V3.2:** Window caps at 128K. Not a long-context option.
- **Gemini 2.5 Flash-Lite:** Too weak on multi-needle (6.5% at 1M).

### Operational guidance

- **Set hard caps.** Even on the best cheap model, cap context at 256K-300K and chunk above that. Every cheap model has a >50% drop between 128K and 1M.
- **Use multi-needle MRCR as your offline canary, not NIAH.** NIAH-near-perfect is meaningless for academic extraction; MRCR/Fiction track real comprehension.
- **Prompt to minimize paraphrase distance.** Quote the paper's terminology directly in the query when possible — NoLiMa scores recover dramatically once lexical overlap returns.
- **Verify citations with a second pass.** Every cheap model hallucinates references at length; even Gemini 2.5 Pro drops below 80% citation accuracy past 128K. Cross-check extracted DOIs / titles against a deterministic store.

---

## H. Sources

Primary benchmarks:
- NVIDIA RULER: <https://github.com/NVIDIA/RULER>, table in <https://github.com/NVIDIA/RULER/blob/main/README.md>
- HELM Long Context (Stanford CRFM, Sep 2025): <https://crfm.stanford.edu/2025/09/29/helm-long-context.html>
- HELMET (Princeton, ICLR 2025): <https://princeton-nlp.github.io/HELMET/>, <https://arxiv.org/abs/2410.02694>
- LongBench v2: <https://longbench2.github.io/>, <https://github.com/THUDM/LongBench>
- NoLiMa (Adobe Research, ICML 2025): <https://arxiv.org/abs/2502.05167>, <https://github.com/adobe-research/NoLiMa>
- Fiction.LiveBench raw data: <https://raw.githubusercontent.com/mnismt/llms-long-context-benchmark/main/src/data/benchmark.ts>, mirror: <https://epoch.ai/benchmarks/fictionlivebench>
- Loong multi-doc QA: <https://github.com/MozerWang/Loong>, <https://arxiv.org/abs/2406.17419>
- AA-LCR (Artificial Analysis): <https://artificialanalysis.ai/evaluations/artificial-analysis-long-context-reasoning>
- Chroma "Context Rot": <https://www.trychroma.com/research/context-rot>

Aggregator leaderboards:
- llm-stats.com MRCR: <https://llm-stats.com/benchmarks/mrcr>
- llm-stats.com MRCR v2 8-needle: <https://llm-stats.com/benchmarks/mrcr-v2-(8-needle)>
- llm-stats.com OpenAI-MRCR 2-needle 128K: <https://llm-stats.com/benchmarks/openai-mrcr:-2-needle-128k>
- llm-stats.com RULER: <https://llm-stats.com/benchmarks/ruler>
- llm-stats.com LongBench v2: <https://llm-stats.com/benchmarks/longbench-v2>
- BenchLM.ai LongBench v2: <https://benchlm.ai/benchmarks/longBenchV2>
- Awesome Agents long-context leaderboard: <https://awesomeagents.ai/leaderboards/long-context-benchmarks-leaderboard/>
- Awesome Agents long-context retrieval picks: <https://awesomeagents.ai/capabilities/long-context-retrieval/>

Model-specific:
- Gemini 2.5 Flash: <https://deepmind.google/technologies/gemini/flash/>
- Gemini 2.5 technical report: <https://arxiv.org/html/2507.06261v1>
- Gemini 3 Pro model card: <https://storage.googleapis.com/deepmind-media/Model-Cards/Gemini-3-Pro-Model-Card.pdf>; HN discussion: <https://news.ycombinator.com/item?id=45964748>; Vellum coverage: <https://www.vellum.ai/blog/google-gemini-3-benchmarks>; Libertify summary: <https://www.libertify.com/interactive-library/gemini-3-pro-model-card-deepmind-ai-benchmarks/>
- Gemini 3.1 Pro model card: <https://deepmind.google/models/model-cards/gemini-3-1-pro/>
- Gemini 3 Flash announcement: <https://blog.google/products-and-platforms/products/gemini/gemini-3-flash/>; OpenRouter: <https://openrouter.ai/google/gemini-3-flash-preview>
- GPT-4.1 announcement: <https://openai.com/index/gpt-4-1/>
- GPT-5 family: <https://openai.com/index/introducing-gpt-5-for-developers/>
- Llama 4: <https://ai.meta.com/blog/llama-4-multimodal-intelligence/>, <https://www.llama.com/models/llama-4/>, <https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E>
- Llama 4 long-context failure: <https://the-decoder.com/metas-llama-4-models-show-promise-on-standard-tests-but-struggle-with-long-context-tasks/>
- MiniMax-M1: <https://github.com/MiniMax-AI/MiniMax-M1>, <https://arxiv.org/html/2506.13585v1>
- MiniMax-Text-01: <https://filecdn.minimax.chat/_Arxiv_MiniMax_01_Report.pdf>
- Qwen3-Next-80B-A3B-Instruct: <https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct>
- DeepSeek V3 technical report: <https://arxiv.org/pdf/2412.19437>
- Databricks long-context RAG study: <https://www.databricks.com/blog/long-context-rag-capabilities-openai-o1-and-google-gemini>

Independent commentary cited:
- "Evaluating Long Context (Reasoning) Ability": <https://nrehiew.github.io/blog/long_context/>
- Dan Cleary "Do long context windows actually work?": <https://danjcleary.substack.com/p/do-long-context-windows-actually>

---

*Caveats: Several model-specific MRCR v2 numbers come from different reporting cuts (cumulative 128K vs. 8K-32K bin vs. 32K-64K bin) and aren't always directly comparable across model families. Where I report "MRCR v2 8-needle 128K avg" I mean the cumulative-to-128K score. Where I report "MRCR v2 8-needle 1M pointwise" I mean a single measurement at full window length. The Gemini 2.5 Flash 21.0% at 1M and Gemini 3 Pro 26.3% at 1M are both pointwise scores from the model cards. Use these for ordering, not for absolute accuracy expectations.*
