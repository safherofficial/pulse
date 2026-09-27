/**
 * Live token copywriter.
 * Free public LLM cascade + LanguageTool polish.
 * Facts stay locked. Writing changes every variant.
 */

import { checkLanguageTool } from "./public-apis";
import { scoreContent, type ContentKind } from "./content-score";
import {
  ensureLockedMarket,
  ensureMarketVerdict,
  generateFromFactSet,
  type GeneratedContent,
  type RegenMode,
  type TokenFactSet,
} from "./content-create.ts";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type Provider = {
  id: string;
  url: string;
  model: string;
  key?: string;
  extraHeaders?: Record<string, string>;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function providers(): Provider[] {
  const list: Provider[] = [];
  const groq = env("GROQ_API_KEY");
  if (groq) {
    list.push({
      id: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: env("GROQ_MODEL") ?? "openai/gpt-oss-20b",
      key: groq,
    });
  }
  const openrouter = env("OPENROUTER_API_KEY");
  if (openrouter) {
    list.push({
      id: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: env("OPENROUTER_MODEL") ?? "qwen/qwen3.8-27b:free",
      key: openrouter,
      extraHeaders: {
        "HTTP-Referer": env("APP_URL") ?? "https://xpulse.app",
        "X-Title": "XPulse",
      },
    });
  }
  const gemini = env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY");
  if (gemini) {
    list.push({
      id: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      model: env("GEMINI_MODEL") ?? "gemini-2.5-flash",
      key: gemini,
    });
  }
  const pollen = env("POLLINATIONS_API_KEY");
  if (pollen) {
    list.push({
      id: "pollinations",
      url: "https://gen.pollinations.ai/v1/chat/completions",
      model: "openai",
      key: pollen,
    });
  }
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

async function chatComplete(
  provider: Provider,
  messages: ChatMessage[],
  temperature: number,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18_000);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(provider.extraHeaders ?? {}),
    };
    if (provider.key) headers.Authorization = `Bearer ${provider.key}`;
    const res = await fetch(provider.url, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model: provider.model,
        temperature,
        max_tokens: 700,
        messages,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; text?: string }>;
      content?: string;
    };
    const text =
      json.choices?.[0]?.message?.content ??
      json.choices?.[0]?.text ??
      (typeof json.content === "string" ? json.content : "");
    return text?.trim() ? text.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function systemPrompt(kind: ContentKind, mode: RegenMode): string {
  const shape =
    kind === "thread"
      ? "Write a complete X thread of 5 to 7 tweets. Number them 1/ 2/ 3/. Each tweet must stand alone and sound spoken, not labeled Hook/Context."
      : kind === "article"
        ? "Write a short publishable X Article / long-form note (220-360 words) with a title, short sections, and a close."
        : "Write one complete X post ready to paste. 90-220 words. Line breaks for rhythm. No title header.";

  const tone =
    mode === "more_viral" || mode === "stronger_hook"
      ? "Punchy crypto-native voice. High energy, still adult."
      : mode === "more_professional" || mode === "more_technical"
        ? "Desk / operator voice. Precise, calm, specific."
        : mode === "more_human" || mode === "more_story"
          ? "Human narrative. One scene, then the market."
          : mode === "more_concise"
            ? "Tight. No wasted clause."
            : "Natural timeline voice. Like a sharp trader writing to peers.";

  return [
    "You write a factual market note. You are not a promoter.",
    shape,
    tone,
    "The marketState in the user message is binding. Writing style never changes that conclusion.",
    "A severe, collapsed, bearish, or caution state must stay negative. Never turn it into an opportunity, a comeback pitch, or bullish hype.",
    "Use ONLY facts supplied in the user message. Never invent price, %, volume, liquidity, mcap, partners, audits, listings, or a rug-pull confirmation.",
    "If headline is present, include that sentence. If rugLine is present, include it. Do not upgrade rugLine into 'the team stole the funds' or 'this was rugged'.",
    "Separate what was measured from what is inferred.",
    "If price or market_cap is present, weave those exact strings once. Do not reformat them and do not invent a different market cap.",
    "If a field is missing, skip it. Do not write unavailable, N/A, or placeholder text.",
    "Do not dump labels like price: volume: liquidity:. Weave numbers into sentences.",
    "Banned: 100x, guaranteed, to the moon, ape in, can't miss, risk-free, exciting opportunity, could explode, mockup, lorem, TODO, sample data.",
    "Mention the contract address once, naturally.",
    "End with one short NFA line, written differently each time.",
    "Output only the post text. No preamble, no markdown fences, no analysis of your own writing.",
  ].join(" ");
}

function userPrompt(facts: TokenFactSet, kind: ContentKind, variant: number): string {
  const payload = {
    name: facts.identity.name,
    symbol: facts.identity.symbol,
    chain: facts.identity.chain,
    contract: facts.identity.address,
    metrics: Object.fromEntries(facts.metrics.map((m) => [m.key, m.value])),
    findings: facts.findings,
    risks: facts.risks,
    dexPaid: facts.dexPaid,
    boosts: facts.boosts,
    xNote: facts.xNote,
    marketState: facts.market.state,
    headline: facts.market.headline,
    rugLine: facts.market.rugLine,
    rugPullRisk: facts.market.rugPullRisk,
    riskScore: facts.market.riskScore,
    facts: facts.market.facts,
    conclusions: facts.market.conclusions,
    caveats: facts.market.caveats,
    variant,
    form: kind,
  };
  return [
    `Write a brand-new ${kind} for variant ${variant}. Different opening and rhythm than previous variants.`,
    "Locked market facts (JSON):",
    JSON.stringify(payload),
  ].join("\n");
}

function sanitize(text: string, facts: TokenFactSet): string {
  let out = text
    .replace(/^```[\w]*\n?|\n?```$/g, "")
    .replace(/\b(about to explode|guaranteed|100x|to the moon|ape in|can't miss|risk-free|lorem ipsum|mockup|placeholder)\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const hasCa = out.includes(facts.identity.address);
  if (!hasCa) {
    out = `${out}\n\nCA: ${facts.identity.address}`;
  }
  if (!/not financial advice|nfa\b/i.test(out)) {
    out = `${out}\n\nNFA. Read the pair yourself.`;
  }
  return ensureMarketVerdict(ensureLockedMarket(out, facts), facts);
}

async function polish(text: string): Promise<string> {
  try {
    const matches = await checkLanguageTool(text);
    if (!matches.length) return text;
    const usable = [...matches]
      .filter((m) => m.replacements[0] && m.length > 0)
      .sort((a, b) => b.offset - a.offset)
      .slice(0, 10);
    let next = text;
    for (const m of usable) {
      const swap = m.replacements[0]!;
      next = next.slice(0, m.offset) + swap + next.slice(m.offset + m.length);
    }
    return next;
  } catch {
    return text;
  }
}

export async function writeTokenCopy(
  facts: TokenFactSet,
  kind: ContentKind,
  mode: RegenMode = "default",
  variant = 0,
): Promise<GeneratedContent> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(kind, mode) },
    { role: "user", content: userPrompt(facts, kind, variant) },
  ];
  const temperature = mode === "more_concise" ? 0.7 : 0.95;
  const applied: string[] = [];

  for (const provider of providers()) {
    const raw = await chatComplete(provider, messages, temperature);
    if (!raw || raw.length < 80) {
      applied.push(`${provider.id}: skip`);
      continue;
    }
    const cleaned = sanitize(await polish(raw), facts);
    const score = scoreContent(cleaned, kind);
    applied.push(`Writer: ${provider.id}`, `Variant: ${variant}`, `Mode: ${mode}`);
    return {
      kind,
      angle: {
        id: "why",
        label: "Live copy",
        focus: "Natural post from locked market facts.",
        why: "A finished post beats a metric dump.",
      },
      text: cleaned,
      score,
      applied: [...applied, `Content score ${score.total}/100`],
    };
  }

  const fallback = generateFromFactSet(facts, kind, mode, variant);
  return {
    ...fallback,
    applied: [...fallback.applied, "Fallback: local copywriter (LLM providers unavailable)"],
  };
}
