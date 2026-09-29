/**
 * XPulse LLM runtime.
 * The model writes/explains; deterministic code owns scores, limits and facts.
 */

export type LlmMessage = { role: "system" | "user"; content: string };

export type LlmTrace = {
  provider: string;
  model: string;
  durationMs: number;
  attempt: number;
  rawOutput?: string;
  prompt?: LlmMessage[];
  error?: string;
};

export type LlmResult = {
  text: string;
  trace: LlmTrace;
};

type Provider = {
  id: string;
  url: string;
  model: string;
  key?: string;
  extraHeaders?: Record<string, string>;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function providers(): Provider[] {
  const list: Provider[] = [];
  const groq = env("GROQ_API_KEY");
  if (groq) list.push({
    id: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: env("GROQ_MODEL") ?? "openai/gpt-oss-20b",
    key: groq,
  });
  const openrouter = env("OPENROUTER_API_KEY");
  if (openrouter) list.push({
    id: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: env("OPENROUTER_MODEL") ?? "qwen/qwen3.8-27b:free",
    key: openrouter,
    extraHeaders: {
      "HTTP-Referer": env("APP_URL") ?? "https://xpulse.app",
      "X-Title": "XPulse",
    },
  });
  const gemini = env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY");
  if (gemini) list.push({
    id: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: env("GEMINI_MODEL") ?? "gemini-2.5-flash",
    key: gemini,
  });
  const pollen = env("POLLINATIONS_API_KEY");
  if (pollen) list.push({
    id: "pollinations",
    url: "https://gen.pollinations.ai/v1/chat/completions",
    model: "openai",
    key: pollen,
  });
  list.push({
    id: "pollinations-public",
    url: "https://text.pollinations.ai/openai",
    model: "openai",
  });
  list.push({
    id: "llm7",
    url: "https://api.llm7.io/v1/chat/completions",
    model: env("LLM7_MODEL") ?? "gpt-4o-mini",
  });
  return list;
}

function debugEnabled(): boolean {
  return env("XPULSE_LLM_DEBUG") === "1";
}

function logTrace(trace: LlmTrace): void {
  if (!debugEnabled()) return;
  console.info("[XPULSE_LLM]", JSON.stringify(trace));
}

function extractText(json: unknown): string {
  const value = json as {
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
    content?: unknown;
  };
  const text =
    value.choices?.[0]?.message?.content ??
    value.choices?.[0]?.text ??
    value.content;
  return typeof text === "string" ? text.trim() : "";
}

export async function callLlm(
  messages: LlmMessage[],
  options: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    json?: boolean;
    validate?: (text: string) => boolean;
    repairPrompt?: string;
    maxAttempts?: number;
  } = {},
): Promise<LlmResult | null> {
  const maxAttempts = Math.min(2, Math.max(1, options.maxAttempts ?? 2));
  const providersList = providers();
  if (!providersList.length) return null;

  const { reserveAiAction } = await import("./ai-gateway");
  await reserveAiAction();

  for (const provider of providersList) {
    let currentMessages = messages;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 18_000);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...(provider.extraHeaders ?? {}),
        };
        if (provider.key) headers.Authorization = `Bearer ${provider.key}`;
        const body: Record<string, unknown> = {
          model: provider.model,
          temperature: attempt === 1 ? (options.temperature ?? 0.3) : 0.15,
          max_tokens: options.maxTokens ?? 1200,
          messages: currentMessages,
        };
        if (options.json) body.response_format = { type: "json_object" };

        const res = await fetch(provider.url, {
          method: "POST",
          headers,
          signal: ctrl.signal,
          body: JSON.stringify(body),
        });
        const raw = res.ok ? extractText(await res.json()) : "";
        const trace: LlmTrace = {
          provider: provider.id,
          model: provider.model,
          durationMs: Date.now() - started,
          attempt,
          ...(debugEnabled() ? { rawOutput: raw, prompt: currentMessages } : {}),
          ...(!res.ok ? { error: `HTTP ${res.status}` } : {}),
        };
        logTrace(trace);

        if (res.ok && raw && (!options.validate || options.validate(raw))) {
          return { text: raw, trace };
        }

        if (attempt < maxAttempts && options.repairPrompt) {
          currentMessages = [
            ...messages,
            { role: "assistant", content: raw },
            { role: "user", content: options.repairPrompt },
          ];
        }
      } catch (error) {
        const trace: LlmTrace = {
          provider: provider.id,
          model: provider.model,
          durationMs: Date.now() - started,
          attempt,
          ...(debugEnabled() ? { rawOutput: "", prompt: currentMessages } : {}),
          error: error instanceof Error ? error.message : "LLM request failed",
        };
        logTrace(trace);
        if (attempt < maxAttempts && options.repairPrompt) {
          currentMessages = [
            ...messages,
            { role: "user", content: options.repairPrompt },
          ];
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return null;
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct as Record<string, unknown>;
  } catch {
    /* try fenced/extracted JSON */
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
