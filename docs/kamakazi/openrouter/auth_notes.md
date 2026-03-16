# OpenRouter Auth Notes

## Authentication Method
- Use API key in Bearer auth header:
  - `Authorization: Bearer <OPENROUTER_API_KEY>`
- Recommended env var name:
  - `OPENROUTER_API_KEY`

## Recommended Headers
- Required:
  - `Authorization: Bearer ...`
  - `Content-Type: application/json` (for JSON POST)
- Optional but recommended:
  - `HTTP-Referer: <your-app-url>`
  - `X-OpenRouter-Title: <your-app-name>`

## Minimal TypeScript Auth Snippet (fetch)
```ts
const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  throw new Error("Missing OPENROUTER_API_KEY");
}

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://your-app.example",
    "X-OpenRouter-Title": "EBA Probe App",
  },
  body: JSON.stringify({
    model: "openrouter/free",
    messages: [{ role: "user", content: "ping" }],
  }),
});

const data = await res.json();
console.log(data);
```

## Check Key Status / Limits
- Endpoint: `GET https://openrouter.ai/api/v1/key`
- Typical useful fields in response data:
  - `label`
  - `limit`
  - `limit_remaining`
  - `is_free_tier`
  - `usage_daily`
  - `usage_weekly`
  - `usage_monthly`

## Auth Gotchas
1. **Key verification != fully working integration**
   - A key can be syntactically valid but still fail at runtime due to balance/plan/permissions.
   - Always check `/api/v1/key` and inspect `is_free_tier` + `limit_remaining`.

2. **`402` can appear even when using free models**
   - If account balance is negative, requests can fail with `402` (including `:free` variants).
