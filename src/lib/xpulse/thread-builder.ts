/**
 * Publish-ready X thread builder.
 * Facts come only from: the user draft, DexScreener/token-intel,
 * official links on the token, and VxTwitter when an X URL is present.
 * No invented prices, percentages, or names.
 */

import { fetchVxTwitterStatus, checkLanguageTool } from "./public-apis";
import { scoreContent, type ContentScoreReport } from "./content-score";
import { buildEditorialSelfCritiquePrompt, buildEditorialSystemPrompt, EDITORIAL_ENGINE_VERSION, validateEditorialShape } from "./editorial-standard";
import {
  detectTokenInput,
  explorerUrl,
  researchToken,
  researchTokenByAddress,
  type TokenIntel,
} from "./token-intel";
import type { ImproveResult } from "./content-improve";

const SOL_CA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const EVM_CA = /\b0x[a-fA-F0-9]{40}\b/g;
const TICKER = /\$[A-Za-z][A-Za-z0-9]{1,14}\b/g;
const X_STATUS = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/status\/(\d+)/gi;
const ANY_URL = /https?:\/\/[^\s)]+/gi;
const TWEET_MAX = 270;

type FactLine = { source: string; line: string };

type ThreadBrief = {
  draft: string;
  facts: FactLine[];
  allowedNumbers: Set<string>;
  tickers: string[];
  addresses: string[];
  officialUrls: string[];
  xPosts: Array<{ author: string; text: string; url: string }>;
  intel: TokenIntel | null;
};

function usd(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function price(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(2)}`;
}

function pct(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (!key) continue;
    const id = key.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(key);
  }
  return out;
}

function extractNumbers(text: string): string[] {
  return (text.match(/[+-]?\d+(?:[.,]\d+)?%?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

type Provider = {
  id: string;
  url: string;
  model: string;
  key?: string;
  extraHeaders?: Record<string, string>;
};

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

async function chatComplete(provider: Provider, system: string, user: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 16_000);
  const started = Date.now();
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
        temperature: 0.25,
        max_tokens: 900,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
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
    const output = text?.trim() ? text.trim() : null;
    if (process.env.XPULSE_LLM_DEBUG === "1") console.info("[XPULSE_LLM]", JSON.stringify({ provider: provider.id, model: provider.model, durationMs: Date.now() - started, attempt: 1, rawOutput: output ?? "" }));
    return output;
  } catch (error) {
    if (process.env.XPULSE_LLM_DEBUG === "1") console.info("[XPULSE_LLM]", JSON.stringify({ provider: provider.id, model: provider.model, durationMs: Date.now() - started, attempt: 1, rawOutput: "", error: error instanceof Error ? error.message : "LLM request failed" }));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function collectAddresses(text: string): string[] {
  const evm = text.match(EVM_CA) ?? [];
  const sol = (text.match(SOL_CA) ?? []).filter((a) => !a.startsWith("http") && a.length >= 32);
  return unique([...evm, ...sol]);
}

function collectTickers(text: string): string[] {
  return unique((text.match(TICKER) ?? []).map((t) => t.slice(1).toUpperCase()));
}

function collectXUrls(text: string): Array<{ user: string; id: string; url: string }> {
  const out: Array<{ user: string; id: string; url: string }> = [];
  const re = new RegExp(X_STATUS.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ user: m[1]!, id: m[2]!, url: m[0]! });
  }
  return out;
}

async function resolveIntel(text: string): Promise<{ intel: TokenIntel | null; notes: string[] }> {
  const notes: string[] = [];
  const addresses = collectAddresses(text);
  for (const address of addresses.slice(0, 2)) {
    try {
      const row = await researchTokenByAddress(address);
      if (row) {
        notes.push(`DexScreener pair for ${row.identity.symbol}`);
        return { intel: row, notes };
      }
    } catch {
      notes.push(`Address lookup failed for ${address.slice(0, 6)}…`);
    }
  }

  const tickers = collectTickers(text);
  const fallbackNames = tickers.length
    ? tickers
    : text
        .split(/[^\w$]+/)
        .map((w) => w.trim())
        .filter((w) => /^[A-Z]{2,10}$/.test(w) || /^\$[A-Za-z]{2,10}$/.test(w))
        .slice(0, 3);

  for (const name of unique([...tickers, ...fallbackNames]).slice(0, 3)) {
    try {
      const result = await researchToken(name.startsWith("$") ? name.slice(1) : name);
      if (result.kind === "single") {
        notes.push(`DexScreener match for ${result.intel.identity.symbol}`);
        return { intel: result.intel, notes };
      }
      if (result.kind === "choices" && result.hits[0]) {
        const row = await researchTokenByAddress(result.hits[0].address);
        if (row) {
          notes.push(`DexScreener top hit for ${name}`);
          return { intel: row, notes };
        }
      }
    } catch {
      notes.push(`Ticker lookup failed for ${name}`);
    }
  }

  return { intel: null, notes };
}

function intelFacts(intel: TokenIntel): FactLine[] {
  const { identity, market, analysis } = intel;
  const lines: FactLine[] = [];
  const add = (source: string, line: string | null | undefined) => {
    if (line && line.trim() && line !== "Data unavailable") lines.push({ source, line: line.trim() });
  };

  add("token", `${identity.name} ($${identity.symbol}) on ${identity.chain}`);
  add("token", `CA ${identity.address}`);
  add("DexScreener", price(market.priceUsd) ? `Price ${price(market.priceUsd)}` : null);
  add("DexScreener", pct(market.priceChange24h) ? `24h ${pct(market.priceChange24h)}` : null);
  add("DexScreener", pct(market.priceChange6h) ? `6h ${pct(market.priceChange6h)}` : null);
  add("DexScreener", pct(market.priceChange1h) ? `1h ${pct(market.priceChange1h)}` : null);
  add("DexScreener", usd(market.marketCap) ? `Market cap ${usd(market.marketCap)}` : null);
  add("DexScreener", usd(market.liquidityUsd) ? `Liquidity ${usd(market.liquidityUsd)}` : null);
  add("DexScreener", usd(market.volume24h) ? `24h volume ${usd(market.volume24h)}` : null);
  add("DexScreener", market.dexId ? `DEX ${market.dexId}` : null);
  if (market.buys24h != null || market.sells24h != null) {
    add("DexScreener", `24h buys/sells ${market.buys24h ?? "—"}/${market.sells24h ?? "—"}`);
  }
  if (market.dexPaid === true) add("DexScreener", "DEX paid listing is active");
  if (market.dexPaid === false) add("DexScreener", "DEX paid listing is not active");
  add("token", analysis.snapshot);
  add("token", analysis.liquidity);
  add("token", analysis.activity);
  for (const risk of analysis.risks.slice(0, 3)) add("token", `Flag: ${risk}`);
  add("official", identity.website);
  add("official", identity.twitter);
  add("DexScreener", market.pairUrl);
  add("explorer", explorerUrl(identity.address, identity.chain));
  return lines;
}

function draftClaims(draft: string): FactLine[] {
  return draft
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-•*]|\d+\s*[/.)-])\s*/, "").trim())
    .filter((line) => line.length >= 8)
    .slice(0, 10)
    .map((line) => ({ source: "draft", line }));
}

async function loadXPosts(text: string): Promise<{ posts: ThreadBrief["xPosts"]; notes: string[] }> {
  const notes: string[] = [];
  const posts: ThreadBrief["xPosts"] = [];
  for (const row of collectXUrls(text).slice(0, 3)) {
    try {
      const status = await fetchVxTwitterStatus(row.id);
      if (status?.text) {
        posts.push({
          author: status.user_screen_name ? `@${status.user_screen_name}` : `@${row.user}`,
          text: status.text.replace(/\s+/g, " ").trim(),
          url: row.url,
        });
        notes.push(`VxTwitter ${row.id}`);
      }
    } catch {
      notes.push(`X status ${row.id} unavailable`);
    }
  }
  return { posts, notes };
}

async function gatherBrief(draft: string): Promise<{ brief: ThreadBrief; notes: string[] }> {
  const notes: string[] = [];
  const [{ intel, notes: intelNotes }, x] = await Promise.all([resolveIntel(draft), loadXPosts(draft)]);
  notes.push(...intelNotes, ...x.notes);

  const facts: FactLine[] = [...draftClaims(draft)];
  if (intel) facts.push(...intelFacts(intel));
  for (const post of x.posts) {
    facts.push({ source: "X", line: `${post.author}: ${post.text.slice(0, 180)}` });
    facts.push({ source: "X", line: post.url });
  }

  const officialUrls = unique([
    ...(intel?.identity.website ? [intel.identity.website] : []),
    ...(intel?.identity.twitter ? [intel.identity.twitter] : []),
    ...(intel?.market.pairUrl ? [intel.market.pairUrl] : []),
    ...((draft.match(ANY_URL) ?? []) as string[]),
  ]).slice(0, 6);

  const allowedNumbers = new Set<string>();
  for (const item of [draft, ...facts.map((f) => f.line)]) {
    for (const n of extractNumbers(item)) allowedNumbers.add(n);
  }

  return {
    notes,
    brief: {
      draft: draft.trim(),
      facts,
      allowedNumbers,
      tickers: collectTickers(draft),
      addresses: collectAddresses(draft),
      officialUrls,
      xPosts: x.posts,
      intel,
    },
  };
}

function clipTweet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= TWEET_MAX) return clean;
  const cut = clean.slice(0, TWEET_MAX - 1);
  const at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf(","), 200);
  return `${cut.slice(0, at).trim()}`;
}

function numberTweets(tweets: string[]): string {
  return tweets
    .map((t, i) => `${i + 1}/ ${t.replace(/^\s*\d+\s*[/.)-]\s*/, "")}`)
    .join("\n\n");
}

function stripInvented(text: string, allowed: Set<string>): string {
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      const nums = extractNumbers(block);
      const extra = nums.filter((n) => {
        if (allowed.has(n)) return false;
        const abs = n.replace(/[+-]/, "");
        return ![...allowed].some((a) => a === abs || a.replace(/[+-]/, "") === abs);
      });
      if (!extra.length) return block;
      return block
        .replace(/[+-]?\d+(?:[.,]\d+)?%?/g, (m) => {
          const key = m.replace(/,/g, "");
          const abs = key.replace(/[+-]/, "");
          return allowed.has(key) || [...allowed].some((a) => a.replace(/[+-]/, "") === abs) ? m : "";
        })
        .replace(/\s{2,}/g, " ")
        .trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildFromFacts(brief: ThreadBrief): string[] {
  const tweets: string[] = [];
  const intel = brief.intel;
  const symbol = intel?.identity.symbol ?? brief.tickers[0] ?? null;
  const name = intel?.identity.name ?? symbol ?? "This";
  const chg = intel ? pct(intel.market.priceChange24h) : null;
  const px = intel ? price(intel.market.priceUsd) : null;

  const hookBits = [
    symbol ? `$${symbol}` : name,
    chg ? `24h ${chg}` : null,
    px ? `at ${px}` : null,
  ].filter(Boolean);
  const firstClaim = brief.facts.find((f) => f.source === "draft")?.line;
  tweets.push(
    clipTweet(
      hookBits.length >= 2
        ? `${hookBits[0]} ${hookBits.slice(1).join(" · ")}.`
        : firstClaim ?? `${name} — public snapshot, not a call.`,
    ),
  );

  if (intel) {
    const tape = [
      px ? `Price ${px}` : null,
      usd(intel.market.marketCap) ? `MC ${usd(intel.market.marketCap)}` : null,
      usd(intel.market.liquidityUsd) ? `Liq ${usd(intel.market.liquidityUsd)}` : null,
      usd(intel.market.volume24h) ? `Vol 24h ${usd(intel.market.volume24h)}` : null,
    ].filter(Boolean);
    if (tape.length) tweets.push(clipTweet(`DexScreener tape: ${tape.join(" · ")}.`));

    const flow = [
      pct(intel.market.priceChange1h) ? `1h ${pct(intel.market.priceChange1h)}` : null,
      pct(intel.market.priceChange6h) ? `6h ${pct(intel.market.priceChange6h)}` : null,
      intel.market.buys24h != null || intel.market.sells24h != null
        ? `buys/sells 24h ${intel.market.buys24h ?? "—"}/${intel.market.sells24h ?? "—"}`
        : null,
      intel.market.dexId ? `DEX ${intel.market.dexId}` : null,
    ].filter(Boolean);
    if (flow.length) tweets.push(clipTweet(flow.join(" · ") + "."));
  }

  const extraDraft = brief.facts
    .filter((f) => f.source === "draft")
    .map((f) => f.line)
    .filter((line) => !tweets.some((t) => t.includes(line.slice(0, 24))))
    .slice(0, 3);
  for (const line of extraDraft) tweets.push(clipTweet(line));

  if (brief.xPosts[0]) {
    tweets.push(
      clipTweet(
        `On X, ${brief.xPosts[0].author} posted: “${brief.xPosts[0].text.slice(0, 160)}”`,
      ),
    );
  }

  const flags = brief.facts.filter((f) => f.line.startsWith("Flag:")).slice(0, 2);
  if (flags.length) tweets.push(clipTweet(flags.map((f) => f.line.replace(/^Flag:\s*/, "")).join(" ")));

  const ca = intel?.identity.address ?? brief.addresses[0];
  const links = [
    intel?.market.pairUrl ? `Chart: ${intel.market.pairUrl}` : null,
    intel?.identity.twitter ? `Official X: ${intel.identity.twitter}` : null,
    intel?.identity.website ? `Site: ${intel.identity.website}` : null,
    ca ? `CA: ${ca}` : null,
  ].filter(Boolean);
  tweets.push(
    clipTweet(
      `${links.slice(0, 2).join(" ")} Snapshot only. Not financial advice.`,
    ),
  );

  return tweets.filter((t, i, arr) => t.length >= 12 && arr.findIndex((x) => x === t) === i).slice(0, 8);
}

function parseModelThread(raw: string): string[] {
  return raw
    .replace(/^```[\w]*\n?|\n?```$/g, "")
    .replace(/^(hook|context|insight|summary|implication)\s*:\s*/gim, "")
    .split(/\n\s*\n/)
    .flatMap((b) => b.split(/\n(?=\s*\d+\s*[/.)-])/))
    .map((b) => b.replace(/^\s*\d+\s*[/.)-]\s*/, "").trim())
    .filter((b) => b.length >= 8 && !/lorem|placeholder|mockup/i.test(b))
    .map(clipTweet)
    .slice(0, 8);
}

async function polishThread(text: string): Promise<string> {
  try {
    const matches = await checkLanguageTool(text);
    const usable = [...matches]
      .filter((m) => m.replacements[0] && m.length > 0)
      .sort((a, b) => b.offset - a.offset)
      .slice(0, 10);
    let next = text;
    for (const m of usable) {
      next = next.slice(0, m.offset) + m.replacements[0] + next.slice(m.offset + m.length);
    }
    return next;
  } catch {
    return text;
  }
}

export async function buildPublishThread(draft: string): Promise<ImproveResult> {
  const before = scoreContent(draft, "post");
  const { brief, notes } = await gatherBrief(draft);
  const factual = buildFromFacts(brief);

  const ledger = brief.facts.map((f) => `- [${f.source}] ${f.line}`).join("\n");
  let source = "fact-packer";
  let tweets = factual;

  for (const provider of providers()) {
    const raw = await chatComplete(
      provider,
      buildEditorialSystemPrompt(
        "thread",
        { format: "thread", mode: "THREADIFY" },
        [
          "Write a publish-ready X thread from the locked evidence and the user draft.",
          "Do not copy the order of the facts. Identify the central thesis, then build a progressive narrative.",
          "Opening creates a concrete reason to continue. Middle beats add evidence and explain relationships or tension. Ending delivers a useful takeaway.",
          "Use ONLY the locked facts and the user draft. Do not invent prices, percentages, volume, holders, names, links, quotes or events.",
          "Output 4 to 8 publishable tweets, each under 270 characters. Number them 1/ 2/ 3/. No Hook:/Context:/Insight: labels.",
          "Every tweet must have a function; remove filler and repeated facts.",
          buildEditorialSelfCritiquePrompt("thread"),
        ],
      ),
      "USER DRAFT:\n" + brief.draft + "\n\nLOCKED FACTS:\n" + (ledger || "(none beyond the draft)"),
    );    if (!raw) continue;
    const parsed = parseModelThread(raw);
    if (parsed.length >= 4) {
      tweets = parsed;
      source = provider.id;
      break;
    }
  }

  const cleaned = stripInvented(numberTweets(tweets.length ? tweets : factual), brief.allowedNumbers);
  const polished = await polishThread(cleaned);
  const candidateText = polished.trim() || numberTweets(factual);
  const gate = validateEditorialShape(candidateText, "thread");
  const finalText = gate.pass ? candidateText : numberTweets(factual);
  const after = scoreContent(finalText, "thread");

  return {
    kind: "thread",
    angle: {
      id: "data",
      label: "Publish thread",
      focus: "Draft + DexScreener + official links + X URLs. No invented tape.",
      why: "A thread is only publishable if every number already exists in the sources.",
    },
    text: finalText,
    score: after,
    before,
    after,
    source,
    applied: [
      `Editorial engine: ${EDITORIAL_ENGINE_VERSION}`,
      `Writer: ${source}`,
      intelNote(brief),
      ...notes.slice(0, 4),
      `Editorial gate: ${gate.pass ? "passed" : "fallback to fact-locked thread"}`,
      `Facts locked: ${brief.facts.length}`,
      `Score ${before.total} → ${after.total}`,
    ].filter(Boolean),
  };
}

function intelNote(brief: ThreadBrief): string {
  if (!brief.intel) return "No DexScreener match — thread stays inside the draft.";
  return `Market source: DexScreener · ${brief.intel.identity.symbol} · ${brief.intel.identity.chain}`;
}

export function previewTweets(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}
