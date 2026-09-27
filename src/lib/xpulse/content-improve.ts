/**
 * Analyze / improve / threadify.
 * Free public stack: Groq, OpenRouter :free, Gemini, Pollinations, LLM7,
 * LanguageTool, Datamuse. Local thread packer as fallback.
 */

import { checkLanguageTool, expandVagueVocabulary } from "./public-apis";
import { scoreContent, type ContentKind, type ContentScoreReport } from "./content-score";
import type { GeneratedContent } from "./content-create";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type Provider = {
  id: string;
  url: string;
  model: string;
  key?: string;
  extraHeaders?: Record<string, string>;
};

export type ImproveResult = GeneratedContent & {
  before: ContentScoreReport;
  after: ContentScoreReport;
  source: string;
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
        max_tokens: 900,
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

function stripFence(text: string) {
  return text
    .replace(/^```[\w]*\n?|\n?```$/g, "")
    .replace(/\b(lorem ipsum|mockup|placeholder|TODO)\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function polish(text: string): Promise<{ text: string; notes: string[] }> {
  const notes: string[] = [];
  let next = text;
  try {
    const vocab = await expandVagueVocabulary(next);
    const keys = Object.keys(vocab);
    for (const key of keys.slice(0, 4)) {
      const swap = vocab[key]?.find((w) => w.length >= 3 && w.length <= 16 && w.toLowerCase() !== key.toLowerCase());
      if (!swap) continue;
      const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(next)) {
        next = next.replace(re, swap);
        notes.push(`Datamuse: ${key} → ${swap}`);
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const matches = await checkLanguageTool(next);
    const usable = [...matches]
      .filter((m) => m.replacements[0] && m.length > 0)
      .sort((a, b) => b.offset - a.offset)
      .slice(0, 12);
    if (usable.length) {
      for (const m of usable) {
        next = next.slice(0, m.offset) + m.replacements[0] + next.slice(m.offset + m.length);
      }
      notes.push(`LanguageTool: ${usable.length} fix(es)`);
    }
  } catch {
    /* ignore */
  }
  return { text: stripFence(next), notes };
}

function packThread(source: string): string {
  const raw = source
    .replace(/^(hook|context|insight|summary|implication)\s*:\s*/gim, "")
    .trim();
  const pieces = raw
    .split(/\n+/)
    .flatMap((p) => p.split(/(?<=[.!?])\s+/))
    .map((p) => p.trim())
    .filter((p) => p.length > 1 && !/^[-•*]\s*$/.test(p));

  const tweets: string[] = [];
  let buf = "";
  const push = () => {
    const t = buf.trim();
    if (t) tweets.push(t);
    buf = "";
  };
  for (const piece of pieces) {
    const candidate = buf ? `${buf} ${piece}` : piece;
    if (candidate.length <= 240) {
      buf = candidate;
      continue;
    }
    if (buf) push();
    if (piece.length <= 270) {
      buf = piece;
    } else {
      const cut = piece.slice(0, 250);
      const at = Math.max(cut.lastIndexOf(" "), 180);
      tweets.push(cut.slice(0, at).trim());
      buf = piece.slice(at).trim();
    }
  }
  push();

  while (tweets.length > 8) {
    const last = tweets.pop()!;
    const prev = tweets[tweets.length - 1]!;
    if ((prev + " " + last).length <= 270) tweets[tweets.length - 1] = `${prev} ${last}`;
    else tweets.push(last.slice(0, 260));
  }
  if (tweets.length < 3 && raw.length > 80) {
    const mid = Math.ceil(pieces.length / 3) || 1;
    const rebuilt = [
      pieces.slice(0, mid).join(" "),
      pieces.slice(mid, mid * 2).join(" "),
      pieces.slice(mid * 2).join(" "),
    ].filter(Boolean);
    return packThread(rebuilt.join("\n"));
  }

  const n = Math.max(tweets.length, 1);
  if (tweets.length && !/[?]$/.test(tweets[tweets.length - 1]!)) {
    tweets[tweets.length - 1] = `${tweets[tweets.length - 1]} What's your read?`;
    if (tweets[tweets.length - 1]!.length > 280) {
      tweets[tweets.length - 1] = tweets[tweets.length - 1]!.replace(/\s+What's your read\?$/, "");
    }
  }
  return tweets.map((t, i) => `${i + 1}/ ${t.replace(/^\d+\s*[/.)-]\s*/, "")}`).join("\n\n");
}

function localImprove(text: string, kind: ContentKind): string {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return text;
  const hook = lines.reduce((a, b) => (b.length < a.length && b.length >= 24 ? b : a), lines[0]!);
  const rest = lines.filter((l) => l !== hook);
  const body = [hook.replace(/^(hook|context):\s*/i, ""), ...rest]
    .join(kind === "post" ? "\n\n" : "\n\n")
    .replace(/\b(it's important to note that|in today's rapidly evolving)\b/gi, "")
    .trim();
  return kind === "thread" ? packThread(body) : body;
}

async function writeWithLlm(system: string, user: string): Promise<{ text: string; source: string } | null> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  for (const provider of providers()) {
    const raw = await chatComplete(provider, messages, 0.85);
    if (raw && raw.length >= 60) return { text: stripFence(raw), source: provider.id };
  }
  return null;
}

export async function improveDraftCopy(text: string, kind: ContentKind): Promise<ImproveResult> {
  const before = scoreContent(text, kind);
  const weak = before.dimensions
    .filter((d) => d.score < 72)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((d) => `${d.label} (${d.score}): ${d.note}`);

  const live = await writeWithLlm(
    [
      "You are a senior X copy editor. Rewrite the draft into a finished piece people can publish.",
      kind === "thread"
        ? "Output a numbered thread 1/ 2/ 3/. Each tweet under 270 characters. No Hook:/Context: labels."
        : kind === "article"
          ? "Output a tight long-form note with a title and short sections."
          : "Output one X post. Short lines. Strong first sentence.",
      "Keep every concrete fact, number, name, ticker, URL, and contract. Do not invent new metrics.",
      "Banned: 100x, guaranteed, to the moon, ape in, lorem, mockup, as an AI.",
      "Output only the rewritten text.",
    ].join(" "),
    `Kind: ${kind}\nScore now: ${before.total}/100\nFix these first:\n${weak.join("\n")}\n\nDRAFT:\n${text}`,
  );

  const base = live?.text ?? localImprove(text, kind);
  const polished = await polish(kind === "thread" && !/^\s*1\s*\//.test(base) ? packThread(base) : base);
  const after = scoreContent(polished.text, kind);
  const chosen = after.total >= before.total - 1 ? polished.text : localImprove(text, kind);
  const finalScore = scoreContent(chosen, kind);

  return {
    kind,
    angle: {
      id: "why",
      label: "Improved draft",
      focus: "Raise the weakest score dimensions without inventing facts.",
      why: "Editing beats generating from scratch when a draft already exists.",
    },
    text: chosen,
    score: finalScore,
    before,
    after: finalScore,
    source: live?.source ?? "local",
    applied: [
      `Writer: ${live?.source ?? "local packer"}`,
      `Score ${before.total} → ${finalScore.total}`,
      ...polished.notes,
      ...finalScore.improvements.slice(0, 3),
    ],
  };
}

export async function threadifyDraftCopy(text: string): Promise<ImproveResult> {
  const { buildPublishThread } = await import("./thread-builder");
  return buildPublishThread(text);
}
      "Turn the draft into a publish-ready X thread.",
      "5 to 7 tweets, numbered 1/ 2/ 3/.",
      "Tweet 1 is the hook. Middle tweets each carry one proof or turn. Last tweet is the close or question.",
      "Each tweet under 270 characters. No outline labels. Keep all real facts and links.",
      "Output only the thread.",
    ].join(" "),
    text,
  );
  const packed = packThread(live?.text ?? text);
  const polished = await polish(packed);
  const after = scoreContent(polished.text, "thread");

  return {
    kind: "thread",
    angle: {
      id: "story",
      label: "Thread",
      focus: "One idea per tweet, numbered, under 280.",
      why: "A thread that reads as posts, not as an outline.",
    },
    text: polished.text,
    score: after,
    before,
    after,
    source: live?.source ?? "local",
    applied: [
      `Writer: ${live?.source ?? "local thread packer"}`,
      `Score ${before.total} → ${after.total}`,
      ...polished.notes,
      ...after.improvements.slice(0, 3),
    ],
  };
}

export async function strongerHookCopy(text: string, kind: ContentKind): Promise<ImproveResult> {
  const before = scoreContent(text, kind);
  const live = await writeWithLlm(
    "Rewrite only the opening line of this draft so it stops the scroll. Then keep the rest, lightly tightened. Keep facts. Output the full piece only.",
    text,
  );
  const next = live?.text ?? localImprove(text, kind);
  const polished = await polish(next);
  const after = scoreContent(polished.text, kind);
  return {
    kind,
    angle: {
      id: "breaking",
      label: "Stronger hook",
      focus: "First line does the work.",
      why: "Readers decide in one glance.",
    },
    text: polished.text,
    score: after,
    before,
    after,
    source: live?.source ?? "local",
    applied: [`Writer: ${live?.source ?? "local"}`, `Score ${before.total} → ${after.total}`, ...polished.notes],
  };
}
