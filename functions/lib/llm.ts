// Real LLM call for llm_call steps. Uses whichever provider is configured
// via env vars. If none is configured, falls back to a clearly-labelled
// stub with an artificial delay — set LLM_STUB=true explicitly if you want
// this even when a key IS present (useful for demoing without burning quota).

const PROVIDER = process.env.LLM_PROVIDER ?? "groq"; // groq | openrouter | gemini
const API_KEY = process.env.LLM_API_KEY;
const STUB = process.env.LLM_STUB === "true" || !API_KEY;

export interface LLMResult {
  text: string;
  model: string;
  stubbed: boolean;
}

async function callGroq(prompt: string, model: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
    }),
  });
  if (!res.ok) throw new Error(`groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callOpenRouter(prompt: string, model: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGemini(prompt: string, model: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callOnce(prompt: string, model: string): Promise<string> {
  if (STUB) {
    await new Promise((r) => setTimeout(r, 800)); // disclosed artificial delay
    return `[STUBBED LLM RESPONSE — no LLM_API_KEY configured] Echo of prompt (first 200 chars): ${prompt.slice(0, 200)}`;
  }
  switch (PROVIDER) {
    case "groq":
      return callGroq(prompt, model || "llama-3.1-8b-instant");
    case "openrouter":
      return callOpenRouter(prompt, model || "meta-llama/llama-3.1-8b-instruct:free");
    case "gemini":
      return callGemini(prompt, model || "gemini-1.5-flash");
    default:
      throw new Error(`unknown LLM_PROVIDER: ${PROVIDER}`);
  }
}

/** Calls the LLM with one retry on failure, per the assignment's requirement
 *  that llm_call / http_request steps retry at least once. */
export async function callLLM(prompt: string, model = ""): Promise<LLMResult> {
  try {
    const text = await callOnce(prompt, model);
    return { text, model: model || PROVIDER, stubbed: STUB };
  } catch (err) {
    // one retry, short backoff
    await new Promise((r) => setTimeout(r, 500));
    const text = await callOnce(prompt, model);
    return { text, model: model || PROVIDER, stubbed: STUB };
  }
}

/** Generic HTTP call with one retry, used by http_request steps. */
export async function callHttp(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; body: any }> {
  const attempt = async () => {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* leave as raw text */
    }
    if (!res.ok) throw new Error(`http_request ${method} ${url} -> ${res.status}: ${text}`);
    return { status: res.status, body: parsed };
  };

  try {
    return await attempt();
  } catch (err) {
    await new Promise((r) => setTimeout(r, 500));
    return attempt(); // let a second failure propagate — caller marks step failed
  }
}

/** {{previous_output.field}} / {{trigger.field}} style templating, deliberately
 *  simple (no eval) since config is user-authored JSON stored in the DB. */
export function renderTemplate(template: string, context: Record<string, any>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce((acc: any, key: string) => acc?.[key], context);
    return value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  });
}
