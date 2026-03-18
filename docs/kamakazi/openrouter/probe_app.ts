const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const REQUIRED_HEADERS = {
  "HTTP-Referer": "https://github.com/eba-project",
  "X-Title": "EBA Probe",
  "Content-Type": "application/json",
};

const PROMPT = "Reply with exactly: PROBE_OK";
// Verified 2026-03-16 — review monthly; free-tier models rotate frequently on OpenRouter.
const FREE_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
// Verified 2026-03-16 — review quarterly; paid models are more stable but can be deprecated.
const PAID_MODEL = "mistralai/mistral-small-3.1-24b-instruct";

type ProbeResult = {
  ok: boolean;
  status: number;
  body: any;
  headers: Record<string, string>;
  content: string | null;
  usage: any;
  model: string | null;
  generationId: string | null;
  generationLookup?: {
    ok: boolean;
    status: number;
    body: any;
    headers: Record<string, string>;
  };
  error?: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function extractHeaders(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) {
    out[key] = value;
  }
  return out;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 10_000): Promise<{ status: number; ok: boolean; headers: Record<string, string>; body: any; rawText: string; }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const status = response.status;
    const ok = response.ok;
    const headers = extractHeaders(response);
    const rawText = await response.text();

    let body: any = null;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = { parse_error: "Response was not valid JSON", raw_text: rawText };
    }

    return { status, ok, headers, body, rawText };
  } finally {
    clearTimeout(timer);
  }
}

function getAssistantContent(body: any): string | null {
  const content = body?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return JSON.stringify(part);
      })
      .join(" ");
  }

  return null;
}

async function listModels(apiKey: string): Promise<{ ok: boolean; status: number; body: any; headers: Record<string, string>; }> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    ...REQUIRED_HEADERS,
  };

  const result = await fetchJson(`${OPENROUTER_BASE_URL}/models`, {
    method: "GET",
    headers,
  });

  return {
    ok: result.ok,
    status: result.status,
    body: result.body,
    headers: result.headers,
  };
}

async function chatCompletion(apiKey: string, model: string, prompt: string): Promise<ProbeResult> {
  try {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      ...REQUIRED_HEADERS,
    };

    const requestBody = {
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 50,
    };

    const completion = await fetchJson(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    const body = completion.body;
    const generationId = typeof body?.id === "string" ? body.id : null;

    const result: ProbeResult = {
      ok: completion.ok,
      status: completion.status,
      body,
      headers: completion.headers,
      content: getAssistantContent(body),
      usage: body?.usage ?? null,
      model: typeof body?.model === "string" ? body.model : null,
      generationId,
    };

    if (generationId) {
      // OpenRouter generation records are indexed asynchronously; brief delay improves lookup reliability.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const generation = await fetchJson(
        `${OPENROUTER_BASE_URL}/generation?id=${encodeURIComponent(generationId)}`,
        {
          method: "GET",
          headers,
        }
      );

      result.generationLookup = {
        ok: generation.ok,
        status: generation.status,
        body: generation.body,
        headers: generation.headers,
      };
    }

    return result;
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      body: null,
      headers: {},
      content: null,
      usage: null,
      model: null,
      generationId: null,
      error: error?.message ?? String(error),
    };
  }
}

function printModelSample(modelsBody: any): void {
  const models = Array.isArray(modelsBody?.data) ? modelsBody.data : [];
  const firstFive = models.slice(0, 5);

  console.log("\nFirst 5 models (id + pricing):");
  if (firstFive.length === 0) {
    console.log("  No models returned.");
    return;
  }

  for (const model of firstFive) {
    const id = model?.id ?? "<missing id>";
    const pricing = model?.pricing ?? null;
    console.log(`  - ${id} | pricing: ${JSON.stringify(pricing)}`);
  }
}

function printCompletionResult(label: string, result: ProbeResult): void {
  console.log(`\n${label}`);
  console.log("-".repeat(label.length));
  console.log(`Status: ${result.status} (${result.ok ? "OK" : "FAIL"})`);

  if (result.error) {
    console.log(`Error: ${result.error}`);
    return;
  }

  console.log(`Model used: ${result.model ?? "<missing>"}`);
  console.log(`Generation ID: ${result.generationId ?? "<not present>"}`);
  console.log(`Assistant content: ${result.content ?? "<missing>"}`);
  console.log(`Usage: ${JSON.stringify(result.usage, null, 2)}`);

  const metadataFromBody = {
    usage: result.body?.usage,
    provider: result.body?.provider,
    system_fingerprint: result.body?.system_fingerprint,
  };
  console.log(`Body metadata: ${JSON.stringify(metadataFromBody, null, 2)}`);

  const interestingHeaders = Object.fromEntries(
    Object.entries(result.headers).filter(([k]) =>
      k.startsWith("x-") || k.includes("openrouter") || k.includes("cost")
    )
  );
  console.log(`Interesting headers: ${JSON.stringify(interestingHeaders, null, 2)}`);

  console.log("Full completion response body:");
  console.log(JSON.stringify(result.body, null, 2));

  if (result.generationLookup) {
    console.log("Generation lookup result:");
    console.log(JSON.stringify(result.generationLookup, null, 2));
  } else {
    console.log("Generation lookup: skipped (no generation id present)");
  }
}

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("OpenRouter Kamakazi Probe: eba-openrouter");
  console.log("=".repeat(72));

  let apiKey: string;
  try {
    apiKey = requireEnv("OPENROUTER_API_KEY");
  } catch (error: any) {
    console.error(`FAIL: ${error?.message ?? String(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log("\n[1/3] GET /models (auth + model list)");
  const modelsResult = await listModels(apiKey);
  console.log(`Status: ${modelsResult.status} (${modelsResult.ok ? "OK" : "FAIL"})`);
  if (modelsResult.ok) {
    printModelSample(modelsResult.body);
  } else {
    console.log("Models error body:");
    console.log(JSON.stringify(modelsResult.body, null, 2));
  }

  console.log(`\n[2/3] POST /chat/completions (${FREE_MODEL})`);
  const freeResult = await chatCompletion(apiKey, FREE_MODEL, PROMPT);
  printCompletionResult(`Free model probe: ${FREE_MODEL}`, freeResult);

  console.log(`\n[3/3] POST /chat/completions (${PAID_MODEL})`);
  const paidResult = await chatCompletion(apiKey, PAID_MODEL, PROMPT);
  printCompletionResult(`Paid model probe: ${PAID_MODEL}`, paidResult);

  const passModels = modelsResult.ok;
  const passFree = freeResult.ok;
  const passPaid = paidResult.ok;

  console.log("\n" + "=".repeat(72));
  console.log("PASS/FAIL SUMMARY");
  console.log("=".repeat(72));
  console.log(`GET /models: ${passModels ? "PASS" : "FAIL"}`);
  console.log(`${FREE_MODEL}: ${passFree ? "PASS" : "FAIL"}`);
  console.log(`${PAID_MODEL}: ${passPaid ? "PASS" : "FAIL"}`);

  if (passModels && passFree && passPaid) {
    console.log("OVERALL: PASS");
  } else {
    console.log("OVERALL: FAIL");
    process.exitCode = 1;
  }
}

main().catch((error: any) => {
  console.error("Unhandled probe failure:", error?.message ?? String(error));
  process.exitCode = 1;
});
