# OpenRouter — Cheap 1M+ Context Models

> Research date: **2026-05-13**
> Source: OpenRouter `GET /api/v1/models` (363 models total) + per-model `/endpoints` calls + rankings page.
> Raw JSON archived at `.tmp-research/openrouter-models.json`.

## Filter applied

1. `context_length >= 1,000,000` tokens
2. `pricing.prompt > 0` and `pricing.prompt <= $1.50/M` tokens
3. Not flagged with an `expiration_date` in the past (called out below when soon)

37 models match. All are generally available unless explicitly flagged. Prices are advertised list prices on OpenRouter — actual cost may differ via provider-direct (e.g. Gemini Batch API, Anthropic prompt-cache reads, etc.).

---

## Master table — sorted by 80/20 blended cost (input-heavy long-context workload)

Blended `$/M = 0.8 * input + 0.2 * output`. Tool calling and structured outputs reflect the model's top-level `supported_parameters` on OpenRouter.

| # | Slug | Ctx | In $/M | Out $/M | Blended 80/20 | Cache read $/M | Cache write $/M | Tools | Struct out | Modalities (in) | Max out tok | Mod | Notes |
|---|------|----:|-------:|--------:|---:|----:|----:|:---:|:---:|---|---:|:---:|---|
| 1 | `qwen/qwen3.5-flash-02-23` | 1.00M | 0.065 | 0.26 | **0.104** | n/a | 0.081 | y | y | text+image+video | 65 536 | n | Cheapest qualifying model; Alibaba-direct |
| 2 | `google/gemini-2.0-flash-lite-001` | 1.05M | 0.075 | 0.30 | **0.120** | n/a | n/a | y | y | text+image+file+audio+video | 8 192 | n | **Deprecates 2026-06-01** |
| 3 | `google/gemini-2.5-flash-lite-preview-09-2025` | 1.05M | 0.10 | 0.40 | **0.160** | 0.010 | 0.083 | y | y | text+image+file+audio+video | 65 535 | n | Preview alias of #4 |
| 4 | `google/gemini-2.5-flash-lite` | 1.05M | 0.10 | 0.40 | **0.160** | 0.010 | 0.083 | y | y | text+image+file+audio+video | 65 535 | n | GA, top-10-trending |
| 5 | `openai/gpt-4.1-nano` | 1.05M | 0.10 | 0.40 | **0.160** | 0.025 | n/a | y | y | text+image+file | 32 768 | **y** | OpenAI + Azure routing |
| 6 | `google/gemini-2.0-flash-001` | 1.05M | 0.10 | 0.40 | **0.160** | 0.025 | 0.083 | y | y | text+image+file+audio+video | 8 192 | n | **Deprecates 2026-06-01** |
| 7 | `deepseek/deepseek-v4-flash` | 1.05M | 0.14 | 0.28 | **0.168** | 0.0028 | n/a | y | y | text | 384 000 | n | Cheapest cache-read in list; 9 providers route this |
| 8 | `meta-llama/llama-4-maverick` | 1.05M | 0.15 | 0.60 | **0.240** | n/a | n/a | **n** | y | text+image | 16 384 | n | No tools at OpenRouter level; 4 providers |
| 9 | `x-ai/grok-4.1-fast` | **2.00M** | 0.20 | 0.50 | **0.260** | 0.050 | n/a | y | y | text+image+file | 30 000 | n | **Sunset 2026-05-15** (2 days from today) |
| 10 | `x-ai/grok-4-fast` | **2.00M** | 0.20 | 0.50 | **0.260** | 0.050 | n/a | y | y | text+image+file | 30 000 | n | **Sunset 2026-05-15** (2 days from today) |
| 11 | `qwen/qwen3-coder-flash` | 1.00M | 0.195 | 0.975 | **0.351** | 0.039 | 0.244 | y | n | text | 65 536 | n | Coder-specialized, tools but no structured-output |
| 12 | `qwen/qwen-plus-2025-07-28:thinking` | 1.00M | 0.26 | 0.78 | **0.364** | n/a | 0.325 | y | y | text | 32 768 | n | Hybrid thinking variant |
| 13 | `qwen/qwen-plus-2025-07-28` | 1.00M | 0.26 | 0.78 | **0.364** | n/a | 0.325 | y | y | text | 32 768 | n | Non-thinking |
| 14 | `qwen/qwen-plus` | 1.00M | 0.26 | 0.78 | **0.364** | 0.052 | 0.325 | y | n | text | 32 768 | n | Older Qwen2.5 base |
| 15 | `minimax/minimax-01` | 1.00M | 0.20 | 1.10 | **0.380** | n/a | n/a | **n** | **n** | text+image | 1 000 192 | n | Massive max_output (1M); no tools/struct |
| 16 | `google/gemini-3.1-flash-lite` | 1.05M | 0.25 | 1.50 | **0.500** | 0.025 | 0.083 | y | y | text+image+file+audio+video | 65 536 | n | **User's target — GA, currently #48 weekly, trending** |
| 17 | `qwen/qwen3.6-flash` | 1.00M | 0.25 | 1.50 | **0.500** | n/a | 0.313 | y | y | text+image+video | 65 536 | n | Newer Qwen 3.6 series |
| 18 | `google/gemini-3.1-flash-lite-preview` | 1.05M | 0.25 | 1.50 | **0.500** | 0.025 | 0.083 | y | y | text+image+file+audio+video | 65 536 | n | Preview alias of #16 |
| 19 | `qwen/qwen3.5-plus-02-15` | 1.00M | 0.26 | 1.56 | **0.520** | n/a | 0.325 | y | y | text+image+video | 65 536 | n | |
| 20 | `deepseek/deepseek-v4-pro` | 1.05M | 0.435 | 0.87 | **0.522** | 0.0036 | n/a | y | y | text | 384 000 | n | 1.6T-param MoE, very low cache-read |
| 21 | `openai/gpt-4.1-mini` | 1.05M | 0.40 | 1.60 | **0.640** | 0.10 | n/a | y | y | text+image+file | 32 768 | **y** | |
| 22 | `qwen/qwen3.6-plus` | 1.00M | 0.325 | 1.95 | **0.650** | n/a | 0.406 | y | y | text+image+video | 65 536 | n | |
| 23 | `xiaomi/mimo-v2.5` | 1.05M | 0.40 | 2.00 | **0.720** | 0.08 | n/a | y | n | text+image+audio+video | 131 072 | n | Native omnimodal |
| 24 | `amazon/nova-2-lite-v1` | 1.00M | 0.30 | 2.50 | **0.740** | n/a | n/a | y | n | text+image+file+video | 65 535 | **y** | |
| 25 | `google/gemini-2.5-flash` | 1.05M | 0.30 | 2.50 | **0.740** | 0.030 | 0.083 | y | y | text+image+file+audio+video | 65 535 | n | Currently #11 trending |
| 26 | `minimax/minimax-m1` | 1.00M | 0.40 | 2.20 | **0.760** | n/a | n/a | y | n | text | 40 000 | n | |
| 27 | `qwen/qwen3.5-plus-20260420` | 1.00M | 0.40 | 2.40 | **0.800** | n/a | n/a | y | y | text+image+video | 65 536 | n | |
| 28 | `~google/gemini-flash-latest` | 1.05M | 0.50 | 3.00 | **1.000** | 0.050 | 0.083 | y | y | text+image+file+audio+video | 65 536 | n | Alias — routes to latest Flash |
| 29 | `google/gemini-3-flash-preview` | 1.05M | 0.50 | 3.00 | **1.000** | 0.050 | 0.083 | y | y | text+image+file+audio+video | 65 536 | n | Full Gemini 3 Flash (not Lite) |
| 30 | `qwen/qwen3-coder-plus` | 1.00M | 0.65 | 3.25 | **1.170** | 0.13 | 0.813 | y | y | text | 65 536 | n | |
| 31 | `xiaomi/mimo-v2.5-pro` | 1.05M | 1.00 | 3.00 | **1.400** | 0.20 | n/a | y | y | text | 16 384 | n | |
| 32 | `xiaomi/mimo-v2-pro` | 1.05M | 1.00 | 3.00 | **1.400** | 0.20 | n/a | y | n | text | 131 072 | n | |
| 33 | `x-ai/grok-4.3` | 1.00M | 1.25 | 2.50 | **1.500** | 0.20 | n/a | y | y | text+image | n/a | n | |
| 34 | `x-ai/grok-4.20` | **2.00M** | 1.25 | 2.50 | **1.500** | 0.20 | n/a | y | y | text+image+file | n/a | n | |

**Excluded** (over $1.50/M input cap but still 1M+): `writer/palmyra-x5` ($0.60/$6.00, blended $1.68), Gemini 2.5 Pro variants ($1.25/$10, blended $3.00).

**Free 1M+ models** (zero list price, rate-limited): `openrouter/owl-alpha`, `google/lyria-3-pro-preview`, `google/lyria-3-clip-preview` (the Lyria ones output audio, not text — not usable as chat LLMs).

---

## Per-model detail blocks

### Tier S — the cheap defaults (blended < $0.25/M)

#### `qwen/qwen3.5-flash-02-23` — Qwen3.5-Flash
- **Pricing**: $0.065 in / $0.26 out per M. Cache write $0.081/M, no cache-read (Alibaba caches implicitly at write side).
- **Context**: 1 000 000 tokens. Max out 65 536.
- **Modalities in**: text, image, video. Out: text only. No audio in.
- **Tool calling**: yes. **Structured outputs**: yes. Hybrid reasoning supported (`reasoning`, `include_reasoning`).
- **Routing**: **single provider — Alibaba direct only**. 99.96% uptime (last 30m). No fallback if Alibaba is down.
- **Tokenizer**: Qwen3.
- **Risk**: single-provider dependency, China-hosted (data-residency / latency from US/EU).
- Architecture: hybrid linear-attention + sparse MoE per Alibaba description.

#### `google/gemini-2.0-flash-lite-001` — Gemini 2.0 Flash Lite
- **Pricing**: $0.075 in / $0.30 out per M. Image $0.075/M. No cache. Web-search $14/1k searches.
- **Context**: 1 048 576. Max out **only 8 192** (very tight — not a long-output model).
- **Tools, structured outputs, seed**: all supported.
- **Routing**: Google (Vertex) + Google AI Studio. 99.38% / 100% uptime.
- **DEPRECATES 2026-06-01** — about 3 weeks from today's date. Do not build on this; migrate to Gemini 2.5 Flash Lite or 3.1 Flash Lite.

#### `google/gemini-2.5-flash-lite` — Gemini 2.5 Flash Lite (and `…-preview-09-2025`)
- **Pricing**: $0.10 in / $0.40 out per M. Image $0.10/M, audio $0.30/M, cache-read $0.010/M, cache-write $0.083/M, internal_reasoning $0.40/M, web-search $14/1k. Caching is **10× cheaper than Gemini 2.0** for repeated context.
- **Context**: 1 048 576. Max out 65 535.
- **Modalities in**: text+image+file+audio+video (full Gemini). Reasoning is opt-in via `reasoning` parameter (default off).
- **Tools, structured outputs, seed**: all supported.
- **Routing**: **3 endpoints** — Google Vertex (EU) 99.86%, Google Vertex (Standard) 99.95%, Google AI Studio 99.50%. **All same price.** Vertex Standard is the highest-uptime route.
- **Knowledge cutoff**: 2025-01-31. **Ranked #11 weekly** on OpenRouter.

#### `openai/gpt-4.1-nano` — GPT-4.1 Nano
- **Pricing**: $0.10 in / $0.40 out per M. Cache read $0.025/M (OpenAI) or $0.030/M (Azure). No cache write fee. Web-search $10/1k.
- **Context**: 1 047 576. Max out 32 768.
- **Modalities in**: text+image+file. Out: text. **No audio/video**.
- **Tools, structured outputs, seed**: all supported. **Moderated** (OpenAI safety filter).
- **Routing**: 3 endpoints — OpenAI 97.29-99.07%, Azure (Sweden Central) 99.49-99.98%, Azure (default) 100%. **All same price.** Azure routes give better uptime and EU data residency.
- **Benchmarks (from model page)**: MMLU 80.1%, GPQA 50.3%, Aider polyglot coding 9.8%.
- **Tokenizer**: GPT (o200k_base or similar). Knowledge cutoff: 2024-06-30 (older than Gemini Flash Lite).

#### `google/gemini-2.0-flash-001` — Gemini 2.0 Flash (full)
- **Pricing**: $0.10 in / $0.40 out per M. Cache-read $0.025/M, cache-write $0.083/M, web-search $14/1k.
- **Context**: 1 048 576. Max out **8 192** (same tight cap as the Lite variant).
- **DEPRECATES 2026-06-01.** Same migration advice as 2.0 Flash Lite — use Gemini 2.5 Flash (full) instead.

#### `deepseek/deepseek-v4-flash` — DeepSeek V4 Flash
- **Pricing**: $0.14 in / $0.28 out per M. Cache-read **$0.0028/M** (literally 50× cheaper than Gemini, the cheapest cache-read in the entire qualifying set). 1.05M context. Max out 384 000.
- **Modalities**: text-only. Tools, structured outputs, full sampling parameters (logprobs, min_p, top_k, etc.). Hybrid reasoning.
- **Routing**: **9 endpoints**, all at same $0.14/$0.28 list except Venice ($0.17/$0.35) and Alibaba ($0.20/$0.40):
  - DeepSeek-direct: 99.98% uptime, unknown quant (likely fp8), 1.05M ctx, 384k max out.
  - SiliconFlow: fp8, 99.11%.
  - Parasail: fp8, 99.95%, **1 048 576 max out** (full-context completion!).
  - AtlasCloud: fp8, 99.86%, 393k max out.
  - DeepInfra: **fp4** quant (lower quality risk), 99.64%, only 16 384 max out.
  - AkashML: fp8, 262k ctx (not 1M!), 99.67%.
  - Novita: fp8, 99.94%, 393k max out.
  - Venice: $0.17/$0.35, 1M ctx, 32k max out — slightly more expensive.
  - Alibaba: $0.20/$0.40, 1M ctx — most expensive route.
- **Provider routing tip**: pin to `provider: { only: ["deepseek", "parasail", "atlascloud", "novita", "siliconflow"] }` to avoid fp4 quant on DeepInfra and the truncated 262k context on AkashML.

#### `meta-llama/llama-4-maverick` — Llama 4 Maverick
- **Pricing**: $0.15 in / $0.60 out per M (DeepInfra). 1.05M context. Max out **only 16 384**. 17B active / 128 experts MoE.
- **No tools support at OpenRouter level** (`tools` not in supported_parameters). Structured outputs yes via response_format.
- **Modalities**: text+image. Tokenizer: Llama4.
- **Routing**: 4 endpoints, **substantial price + context spread**:
  - DeepInfra: $0.15/$0.60, fp8, 1.05M ctx, 16k max out — cheapest.
  - Novita: $0.27/$0.85, fp8, 1.05M ctx, 8k max out.
  - Parasail: $0.35/$1.00, fp8, **only 524k ctx**, 32k max out, has cache-read ($0.17/M).
  - SambaNova: $0.63/$1.80, unknown quant, **only 131k ctx**, 4k max out — fastest known inference but very limited context here.
- **Provider routing tip**: pin to DeepInfra if you actually need the 1M context. SambaNova route silently throws away ~88% of the advertised context.

---

### Tier A — 2M context tier (Grok), and structured-rich options

#### `x-ai/grok-4-fast` and `x-ai/grok-4.1-fast` — Grok 4 / 4.1 Fast
- **Pricing**: $0.20 in / $0.50 out per M, cache-read $0.050/M, web-search $5/1k. Single provider (xAI).
- **Context**: **2 000 000 tokens** — the largest in the cheap tier.
- **Modalities**: text+image+file. Tools, structured outputs, reasoning toggle, logprobs all supported.
- **Reasoning**: toggled via `reasoning_enabled` / `reasoning: {enabled: …}`.
- **Uptime**: 99.98-99.99% (xAI-direct).
- **CRITICAL — `expiration_date: 2026-05-15`** (the JSON explicitly flags this). That is **two days from today (2026-05-13)**. The model page for Grok 4 Fast confirms "Going away May 15, 2026." **Do not build on these.** Migrate to `x-ai/grok-4.3` ($1.25 in / $2.50 out, 1M ctx) or `x-ai/grok-4.20` ($1.25/$2.50, 2M ctx) — both cost ~5× more but are not sunsetting.

#### `qwen/qwen3-coder-flash` — Qwen3 Coder Flash
- **Pricing**: $0.195 in / $0.975 out per M. Cache-read $0.039/M, cache-write $0.244/M. Alibaba-direct only, 100% uptime in last 24h.
- **Context**: 1 000 000. Max out 65 536. **Text-only.**
- **Tools**: yes. **Structured outputs**: **no** (no `structured_outputs` flag). JSON response_format supported. Coder-tuned variant of Qwen3 480B.

#### `qwen/qwen-plus`, `qwen/qwen-plus-2025-07-28`, `qwen/qwen-plus-2025-07-28:thinking` — Qwen Plus family
- **Pricing**: identical across all three — $0.26 in / $0.78 out, cache-read $0.052/M (only on `qwen-plus`), cache-write $0.325/M.
- **Context**: 1 000 000. Max out 32 768. **Text-only.**
- **Tools**: yes. **Structured outputs**: yes on `:thinking` and `-2025-07-28` variants; no on plain `qwen/qwen-plus` (older Qwen2.5 base).
- `:thinking` exposes the reasoning trace; the non-thinking variant suppresses it for lower latency.
- Single provider: Alibaba.

#### `minimax/minimax-01` — MiniMax-01
- **Pricing**: $0.20 in / $1.10 out per M. No cache.
- **Context**: 1 000 192. Max out **1 000 192** (full context as output — unique).
- **Modalities**: text+image.
- **NO tools, NO structured outputs.** Only `max_tokens, temperature, top_p` supported parameters. **Not usable for agentic / function-calling workflows.**
- Single provider: MiniMax.

---

### Tier B — Gemini 3.1 Flash Lite and 1M Qwen 3.6 / 3.5 Plus

#### `google/gemini-3.1-flash-lite` — Gemini 3.1 Flash Lite *(USER PRIORITY)*
- **Pricing**: $0.25 in / $1.50 out per M. Image $0.25/M, cache-read $0.025/M, cache-write $0.083/M, internal_reasoning $1.50/M, web-search $14/1k.
- **Context**: 1 048 576. Max out 65 536.
- **Modalities in**: text+image+file+audio+video (full Gemini multimodal stack). Out: text only.
- **Tools, structured outputs, reasoning, seed**: all supported. Supports **thinking levels** `minimal | low | medium | high` to trade quality for cost (per model page).
- **Routing**: 2 endpoints — Google (Vertex) 97.17-97.64% uptime, Google AI Studio 96.41-96.84%. **Same $0.25/$1.50 price on both.** Uptime is noticeably worse than 2.5 Flash Lite (which sits at 99.9+%) — this is a newly released model still ramping.
- **Trending**: #2 trending on OpenRouter (per rankings page); currently ranked #48 by weekly tokens (93.5B/week) — strong adoption velocity since launch.
- **Marketing positioning** (from model page): "priced at half the cost of Gemini 3 Flash" (i.e. the $0.50/$3.00 full Flash). Approaches Gemini 2.5 Flash quality, beats 2.5 Flash Lite. Designed for "lightweight agentic workflows, simple data extraction."
- **vs Gemini 2.5 Flash Lite**: 2.5× more expensive (input) and 3.75× more expensive (output) than 2.5 Flash Lite, in exchange for higher quality and better tool-use. For pure high-volume, high-context extraction with no reasoning, 2.5 Flash Lite is still the sweet spot. Use 3.1 Flash Lite when you need the smarter agent.
- **Preview alias**: `google/gemini-3.1-flash-lite-preview` is an identically-priced alias; the unsuffixed slug is GA.

#### `qwen/qwen3.6-flash` — Qwen 3.6 Flash
- **Pricing**: $0.25 in / $1.50 out per M (matches Gemini 3.1 Flash Lite). Cache-write $0.313/M, no cache-read.
- **Context**: 1 000 000. Max out 65 536. text+image+video in.
- Tools + structured outputs + reasoning all supported. Hybrid linear-attention + sparse-MoE architecture (per Alibaba spec). Single-provider via Alibaba.

#### `qwen/qwen3.5-plus-02-15`, `qwen/qwen3.6-plus`, `qwen/qwen3.5-plus-20260420` — Qwen Plus tier
- **Pricing**: 0.26-0.40 in, 1.56-2.40 out per M. Cache-write only.
- **Context**: 1M, max out 65 536, text+image+video.
- Tools + structured outputs supported on all three. Single-provider (Alibaba).

#### `deepseek/deepseek-v4-pro` — DeepSeek V4 Pro
- **Pricing**: $0.435 in / $0.87 out per M. Cache-read **$0.0036/M** (extremely cheap). Text-only. 1.6T total / 49B active MoE.
- **Context**: 1.05M. Max out 384 000. Tools + structured outputs supported. Full sampling param set.
- Same multi-provider routing pattern as V4 Flash (DeepSeek, SiliconFlow, Parasail, AtlasCloud, DeepInfra, Novita, etc.).

---

### Tier C — over $0.50/M blended, still under cap

#### `openai/gpt-4.1-mini` — GPT-4.1 Mini
- **Pricing**: $0.40 in / $1.60 out per M. Cache-read $0.10/M. Web-search $10/1k. Moderated.
- **Context**: 1 047 576. Max out 32 768. text+image+file in.
- Tools + structured outputs supported.
- **Routing**: 3 endpoints — OpenAI 97.29%, Azure Sweden 99.98%, Azure default 100%. **All same price.** Same Azure-uptime advantage as Nano.

#### `xiaomi/mimo-v2.5` — MiMo-V2.5 (omnimodal)
- **Pricing**: $0.40 in / $2.00 out per M. Cache-read $0.08/M.
- **Context**: 1.05M. Max out 131 072. Modalities: text+image+audio+video (true omnimodal — rare at this price). Tools yes, **structured outputs no**. Xiaomi-direct.

#### `amazon/nova-2-lite-v1` — Amazon Nova 2 Lite
- **Pricing**: $0.30 in / $2.50 out per M. No cache info exposed.
- **Context**: 1M. Max out 65 535. text+image+file+video in.
- **Tools yes, structured outputs no.** Moderated (Amazon Bedrock).

#### `google/gemini-2.5-flash` — Gemini 2.5 Flash (full)
- **Pricing**: $0.30 in / $2.50 out per M. Cache-read $0.030/M, cache-write $0.083/M, internal_reasoning $2.50/M, web-search $14/1k. **Ranked #11 weekly by usage.**
- Full Gemini multimodal stack. Tools + structured outputs supported. 65 535 max out.

#### `minimax/minimax-m1`
- $0.40 in / $2.20 out. Text-only. Hybrid MoE + "lightning attention" architecture (per the description). Tools yes, no structured outputs. Knowledge cutoff 2024-06.

#### `~google/gemini-flash-latest` and `google/gemini-3-flash-preview`
- Both at $0.50 in / $3.00 out per M with full Gemini multimodal stack. The `~`-prefixed slug is a moving alias that **redirects to the latest Flash** — useful for "always-newest" but unstable cost. The unprefixed `gemini-3-flash-preview` is the explicit Gemini 3 Flash (non-Lite) preview.
- Cache-read $0.050/M, cache-write $0.083/M, internal_reasoning $3.00/M.

#### `qwen/qwen3-coder-plus`
- $0.65 in / $3.25 out, cache-read $0.13/M, cache-write $0.813/M. 1M ctx, text-only. Tools + structured outputs. Coder-specialised Qwen3 480B.

#### `xiaomi/mimo-v2.5-pro`, `xiaomi/mimo-v2-pro`
- Both $1.00 in / $3.00 out, cache-read $0.20/M. 1.05M ctx, text-only. v2.5-pro has structured outputs; v2-pro does not. Pro variants of MiMo.

#### `x-ai/grok-4.3`, `x-ai/grok-4.20`
- Both $1.25 in / $2.50 out, cache-read $0.20/M, web-search $5/1k. Grok 4.3 is 1M ctx; **Grok 4.20 is 2M ctx and not deprecating** — this is the natural migration target from Grok 4 Fast / 4.1 Fast.

---

## Provider routing — practical notes

### Same-price multi-provider (use OpenRouter's load-balancer freely)
- **Gemini 2.5 / 3.1 Flash Lite, Gemini 2.0 Flash, Gemini 2.5 Flash**: Google Vertex (Standard) + Vertex (EU) + Google AI Studio — all same list price. Vertex Standard has consistently the best uptime; AI Studio has rate-limit caveats on free tier (irrelevant when going through OpenRouter credits).
- **GPT-4.1 Nano / Mini**: OpenAI + Azure (Sweden Central + default) — all same list price. Azure routes give 99.5-100% uptime versus OpenAI's 97-99%. Pin to Azure for higher reliability or for EU data residency. Note Azure uses `max_completion_tokens` (not `max_tokens`) — OpenRouter shims this.

### Price-spread multi-provider (pin carefully)
- **DeepSeek V4 Flash**: 9 providers, $0.14-$0.20 spread. **DeepInfra serves fp4** (lower quality than fp8 elsewhere). **AkashML only serves 262k context** despite the model claiming 1M. Pin to `deepseek, parasail, atlascloud, novita, siliconflow` for fp8 + full context.
- **Llama 4 Maverick**: 4 providers, $0.15-$0.63 spread. **Parasail caps context at 524k, SambaNova at 131k.** Pin to DeepInfra if 1M context is required. SambaNova is fastest if you only need <128k.

### Single-provider routes (no fallback)
- All Qwen models route through Alibaba only.
- All Xiaomi MiMo models route through Xiaomi only.
- All Grok models route through xAI only.
- MiniMax-01 and MiniMax M1 route through MiniMax only.

If high availability matters, prefer Gemini Flash Lite (3 endpoints) or GPT-4.1 Nano (3 endpoints) over single-provider routes.

---

## Caching savings

OpenRouter exposes `input_cache_read` (re-reading a previously-sent prefix) and `input_cache_write` (the price to populate the cache) per model. For long-context applications that re-send the same system prompt + retrieved docs repeatedly, this is often the biggest cost lever.

**Most aggressive cache discounts in the qualifying set** (cache-read $/M relative to prompt $/M):

| Model | Prompt | Cache read | Discount |
|---|---:|---:|---:|
| `deepseek/deepseek-v4-pro` | $0.435 | $0.0036 | **121×** |
| `deepseek/deepseek-v4-flash` | $0.14 | $0.0028 | **50×** |
| `openai/gpt-4.1-nano` | $0.10 | $0.025 | 4× |
| `google/gemini-2.5-flash-lite` | $0.10 | $0.010 | **10×** |
| `google/gemini-3.1-flash-lite` | $0.25 | $0.025 | 10× |
| `google/gemini-2.5-flash` | $0.30 | $0.030 | 10× |
| `~google/gemini-flash-latest` | $0.50 | $0.050 | 10× |
| `qwen/qwen3-coder-flash` | $0.195 | $0.039 | 5× |
| `qwen/qwen-plus` | $0.26 | $0.052 | 5× |
| `x-ai/grok-4*-fast` | $0.20 | $0.050 | 4× |
| `xiaomi/mimo-v2.5` | $0.40 | $0.08 | 5× |
| `meta-llama/llama-4-maverick` | $0.15 | n/a (DeepInfra/Novita) | — |
| `minimax/minimax-01`, `minimax-m1` | $0.20 / $0.40 | none | — |

**Key takeaways**
- **DeepSeek V4 Flash with cache hits is the cheapest path by a wide margin** for repeatable long-context workloads — effective input cost approaches $0.003/M for cached tokens. Multi-provider routing makes it robust.
- Gemini's 10× cache discount is automatic (implicit caching is on by default for Vertex; explicit caching via `cachedContents` API gives the same rate). Cache TTL on Vertex defaults to a few minutes for implicit, longer for explicit.
- OpenAI nano's 4× cache discount is automatic, no API change required (caches prefixes ≥1024 tokens, 5-10 min TTL).
- Llama 4 Maverick has no caching exposed except via Parasail ($0.17/M cache-read).
- Qwen models advertise cache-write but no cache-read on most variants — meaning the cache-write fee is the cost of warming the cache, and reads come at the regular rate. Verify directly with Alibaba if planning heavy cache reuse.

---

## Batch APIs / async discounts

OpenRouter itself does not currently expose batch-mode pricing in the `/api/v1/models` response (no `batch_input` field on any returned model). Provider-direct batch APIs that may save more if you bypass OpenRouter:

- **OpenAI Batch API**: 50% off `gpt-4.1-nano` / `mini` — i.e. $0.05/$0.20 for nano. 24h SLA. Only usable provider-direct.
- **Gemini Batch API** (Vertex): up to 50% off Gemini 2.5/3.1 Flash families — i.e. ~$0.125/$0.75 for Gemini 3.1 Flash Lite. 24h SLA. Only usable provider-direct (Vertex / AI Studio).
- **Anthropic Batches**: not applicable here (Claude is not in the cheap-tier 1M-context list except for the Opus/Sonnet 1M-ctx options which are far above the price cap).
- **xAI**: no public batch API as of today.
- **DeepSeek**: caching is the equivalent — no separate batch tier.

If your workload is genuinely batch (offline pipelines, eval grading, bulk extraction), the provider-direct batch APIs typically beat OpenRouter list price by 40-50%. OpenRouter is the right choice when you need realtime + provider fallback.

---

## Recommendations by use case

| Use case | Recommended slug | Why |
|---|---|---|
| Cheapest high-volume extraction, multimodal | `google/gemini-2.5-flash-lite` | $0.10/$0.40, 1M ctx, 3 endpoints, audio+video+file in, 10× cache discount, knowledge cutoff 2025-01 |
| Cheapest text-only, repeated long context | `deepseek/deepseek-v4-flash` (pin to non-fp4 providers) | $0.14/$0.28, 1M ctx, cache-read $0.0028/M, 7 viable fp8 providers |
| Latest cheap Gemini, smarter agents | `google/gemini-3.1-flash-lite` | $0.25/$1.50, thinking-level toggle, full Gemini multimodal — user's priority |
| Cheapest 2M-context | (Grok 4 Fast deprecates 2026-05-15) → `x-ai/grok-4.20` | After May 15, the cheapest 2M context is Grok 4.20 at $1.25/$2.50 |
| OpenAI ecosystem alignment | `openai/gpt-4.1-nano` (Azure-pinned for uptime) | $0.10/$0.40, function calling, OpenAI SDK compatibility |
| Native audio/video/image omnimodal at low price | `xiaomi/mimo-v2.5` | $0.40/$2.00, all four modalities in, 131k max out |
| Cheapest qualifying period | `qwen/qwen3.5-flash-02-23` | $0.065/$0.26, but single-provider risk via Alibaba only |

---

## What changed recently / risk flags

- **Gemini 2.0 Flash / Flash Lite expire 2026-06-01** (3 weeks). Migrate to 2.5 Flash Lite (same multimodal, 10× cache discount, better uptime, lower max-out at 8192 vs 65535 in 2.5 Lite — actually a Lite improvement).
- **Grok 4 Fast and Grok 4.1 Fast expire 2026-05-15** (2 days from today). The replacement at similar price tier is not announced; closest non-deprecating Grok is Grok 4.20 at 5× the price.
- **Gemini 3.1 Flash Lite uptime** is currently 96.4-97.6% — substantially worse than 2.5 Flash Lite's 99.9%. It is brand-new and ramping; if you need five-nines, stay on 2.5 Flash Lite for now.
- **Llama 4 Maverick** has `tools` missing from `supported_parameters` on OpenRouter's master record. Tool calling does work via some providers' raw APIs but OpenRouter does not consistently surface it — verify before relying on function calling.
- **MiniMax-01** does not expose tools or structured outputs at all. Don't use it for agentic workflows.

---

## Raw-data files for follow-up

- `/Users/mcharrad/Documents/Github/openalex-count/.tmp-research/openrouter-models.json` — full 363-model dump from `GET /api/v1/models`, fetched 2026-05-13.
- `/Users/mcharrad/Documents/Github/openalex-count/.tmp-research/details.txt` — per-model detail block for every qualifying model.
