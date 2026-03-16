# OpenRouter Integration Pitfalls

This file tracks real-world OpenRouter issues in a **Symptom / Cause / Detection / Fix** format.

---

## 1) "Provider returned error" (502)
**Symptom**
- Request fails with generic message like `Provider returned error`.

**Cause**
- OpenRouter is relaying an upstream provider failure (overload/outage/invalid upstream response).

**Detection**
- HTTP `502` plus generic provider error text.

**Fix**
- Always configure model-level fallbacks (`models: []`).
- Keep `allow_fallbacks: true` when resilience is more important than strict provider pinning.
- Retry with backoff for transient failures.

---

## 2) Free model rate limits (429)
**Symptom**
- Frequent `429 Too Many Requests` on `:free` models.

**Cause**
- Hard free-tier caps:
  - 20 RPM on free models
  - 50/day without credits
  - 1000/day with >= $10 credits

**Detection**
- HTTP `429`, plus request frequency spikes.

**Fix**
- Implement exponential backoff + jitter.
- Add local throttling/queueing.
- For sustained traffic, move critical flows to paid variants.

---

## 3) Model not found (404)
**Symptom**
- `404` / `model not found` / no endpoints available.

**Cause**
- Hardcoded model IDs go stale.
- Free-model catalog changes often (adds/removals/replacements).

**Detection**
- HTTP `404` when calling formerly valid model IDs.

**Fix**
- **Must** fetch `GET /api/v1/models` dynamically.
- Build model selection from live catalog + capability filters.
- Cache with short TTL and refresh regularly.

---

## 4) Context length exceeded (400)
**Symptom**
- Request rejected for token/context overflow.

**Cause**
- Prompt + conversation + expected output exceed model `context_length`.

**Detection**
- HTTP `400` with context-length-related error.

**Fix**
- Read `context_length` from `/api/v1/models` before request.
- Trim history, summarize, chunk docs, and set conservative `max_tokens`.

---

## 5) Verification trap (401/402)
**Symptom**
- Key appears valid but calls still fail (`401`/`402`).

**Cause**
- Key format validity does not guarantee usable balance/permissions.
- Negative balance can produce `402`, even on free models.

**Detection**
- Runtime auth/billing failures despite "verified" key.

**Fix**
- Always check `GET /api/v1/key` first.
- Validate `is_free_tier`, `limit_remaining`, and usage counters.
- Alert early on low/negative credit state.

---

## 6) Silent model capability changes
**Symptom**
- Features silently degrade (e.g., image input ignored, tool behavior regresses).

**Cause**
- Static model capability snapshots drift from live model metadata.

**Detection**
- No hard error, but outputs indicate missing modality/tool support.

**Fix**
- Resolve capabilities from live model metadata (`/api/v1/models`) at runtime.
- Gate feature flags (vision/tools/reasoning) on current `supported_parameters` / architecture fields.

---

## 7) Fallback not respected (provider routing)
**Symptom**
- Calls route to unexpected providers when strict provider choice was intended.

**Cause**
- Provider fallback/load-balancing defaults can override assumptions.

**Detection**
- Response/provider metadata shows non-requested provider.

**Fix**
- When provider pinning is required, set:
  - `provider.allow_fallbacks: false`
  - `provider.order: ["desired-provider"]`
- For resilience mode, allow fallbacks intentionally and monitor actual provider selection.

---

## 8) Nemotron verbosity cost trap
**Symptom**
- Strong throughput metrics, but unexpectedly high token usage/cost per task.

**Cause**
- Nemotron can generate roughly **~15x more tokens than a median model** in some evaluations; throughput headlines can hide token-cost inflation.

**Detection**
- Track `usage.total_tokens`, output length, and cost-per-task; compare against baseline models.

**Fix**
- Use concise prompt style.
- Set explicit `max_tokens` ceiling.
- Evaluate task-level unit economics (quality + latency + total token cost), not throughput alone.

---

## From Probe App Testing

**Run date:** 2026-03-15

### Test 1 — `GET /models`: PASS (200)
- Auth worked with live API.
- Pricing fields were confirmed present on real models, including:
  - `pricing.prompt`
  - `pricing.completion`
  - `pricing.input_cache_read`

### Test 2 — `nvidia/nemotron-3-super-120b-a12b:free`: PASS (200)
- OpenRouter resolved the slug to a date-stamped variant:
  - `nvidia/nemotron-3-super-120b-a12b-20230311:free`
- **Important:** Do not hardcode the versioned ID; use the stable slug.
- Response content was correct: `PROBE_OK`.
- **Critical finding (reasoning overhead):**
  - `completion_tokens = 46`
  - `reasoning_tokens = 46`
  - This was for a 3-word reply (`PROBE_OK`), showing that trivial prompts can still incur substantial reasoning-token burn.
- For EBA cost modeling, effective token cost should be treated as:
  - `prompt + reasoning + completion`
  - not just `prompt + completion`.
- Cost observed: `0` (free tier), `upstream_inference_cost = null`.
- Provider observed: `Nvidia`.

### Test 3 — `mistralai/mistral-7b-instruct`: FAIL (404)
- Error: `No endpoints found for mistralai/mistral-7b-instruct.`
- Root cause: model is deprecated/removed from OpenRouter.
- Fix:
  - Always use dynamic model discovery via `GET /api/v1/models`.
  - Working alternatives include:
    - `mistralai/mistral-7b-instruct:free`
    - `mistralai/mistral-small-3.1-24b-instruct`

### Test 4 — Generation lookup: FAIL (404)
- `GET /api/v1/generation?id=gen-XXXX` returned 404 immediately after a successful completion.
- Root cause: generation records are asynchronously indexed and may not be queryable immediately.
- Fix:
  - Add a short delay (1–2s) before querying generation lookup.
  - Or skip lookup and use the completion response `usage` object directly for cost/token accounting.

### Probe Summary
- Pass: 2 / 4
- Fail: 2 / 4
- Confirmed in live runs:
  - Dynamic model discovery is mandatory.
  - Nemotron reasoning-token overhead is materially real on trivial prompts.
  - Generation lookup has eventual consistency behavior.
