# Cheap LLMs with 1M+ Context Windows — Artificial Analysis Research

**Research date:** 2026-05-13
**Source primary:** [artificialanalysis.ai](https://artificialanalysis.ai/) leaderboards and per-model pages
**Filter:** context window >= 1,000,000 tokens, input <= ~$1/M, output <= ~$4/M, API-available

---

## TL;DR Ranking — Cheap 1M+ Context Models (cheapest blended first)

The Artificial Analysis "Intelligence Index" (v4.0) is a composite of 10 evals: GDPval-AA, τ²-Bench Telecom, Terminal-Bench Hard, SciCode, AA-LCR, AA-Omniscience, IFBench, Humanity's Last Exam, GPQA Diamond, CritPt. Median across all currently-ranked models is ~21 (non-reasoning) / ~30 (reasoning).

| Rank | Model | Provider | Ctx | Input $/M | Output $/M | Blended (3:1) | AA Intelligence | Speed t/s | TTFT s | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Nemotron 3 Nano 30B A3B** (Non-reasoning) | NVIDIA | 1.0M | $0.05 | $0.20 | **$0.09** | 13 | 94.5 | 0.43 | Open weights, MoE 31.6B/3.6B active |
| 2 | **Gemini 2.5 Flash-Lite** (Non-reasoning) | Google | 1.0M | $0.10 | $0.40 | **$0.18** | 13 | 253.2 | 1.22 | Lowest-cost frontier-vendor option |
| 2 | **Gemini 2.5 Flash-Lite (Sep '25)** | Google | 1.0M | n/a | n/a | **$0.18** | 22 (reasoning) / 19 (non) | n/a | n/a | Refresh of Flash-Lite |
| 2 | **GPT-4.1 nano** | OpenAI | 1.0M | $0.10 | $0.40 | **$0.18** | 13 | 113.1 | 0.71 | 75% cache discount |
| 2 | **DeepSeek V4 Flash (Reasoning, Max effort)** | DeepSeek | 1.0M | $0.14 | $0.28 | **$0.18** | **47** | 70.2 | 1.21 | Open weights MIT, 284B/13B MoE — *best intelligence-per-dollar in the table* |
| 2 | **DeepSeek V4 Flash (Reasoning, High effort)** | DeepSeek | 1.0M | $0.14 | $0.28 | **$0.18** | 45 | 67–68 | 1.15–1.32 | Same model, lower thinking budget |
| 7 | **Grok 4.1 Fast** (Non-reasoning) | xAI | 2.0M | $0.20 | $0.50 | **$0.28** | 24 | 89.1 | 0.64 | **2M context** |
| 7 | **Grok 4.1 Fast (Reasoning)** | xAI | 2.0M | $0.20 | $0.50 | **$0.28** | 39 | 97.5 | 10.55 | **2M context** |
| 9 | **Llama 4 Scout** | Meta | **10M** | $0.17 | $0.66 | **$0.29** | 14 | 143.8 | 0.91 | Open weights, **10M context**, MoE 109B/17B |
| 10 | **Grok 3 mini Reasoning (high)** | xAI | 1.0M | $0.30 | $0.50 | **$0.35** | 32 | 163.5 | 0.64 | Feb 2025 |
| 11 | **Llama 4 Maverick** | Meta | 1.0M | $0.35 | $0.85 | **$0.47** | 18 | 109.8 | 1.05 | Open weights, MoE 402B/17B |
| 12 | **Gemini 3.1 Flash-Lite Preview** | Google | 1.0M | $0.25 | $1.50 | **$0.56** | **34** | 329.2 | 5.90 | Released Mar 2026 — *strong intelligence-for-price* |
| 13 | **GPT-4.1 mini** | OpenAI | 1.0M | $0.40 | $1.60 | **$0.70** | 23 | 79.0 | 0.86 | |
| 14 | **MiMo-V2.5** | Xiaomi | 1.0M | $0.36 | $1.80 | **$0.72** | **49** | 102.3 | 2.68 | Open weights MIT, 310B/15B MoE — *cheap and strong* |
| 15 | **Gemini 2.5 Flash** (Non-reasoning) | Google | 1.0M | $0.30 | $2.50 | **$0.85** | 21 | 228.6 | 0.66 | |
| 15 | **Gemini 2.5 Flash (Reasoning)** | Google | 1.0M | $0.30 | $2.50 | **$0.85** | 27 | 233.8 | 21.49 | |
| 15 | **Nova 2.0 Lite** (Non-reasoning) | Amazon | 1.0M | $0.30 | $2.50 | **$0.85** | 18 | 138.7 | 1.55 | Oct 2025 |
| 18 | **Gemini 3 Flash Preview** (Non-reasoning) | Google | 1.0M | $0.50 | $3.00 | **$1.13** | 35 | 163.1 | 1.36 | Dec 2025 |
| 18 | **Gemini 3 Flash Preview (Reasoning)** | Google | 1.0M | $0.50 | $3.00 | **$1.13** | **46** | 185.6 | 7.43 | *Best frontier-vendor intelligence under $4/M output* |
| 18 | **Qwen3.6 Plus** | Alibaba | 1.0M | $0.50 | $3.00 | **$1.13** | **50** | 53.1 | 2.75 | Apr 2026 — *highest AA intel under blended ~$1.5* |
| 21 | **MiMo-V2.5-Pro** | Xiaomi | 1.0M | $1.00 | $3.00 | **$1.50** | **54** | 58.4 | 3.00 | Open weights MIT, 1.023T/42B MoE — *highest intel in cheap tier* |

**Borderline (just outside the user-stated $1/$4 envelope but worth knowing):**

| Model | Provider | Ctx | Input | Output | Blended | Intel | Notes |
|---|---|---|---|---|---|---|---|
| Grok 4.3 | xAI | 1.0M | $1.25 | $2.50 | $1.56 | 53 | Cheap reasoning frontier (Apr 2026) |
| DeepSeek V4 Pro (High/Max) | DeepSeek | 1.0M | n/a | n/a | $2.17 | 50–52 | Open weights MIT |
| GPT-4.1 (full) | OpenAI | 1.0M | $2.00 | $8.00 | $3.50 | 26 | Above output cap |
| Gemini 2.5 Pro | Google | 1.0M | n/a | n/a | $3.44 | 35 | |
| Gemini 3.1 Pro Preview | Google | 1.0M | n/a | n/a | $4.50 | 57 | Frontier but above cap |

**Excluded — context < 1M:**

- Amazon **Nova Lite** (300k), **Nova Pro** (300k) — Dec 2024
- **MiMo-V2-Flash** (256k) — Dec 2025 — $0.10 / $0.30, blended $0.15
- **Qwen3 235B A22B 2507** (256k) — $0.40 / $2.15 — would otherwise fit
- **Jamba 1.5** family (256k native, not 1M+)
- **MiniMax-Text-01** / **MiniMax M1 80k** (1M context, $0.55 / $2.20, blended $0.96, AA-Intel 24) — *actually qualifies, see deep-dive*

Adding MiniMax M1 80k since it does qualify:

| **MiniMax M1 80k** | MiniMax | **1.0M** | $0.55 | $2.20 | **$0.96** | 24 | n/a | n/a | Apr 2025, open weights Apache 2.0 |

---

## Per-Model Deep Dives

### 1. NVIDIA Nemotron 3 Nano 30B A3B (Non-reasoning)
- **Pricing:** $0.05 input / $0.20 output → blended $0.09 per 1M
- **Context:** 1.0M tokens
- **Released:** 2025-12-15
- **License:** NVIDIA Nemotron Open Model License (commercial OK)
- **Architecture:** MoE, 31.6B total / 3.6B active
- **AA Intelligence Index:** 13 (rank #26 of 73)
- **Speed:** 94.5 t/s, **TTFT 0.43 s** (fastest TTFT in this list)
- **Benchmark scores:** Not individually published on AA page; evaluated on GDPval-AA, Terminal-Bench Hard, τ²-Bench Telecom, SciCode, AA-LCR, AA-Omniscience, HLE, GPQA Diamond, IFBench, CritPt
- **Note:** Same-family `Nemotron 3 Nano Omni 30B A3B (Reasoning)` is 260k ctx, not 1M
- **URL:** https://artificialanalysis.ai/models/nvidia-nemotron-3-nano-30b-a3b

### 2. Gemini 2.5 Flash-Lite (Non-reasoning, Jun 2025)
- **Pricing:** $0.10 input / $0.40 output, cache $0.01 (-90%) → blended $0.18
- **Context:** 1.0M tokens
- **Released:** 2025-06-17
- **AA Intelligence Index:** 13
- **Speed:** 253.2 t/s, TTFT 1.22 s
- **AA recommends:** newer "Gemini 2.5 Flash-Lite (Sep)" — score 22 reasoning / 19 non-reasoning at same price
- **URL:** https://artificialanalysis.ai/models/gemini-2-5-flash-lite

### 3. GPT-4.1 nano
- **Pricing:** $0.10 input / $0.40 output, cache $0.028 (-73%) → blended $0.18
- **Context:** 1.0M tokens, max output 32k
- **Released:** 2025-04-14
- **AA Intelligence Index:** 13 (rank #57 of 83)
- **Speed:** 113.1 t/s, TTFT 0.71 s
- **Benchmark scores (OpenAI / 3rd-party):**
  - MMLU: 80.1%
  - GPQA Diamond: 50.3%
  - AIME 2024: 29.4%
  - IFEval: 74.5%
  - MMMU: 55.4%
  - MathVista: 56.2%
  - Global MMLU: 66.9%
- **URL:** https://artificialanalysis.ai/models/gpt-4-1-nano

### 4. DeepSeek V4 Flash (Reasoning) ★ best intel-per-dollar
- **Pricing:** $0.14 input / $0.28 output, cache $0.003 (-98%) → blended $0.18
- **Context:** 1.0M tokens
- **Released:** 2026-04-24
- **License:** MIT, open weights
- **Architecture:** MoE, 284B total / 13B active
- **AA Intelligence Index:** 47 (Max effort, rank #10 of 85) / 45 (High effort)
- **Speed:** 70.2 t/s, TTFT 1.21 s; very verbose (99M output tokens in eval)
- **AA-Omniscience:** -10 to -23 (Pro to Flash); reported hallucination rate ~96%
- **Detailed benchmark scores (from official DeepSeek model card):**

| Benchmark | Non-Think | High | Max |
|---|---|---|---|
| MMLU-Pro | 83.0 | 86.4 | 86.2 |
| GPQA Diamond | 71.2 | 87.4 | **88.1** |
| HLE | 8.1 | 29.4 | **34.8** |
| LiveCodeBench | 55.2 | 88.4 | **91.6** |
| HMMT 2026 Feb | 40.8 | 91.9 | 94.8 |
| SWE Verified | 73.7 | 78.6 | 79.0 |
| MRCR 1M | 37.5 | 76.9 | 78.7 |
| CorpusQA 1M | 15.5 | 59.3 | 60.5 |
| SimpleQA-Verified | 23.1 | 28.9 | 34.1 |
| Terminal Bench 2.0 | 49.1 | 56.6 | 56.9 |
| MMMU-Pro | — | — | — |

- **URL:** https://artificialanalysis.ai/models/deepseek-v4-flash

### 5. Grok 4.1 Fast (Non-reasoning) & Grok 4.1 Fast (Reasoning)
- **Pricing:** $0.20 input / $0.50 output, cache $0.05 (-75%) → blended $0.28
- **Context:** **2.0M tokens** (largest commercially-priced API context window currently)
- **Max output:** 30k
- **Released:** 2025-11-19
- **AA Intelligence Index:** 24 (non-reasoning) / 39 (reasoning)
- **Speed:** 89.1 t/s (non) / 97.5 t/s (rsng); TTFT 0.64 s (non) / 10.55 s (rsng)
- **Per-benchmark (3rd party / xAI):**
  - GPQA Diamond: 85.3% (reasoning) — alt source: 63.7% (non)
  - AIME 2025: 89.3% (reasoning) — alt source: 34.3% (non)
  - MMLU Pro: 74.3% (non)
  - HLE: 5% (non-reasoning); higher for reasoning, exact value not located
  - LiveCodeBench: 39.9% (non)
  - SciCode: 29.6% (non)
  - τ²-Bench: 63.7% (non)
  - IFBench: 36.5% (non)
  - AA-LCR: 22% (non)
- **URL:** https://artificialanalysis.ai/models/grok-4-1-fast and `/grok-4-1-fast-reasoning`

### 6. Llama 4 Scout
- **Pricing:** $0.17 input / $0.66 output → blended $0.29
- **Context:** **10M tokens** (largest in market)
- **Released:** 2025-04-05
- **License:** Llama 4 Community License (open weights, self-hostable)
- **Architecture:** MoE, 109B total / 17B active
- **AA Intelligence Index:** 14 (rank #17 of 39)
- **Speed:** 143.8 t/s, TTFT 0.91 s
- **Per-benchmark (Meta / 3rd party):**
  - MMLU Pro: 74.3
  - GPQA Diamond: 57.2
  - LiveCodeBench: 32.8
  - MMMU: 69.4
  - MathVista: 70.7
- **URL:** https://artificialanalysis.ai/models/llama-4-scout

### 7. Grok 3 mini Reasoning (high)
- **Pricing:** $0.30 input / $0.50 output, cache $0.075 (-75%) → blended $0.35
- **Context:** 1.0M tokens
- **Released:** 2025-02-19
- **AA Intelligence Index:** 32 (rank #38 of 156)
- **Speed:** 163.5 t/s, TTFT 0.64 s; very verbose (100M tokens in eval)
- **URL:** https://artificialanalysis.ai/models/grok-3-mini-reasoning

### 8. Llama 4 Maverick
- **Pricing:** $0.35 input / $0.85 output, cache $0.27 → blended $0.47
- **Context:** 1.0M tokens
- **Released:** 2025-04-05
- **License:** Open weights
- **Architecture:** MoE, 402B total / 17B active
- **AA Intelligence Index:** 18 (rank #27 of 43)
- **Speed:** 109.8 t/s, TTFT 1.05 s
- **URL:** https://artificialanalysis.ai/models/llama-4-maverick

### 9. Gemini 3.1 Flash-Lite Preview ★ likely the user's "Gemini 3.1 Flash Lite tier"
- **Pricing:** $0.25 input / $1.50 output, cache $0.025 (-90%) → blended $0.56
- **Batch API:** 50% off → $0.125 / $0.75
- **Context:** 1.0M tokens (1,048,576), max output 65,536
- **Released:** 2026-03-03
- **Knowledge cutoff:** 2025-01-01
- **AA Intelligence Index:** 34 (rank #32 of 156)
- **Speed:** 329.2 t/s (rank #2), TTFT 5.90 s
- **Per-benchmark (Google / 3rd party):**
  - GPQA Diamond: **86.9%**
  - MMMU-Pro: 76.8%
  - LiveCodeBench: 72.0%
  - MMMLU (multilingual): 88.9%
  - CharXiv Reasoning: 73.2%
  - Video-MMMU: 84.8%
  - Arena Elo: 1,432
- **Modalities:** Text, image, speech, video → text
- **URL:** https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview

### 10. GPT-4.1 mini
- **Pricing:** $0.40 input / $1.60 output, cache $0.10 (-75%) → blended $0.70
- **Context:** 1.0M tokens, max output 32k
- **Released:** 2025-04-14
- **AA Intelligence Index:** 23 (rank #33 of 83 non-reasoning)
- **Speed:** 79.0 t/s, TTFT 0.86 s
- **Per-benchmark (OpenAI):**
  - MMLU: 87.5%
  - GPQA Diamond: 65%
  - AIME 2024: 49.6%
  - IFEval: 84.1%
  - MMMU: 72.7%
  - MathVista: 73.1%
  - SWE-Bench Verified: 23.6%
  - Global MMLU: 78.5%
- **URL:** https://artificialanalysis.ai/models/gpt-4-1-mini

### 11. MiMo-V2.5 (Xiaomi)
- **Pricing:** $0.36 input / $1.80 output, cache $0.20 (-44%) → blended $0.72
- **Context:** 1.0M tokens
- **Released:** 2026-04-22
- **License:** MIT, open weights
- **Architecture:** MoE, 310B total / 15B active
- **AA Intelligence Index:** **49** (rank #8 of 85) — well above median 30
- **Speed:** 102.3 t/s, TTFT 2.68 s
- **URL:** https://artificialanalysis.ai/models/mimo-v2-5-0424

### 12. Gemini 2.5 Flash (May 2025 release)
- **Pricing:** $0.30 input / $2.50 output, cache $0.03 (-90%) → blended $0.85
- **Context:** 1.0M tokens
- **Released:** 2025-05-20
- **AA Intelligence Index:** 21 (non-reasoning) / 27 (reasoning)
- **Speed:** 228.6 t/s (non) / 233.8 t/s (rsng); TTFT 0.66 s (non) / 21.49 s (rsng)
- **Modalities:** Text, image, speech, video → text
- **URL:** https://artificialanalysis.ai/models/gemini-2-5-flash

### 13. Amazon Nova 2.0 Lite (Oct 2025)
- **Pricing:** $0.30 input / $2.50 output → blended $0.85
- **Context:** 1.0M tokens
- **Released:** 2025-10-29
- **AA Intelligence Index:** 18 (non-reasoning, rank #38 of 83), variants up to 35 with "high" reasoning
- **Reasoning variants:** Low 25, Medium 30, High 35 (same price)
- **Speed:** 138.7 t/s, TTFT 1.55 s
- **URL:** https://artificialanalysis.ai/models/nova-2-0-lite

### 14. Gemini 3 Flash Preview ★ best frontier-vendor intel under $4/M output
- **Pricing:** $0.50 input / $3.00 output, cache $0.05 (-90%) → blended $1.13
- **Context:** 1.0M tokens
- **Released:** 2025-12-17
- **AA Intelligence Index:** 35 (non-reasoning, rank #20 of 71) / **46** (reasoning, rank #34 of 146)
- **Speed:** 163.1 t/s (non) / 185.6 t/s (rsng); TTFT 1.36 s (non) / 7.43 s (rsng)
- **Per-benchmark (Google / 3rd party):**
  - GPQA Diamond: 90.4%
  - MMLU-Pro: 89% (reported in AA "Everything you need to know")
  - HLE: 33.7% (without tools)
  - SWE-Bench Verified: 78%
  - MMMU-Pro: 81.2%
- **AA-Omniscience hallucination rate: 91%** (highest "knowledge accuracy" of any model, but answers forcefully when it doesn't know)
- **Modalities:** Text, image, speech, video → text
- **URLs:** https://artificialanalysis.ai/models/gemini-3-flash and `/gemini-3-flash-reasoning`

### 15. Qwen3.6 Plus (Alibaba)
- **Pricing:** $0.50 input / $3.00 output, cache $0.05 (-90%) → blended $1.13
- **Context:** 1.0M tokens
- **Released:** 2026-04-02
- **AA Intelligence Index:** **50** (rank #19 of 146) — highest intel for frontier vendor at this price point
- **Speed:** 53.1 t/s, TTFT 2.75 s; very verbose (100M output tokens in eval)
- **Modalities:** Text, image, video → text
- **Per-benchmark:** LiveCodeBench v6 reported 87.1%; individual scores otherwise not published on AA page
- **URL:** https://artificialanalysis.ai/models/qwen3-6-plus

### 16. MiMo-V2.5-Pro (Xiaomi)
- **Pricing:** $1.00 input / $3.00 output, cache $0.80 (-20%) → blended $1.50
- **Context:** 1.0M tokens
- **Released:** 2026-04-22
- **License:** MIT, open weights
- **Architecture:** MoE, **1.023T total / 42B active** (largest MoE in this list)
- **AA Intelligence Index:** **54** (rank #2 of 85)
- **Speed:** 58.4 t/s, TTFT 3.00 s; very verbose (92M)
- **URL:** https://artificialanalysis.ai/models/mimo-v2-5-pro

---

## Borderline / Reference Rows

### MiniMax M1 80k
- **Pricing:** $0.55 / $2.20 → blended $0.96
- **Context:** 1.0M tokens
- **Released:** 2025-06-17
- **License:** Apache 2.0, open weights
- **Architecture:** MoE, 456B / 45.9B active
- **AA Intelligence Index:** 24 (rank #55 of 85)
- **Note:** Text-only (no image input)

### Kimi Linear 48B A3B Instruct
- **Pricing:** Self-host only — no first-party paid API listed on AA (input/output shown as $0.00)
- **Context:** 1.0M tokens
- **Released:** 2025-10-30
- **License:** MIT, open weights
- **Architecture:** MoE, 49.1B / 3B active
- **AA Intelligence Index:** 14 (rank #14 of 39)

### Grok 4.3 (just above the user's price ceiling — included for reference)
- **Pricing:** $1.25 input / $2.50 output, cache $0.20 (-84%) → blended $1.56
- **Context:** 1.0M tokens
- **Released:** 2026-04-30
- **AA Intelligence Index:** 53 (rank #10 of 146)
- **Speed:** 87.2 t/s, TTFT 7.55 s
- **IFBench:** 81.3% (#2 globally; only Grok 4.20 0309 Reasoning beats it at 82.9%)

### Gemini 3.1 Pro Preview (well above price cap — reference frontier)
- **Pricing:** blended $4.50 (input/output not separately published cleanly via AA scraping)
- **AA Intelligence Index:** 57
- **GPQA Diamond:** 94.1% (highest on AA leaderboard)
- **HLE:** 44.7% (highest on AA leaderboard)
- **SciCode:** 58.9% (highest on AA leaderboard)
- **Context:** 1.0M tokens

---

## Hallucination / Factuality Notes

| Model | AA-Omniscience knowledge accuracy | Hallucination rate when uncertain |
|---|---|---|
| Gemini 3 Flash (Reasoning) | **highest of any model on AA-Omniscience** | **91%** (answers forcefully when it doesn't know) |
| GPT-5.5 | 57% (record accuracy) | 86% |
| Grok 4 / GPT-5 (high) | 39% | 64% / 81% |
| Claude Opus 4.7 | lower accuracy | **36%** (most calibrated) |
| Claude 4.1 Opus | 36% accuracy | low |
| Claude 4.5 Haiku | 16% | 26% |
| DeepSeek V4 Pro / Flash | n/a | **94% / 96%** (AA-Omniscience score -10 / -23) |
| SimpleQA-Verified DeepSeek V4 Flash | 34.1% (Max) / 23.1% (Non-think) | — |

**Bottom line:** if hallucination tolerance is the bottleneck, **avoid Gemini 3 Flash and DeepSeek V4 Flash for factual Q&A without retrieval**. **Gemini 3.1 Flash-Lite** has not had its hallucination rate published separately yet, but the Gemini 3 family broadly trades calibration for raw accuracy. **Claude family** is the conservative choice but blows the cost cap.

For **long-context retrieval** specifically, GPT-4.1 (1M ctx, non-reasoning) is noted in AA's AA-LCR write-up as outperforming reasoning models with smaller windows — but at $2/$8 it's outside the user's price target.

---

## Cost-Effective Frontier Summary (cheapest path to a given Intelligence)

(at blended 3:1 input:output ratio, sorted by intelligence)

- **AA Intel 13–14:** Nemotron 3 Nano ($0.09), Gemini 2.5 Flash-Lite ($0.18), GPT-4.1 nano ($0.18), Llama 4 Scout ($0.29)
- **AA Intel 18–22:** Llama 4 Maverick ($0.47), Nova 2.0 Lite ($0.85), Gemini 2.5 Flash non-rsng ($0.85), Gemini 2.5 Flash-Lite Sep ($0.18, reasoning)
- **AA Intel 23–27:** Grok 4.1 Fast non-rsng ($0.28), GPT-4.1 mini ($0.70), MiniMax M1 80k ($0.96), Gemini 2.5 Flash reasoning ($0.85)
- **AA Intel 32–35:** Grok 3 mini ($0.35), Gemini 3.1 Flash-Lite ($0.56), Gemini 3 Flash non-rsng ($1.13)
- **AA Intel 39–46:** Grok 4.1 Fast reasoning ($0.28) → Gemini 3 Flash reasoning ($1.13)
- **AA Intel 47–50:** **DeepSeek V4 Flash Max ($0.18) ★** → MiMo-V2.5 ($0.72) → Qwen3.6 Plus ($1.13)
- **AA Intel 53–54:** Grok 4.3 ($1.56) → MiMo-V2.5-Pro ($1.50) — outside strict cap

**The Pareto front for cheap 1M-context that the user should consider seriously:**

1. **DeepSeek V4 Flash (Max)** — $0.18 blended, AA Intel **47**, open weights MIT (but 96% hallucination rate when uncertain)
2. **MiMo-V2.5** — $0.72 blended, AA Intel **49**, open weights MIT (Xiaomi)
3. **Gemini 3 Flash (Reasoning)** — $1.13 blended, AA Intel **46**, frontier vendor
4. **Qwen3.6 Plus** — $1.13 blended, AA Intel **50**, frontier vendor (multimodal incl. video)
5. **Gemini 3.1 Flash-Lite Preview** — $0.56 blended, AA Intel 34, **fastest** (329 t/s) and **multimodal incl. video**, knowledge cutoff Jan 2025
6. **Grok 4.1 Fast (Reasoning)** — $0.28 blended, AA Intel 39, **2M context** (largest commercial)
7. **Llama 4 Scout** — $0.29 blended, AA Intel 14, **10M context** if you need it, open weights

---

## Notes on Data Freshness & Caveats

1. **AA Intelligence Index is a v4.0 composite** (10 evals). Individual per-benchmark scores are largely **not exposed in static page HTML** — AA renders them in JS-driven leaderboard tables that WebFetch can summarise (top-3 only) but cannot enumerate fully. For exhaustive per-benchmark per-model numbers, the AA evaluation pages are the canonical source (e.g. `/evaluations/gpqa-diamond`, `/evaluations/aa-lcr`, `/evaluations/omniscience`).
2. **Top-3 on each AA benchmark leaderboard (May 2026):**
   - **GPQA Diamond:** Gemini 3.1 Pro Preview 94.1% | GPT-5.5 (xhigh) 93.5% | GPT-5.5 (high) 93.2%
   - **HLE:** Gemini 3.1 Pro Preview 44.7% | GPT-5.5 (xhigh) 44.3% | GPT-5.5 (high) 43.0%
   - **IFBench:** Grok 4.20 0309 (Reasoning) 82.9% | Grok 4.3 81.3% | Grok 4.20 0309 v2 81.2%
   - **SciCode:** Gemini 3.1 Pro Preview 58.9% | GPT-5.4 (xhigh) 56.6% | GPT-5.5 (xhigh) 56.1%
   - **LiveCodeBench:** Gemini 3 Pro Preview (high) 91.7% | **Gemini 3 Flash Preview (Reasoning) 90.8%** | DeepSeek V3.2 Speciale 89.6%
   - **AA-Omniscience:** Gemini 3.1 Pro Preview 33 (highest score); GPT-5.5 (xhigh) 57% accuracy with 86% hallucination
   - **AA-LCR:** GPT-5.2 Codex (xhigh) 75.7% | GPT-5 (high) 75.6% | GPT-5.1 (high) 75.0%
3. **"Gemini 3 Flash Lite" vs "Gemini 3.1 Flash Lite":** Only the **Gemini 3.1 Flash-Lite Preview** appears on AA (released 2026-03-03). There is no separate "Gemini 3 Flash Lite" — Google jumped from Gemini 2.5 Flash-Lite (Jun 2025 + Sep 2025 refresh) straight to **Gemini 3.1 Flash-Lite** as the Flash-Lite branch for the v3 family. The "v3 Flash" branch only has the heavier `Gemini 3 Flash Preview`.
4. **Pricing cache discounts**: most frontier vendors (Google, OpenAI, Anthropic, DeepSeek, xAI) now offer **75–98% cache-hit discounts**. For workloads with stable prompts, blended cost is far below the published "3:1 blended" rate.
5. **Llama 4 Scout's 10M context** is theoretical maximum — practical providers (Together, Fireworks, Groq) often cap at 1M or less depending on host.
6. **DeepSeek V4 Flash benchmark numbers** are from DeepSeek's own HuggingFace model card published 2026-04-24. AA confirmed Intelligence Index of 47 (Max) / 45 (High), and AA-Omniscience score of -23 (with 96% hallucination rate). Independent third-party verification of the most extreme HLE / LiveCodeBench numbers is still emerging.
7. **AA Intelligence Index uses different bases**: when reading articles, a "score of 71" might come from an older or differently-normalised index version. The canonical current-state v4 numbers are what's on the model detail pages (e.g. Gemini 3 Flash Reasoning = 46).
8. **AA leaderboard table data is live (72-hour rolling window for speed/latency)** — prices change, benchmark re-runs happen, and preview models can be withdrawn or rebranded without notice.
9. **GPT-4.1 family pricing** (Apr 2025 release) has not been adjusted since launch; GPT-5 family largely supersedes it for OpenAI's stack but lacks the 1M context window (GPT-5.5 caps at 922k per AA's spec).
10. **xAI Grok 4.20 0309** (the highest-IFBench scorer on AA) is **2M context** but ~$3/M blended — outside the user's $1/$4 envelope per latest AA data.

---

## Recommendations Aligned to the User's Brief

If the criterion is "in the Gemini 2.5 Flash-Lite / Flash / Gemini 3.1 Flash-Lite tier — ≤$1/M input, ≤$4/M output, 1M+ ctx, API-available", the **top picks ranked by intelligence-per-dollar** are:

1. **DeepSeek V4 Flash (Max)** — best AA Intel (47) at lowest blended price ($0.18). Caveat: hallucinates aggressively, open weights so self-hosting possible.
2. **MiMo-V2.5** — AA Intel 49 at $0.72 blended. Open weights MIT.
3. **Qwen3.6 Plus** — AA Intel 50 at $1.13 blended. Multimodal (text/image/video), proprietary Alibaba.
4. **Gemini 3 Flash Preview (Reasoning)** — AA Intel 46 at $1.13 blended. Full multimodal (text/image/speech/video). Brand-name Google. *Warning: 91% hallucination rate on AA-Omniscience.*
5. **Gemini 3.1 Flash-Lite Preview** — AA Intel 34 at $0.56 blended. Fastest output (329 t/s), most economical Google option, full multimodal, knowledge cutoff Jan 2025.

For **largest context window** specifically: Llama 4 Scout (10M) > Grok 4.1 Fast (2M) > everything else (1M).

For **lowest hallucination at this price tier**: open question — Anthropic Claude family is best but well above the cap; among the cheap options, **GPT-4.1 mini** (with no reasoning chain and a stable factuality baseline of 65% GPQA / 87.5% MMLU) is the conservative pick at $0.70 blended.
