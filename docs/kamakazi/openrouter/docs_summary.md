# OpenRouter Docs Summary

## Core API Shape
- **Base URL:** `https://openrouter.ai/api/v1`
- **Compatibility:** OpenAI-compatible request/response schema for chat completions.

## Authentication and Headers
- **Auth method:** `Authorization: Bearer <OPENROUTER_API_KEY>`
- **Required for JSON POST:** `Content-Type: application/json`
- **Optional/recommended attribution headers:**
  - `HTTP-Referer: <your-app-url>`
  - `X-OpenRouter-Title: <your-app-name>`

> Note: Official docs use **`X-OpenRouter-Title`** (not `X-Title`).

## Key Endpoints

### 1) Models catalog
- **Endpoint:** `GET /api/v1/models`
- **Purpose:** Dynamic model discovery; avoid hardcoding model IDs.
- **Important fields:**
  - `id`
  - `name`
  - `pricing.prompt`
  - `pricing.completion`
  - `context_length`
  - `architecture`
  - `supported_parameters`

### 2) API key status / limits
- **Endpoint:** `GET /api/v1/key`
- **Purpose:** Check credits and rate-limit-related status before sending requests.

### 3) Chat completions
- **Endpoint:** `POST /api/v1/chat/completions`
- **Purpose:** Standard OpenAI-style completion requests (`model`, `messages`, optional params).

### 4) Generation lookup
- **Endpoint:** `GET /api/v1/generation?id=<generation_id>`
- **Purpose:** Per-request lookup, including cost/accounting details for a generation.

## Usage Accounting (Built-In)
OpenRouter includes usage accounting data in responses. Key fields to consume:
- `usage.cost`
- `usage.cost_details.upstream_inference_cost`
- `usage.prompt_tokens_details.cached_tokens`
- `usage.completion_tokens_details.reasoning_tokens`

## Routing and Fallback Controls

### Provider routing object
Use `provider` to guide endpoint/provider choice:
- `order` (explicit provider preference order)
- `sort` (`"price" | "latency" | "throughput"`)
- `allow_fallbacks` (enable/disable provider fallback behavior)
- `max_price` (price ceiling controls)

### Model fallback arrays
Use top-level `models: []` to provide model-level fallback candidates.

## Model ID Suffix Conventions
- `:free` → free-tier model variant
- `:floor` → auto-route to cheapest provider for that model

## Rate Limits and Throughput Rules
- **Free-model RPM:** `20 RPM`
- **Free-model daily (no credits):** `50/day`
- **Free-model daily (>= $10 credits):** `1000/day`
- **Paid throughput rule:** roughly **$1 credit = 1 RPS**, up to **500 RPS**

## Reasoning Tokens
- Use the `reasoning` request parameter on supported models to control reasoning behavior/tokens.
