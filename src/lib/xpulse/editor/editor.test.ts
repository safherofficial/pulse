import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { baselineContent } from "../optimize/baseline.ts";
import { BENCHMARKS } from "../optimize/benchmarks.ts";
import type { ContentRule } from "../optimize/types.ts";
import { detectFormat, detectLanguage, extractEntities } from "./detect.ts";
import { diffLines } from "./diff.ts";
import { parseEditorHandoff, runEditorPipeline } from "./pipeline.ts";
import { clearEditorCache, executeEditor, readEditorUrl, splitEditorInput } from "./server.ts";
import { classifyUrl, clearUrlCache, extractPublicPage, readPublicHtml } from "./url.ts";

const weak = BENCHMARKS.find((item) => item.id === "weak-post")!.text;
const strong = BENCHMARKS.find((item) => item.id === "strong-post")!.text;
const bearish = BENCHMARKS.find((item) => item.id === "bearish-post")!.text;

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function numbers(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?%?/g) ?? []).filter((token) => token.length >= 2);
}

test("navigation no longer exposes the Intelligence workspace", () => {
  const nav = read("../../../components/top-nav.tsx");
  const shell = read("../../../components/intel/WorkspaceShell.tsx");
  const home = read("../../../routes/index.tsx");
  const tokens = read("../../../routes/tokens.tsx");
  assert.equal(nav.includes("/research"), false);
  assert.equal(nav.includes("Intelligence"), false);
  assert.equal(shell.includes("/research"), false);
  assert.equal(shell.includes("Intelligence"), false);
  assert.match(nav, /Token/);
  assert.match(nav, /Analyze/);
  assert.match(nav, /Your Chamber/);
  assert.match(shell, /label: "Token"/);
  assert.match(shell, /label: "Analyze"/);
  assert.match(shell, /label: "Your Chamber"/);
  assert.equal(shell.includes('label: "Home"'), false);
  assert.equal(shell.includes('label: "Research"'), false);
  assert.equal(home.includes('kicker: "Intelligence"'), false);
  assert.equal(existsSync(new URL("../../../routes/research.tsx", import.meta.url)), false);
  assert.equal(read("../../../routeTree.gen.ts").toLowerCase().includes("research"), false);
  assert.match(tokens, /Viral Intelligence/);
  assert.match(tokens, /Open in Analyze/);
});

test("detects language, format, and entities without translating", () => {
  const italian = "Questo mercato non è una opportunità per chi cerca un rialzo senza numeri.";
  assert.equal(detectLanguage(italian), "it");
  assert.equal(detectLanguage("the market is flat and this is for your desk"), "en");
  assert.equal(detectFormat("1/ First beat\n\n2/ Second beat\n\n3/ Third beat"), "thread");
  assert.equal(detectFormat("short headline"), "headline");
  const entities = extractEntities("Watch $EX and @desk https://x.com/a/status/1");
  assert.deepEqual(entities.tickers, ["$EX"]);
  assert.deepEqual(entities.mentions, ["@desk"]);
  assert.equal(entities.urls.length, 1);
});

test("scores a weak draft up and leaves a strong draft unchanged", () => {
  const improved = runEditorPipeline({ text: weak, mode: "IMPROVE" });
  assert.ok(improved.score.improved.total > improved.score.original.total);
  assert.equal(improved.score.delta, improved.score.improved.total - improved.score.original.total);
  assert.equal(improved.output.source, "deterministic");
  for (const token of numbers(improved.output.text)) {
    assert.ok(weak.includes(token), token);
  }
  const kept = runEditorPipeline({ text: strong, mode: "IMPROVE" });
  assert.equal(kept.output.keptOriginal, true);
  assert.equal(kept.output.text, strong);
  assert.equal(kept.score.delta, 0);
});

test("keeps bearish facts, tickers, and language", () => {
  const text = `${bearish}\n\n$EX stays the ticker.`;
  const dossier = runEditorPipeline({ text, mode: "REWRITE" });
  assert.match(dossier.output.text, /down 32\.0%/);
  assert.match(dossier.output.text, /\$EX/);
  assert.equal(dossier.validation.factsPreserved, true);
  assert.equal(dossier.validation.promoAdded, false);
  assert.doesNotMatch(dossier.output.text, /exciting opportunity|to the moon|could explode/i);
  const italian = "Questo mercato non è una opportunità per chi cerca soltanto rumore. La liquidità è bassa.";
  const local = runEditorPipeline({ text: italian, mode: "IMPROVE" });
  assert.equal(local.input.language, "it");
  assert.equal(local.validation.languageKept, true);
  assert.match(local.output.text, / non | per | una /);
});

test("builds a concrete plan and a real diff", () => {
  const dossier = runEditorPipeline({ text: weak, mode: "ANALYZE" });
  assert.equal(dossier.output.text, weak.trim());
  assert.ok(dossier.plan.length > 0);
  for (const item of dossier.plan) {
    assert.ok(["KEEP", "IMPROVE", "REMOVE", "ADD", "VERIFY"].includes(item.action));
    assert.ok(item.reason.length > 12);
    assert.ok(["low", "medium", "high"].includes(item.expectedImpact));
    assert.equal(typeof item.priority, "number");
  }
  assert.ok(dossier.plan.some((item) => item.action === "REMOVE"));
  const diff = diffLines("same\nold line", "same\nnew line");
  assert.ok(diff.some((mark) => mark.type === "removed" && mark.text === "old line"));
  assert.ok(diff.some((mark) => mark.type === "added" && mark.text === "new line"));
});

test("post, thread, and article modes do not share one format", () => {
  const text = "The pool is thin.\n\nSells are leading.\n\nThe 24h change is -32.0%.";
  const post = runEditorPipeline({ text, mode: "MAKE_POST" });
  const thread = runEditorPipeline({ text, mode: "MAKE_THREAD" });
  const article = runEditorPipeline({ text, mode: "MAKE_ARTICLE" });
  assert.equal(post.output.kind, "post");
  assert.equal(thread.output.kind, "thread");
  assert.equal(article.output.kind, "article");
  assert.match(thread.output.text, /1\//);
  assert.equal(runEditorPipeline({ text: bearish, mode: "FACT_CHECK" }).output.keptOriginal, true);
});

test("an active viral pattern cannot overwrite a drawdown", () => {
  const logic = baselineContent();
  const learned: ContentRule = {
    ruleId: "rule:learned:hook",
    version: 2,
    weight: 1,
    confidence: "HIGH",
    status: "ACTIVE",
    lastUpdated: "1970-01-01T00:00:00.000Z",
    successRate: 1,
    sampleCount: 24,
    scoreImpact: 1,
    rollbackVersion: 1,
    appliesTo: ["post", "thread", "article"],
    lever: "observe_only",
    description: "Measured question openings. Does not add a claim.",
    patternId: "HOOK_QUESTION",
    learned: true,
  };
  logic.rules.push(learned);
  const dossier = runEditorPipeline({ text: bearish, mode: "IMPROVE", logic });
  assert.match(dossier.analysis.viral.join(" "), /HOOK_QUESTION/);
  assert.match(dossier.output.text, /down 32\.0%/);
  assert.equal(dossier.validation.factsPreserved, true);
});

test("classifies URLs and fails closed when a page cannot be read", async () => {
  assert.equal(classifyUrl("https://x.com/user/status/123")?.kind, "x");
  assert.equal(classifyUrl("https://dexscreener.com/solana/abc")?.kind, "token");
  assert.equal(classifyUrl("https://example.com/blog/market-note")?.kind, "article");
  assert.equal(classifyUrl("not a url"), null);
  const html = `<html><head><meta property="og:title" content="Desk note"><meta property="og:description" content="Liquidity printed 180000 and the move is already in the draft."></head><body><p>${"Public paragraph with enough characters to keep.".padEnd(80, " x")}</p></body></html>`;
  const read = readPublicHtml(html);
  assert.equal(read.title, "Desk note");
  assert.match(read.text ?? "", /180000/);
  clearUrlCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(html, { status: 200 });
  };
  const first = await extractPublicPage("https://example.com/blog/note", fetchImpl);
  const second = await extractPublicPage("https://example.com/blog/note", fetchImpl);
  assert.equal(first.status, "extracted");
  assert.equal(second.status, "extracted");
  assert.equal(calls, 1);
  clearUrlCache();
  const blocked = await extractPublicPage("https://example.com/private", async () => {
    throw new Error("blocked");
  });
  assert.equal(blocked.status, "unavailable");
  assert.equal(blocked.text, null);
  const invalid = await extractPublicPage("not a url");
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.text, null);
});

test("X URL failure does not invent a post", async () => {
  const row = await readEditorUrl("https://x.com/user/status/123", {
    resolveX: async () => {
      throw new Error("blocked");
    },
  });
  assert.equal(row.kind, "x");
  assert.equal(row.status, "unavailable");
  assert.equal(row.text, null);
  clearEditorCache();
  const dossier = await executeEditor(
    { url: "https://x.com/user/status/123", mode: "ANALYZE" },
    {
      loadLogic: async () => baselineContent(),
      rewrite: null,
      resolveX: async () => {
        throw new Error("blocked");
      },
    },
  );
  assert.equal(dossier.input.text, "");
  assert.equal(dossier.url?.text, null);
});

test("provider failure and rejected rewrites fall back to the measured draft", async () => {
  clearEditorCache();
  const down = await executeEditor(
    { text: weak, mode: "IMPROVE" },
    {
      loadLogic: async () => baselineContent(),
      rewrite: async () => {
        throw new Error("provider down");
      },
    },
  );
  assert.equal(down.output.source, "deterministic");
  assert.match(down.output.notes.join(" "), /unavailable|Deterministic/);
  clearEditorCache();
  const flipped = await executeEditor(
    { text: bearish, mode: "REWRITE" },
    {
      loadLogic: async () => baselineContent(),
      polish: async (text) => ({ text, notes: [] }),
      rewrite: async () => ({ text: "This is an exciting opportunity and could explode from here.", source: "groq" }),
    },
  );
  assert.match(flipped.output.text, /down 32\.0%/);
  assert.equal(flipped.output.source, "deterministic");
  assert.equal(flipped.validation.promoAdded, false);
  clearEditorCache();
  let calls = 0;
  await executeEditor(
    { text: strong, mode: "SCORE" },
    {
      loadLogic: async () => baselineContent(),
      rewrite: async () => {
        calls += 1;
        return { text: strong, source: "groq" };
      },
    },
  );
  await executeEditor(
    { text: strong, mode: "SCORE" },
    {
      loadLogic: async () => baselineContent(),
      rewrite: async () => {
        calls += 1;
        return { text: strong, source: "groq" };
      },
    },
  );
  assert.equal(calls, 0);
});

test("token handoff keeps market context out of the scored draft", () => {
  const parsed = parseEditorHandoff(
    JSON.stringify({
      text: bearish,
      kind: "post",
      token: {
        symbol: "EX",
        name: "Example",
        address: "So11111111111111111111111111111111111111112",
        state: "BEARISH",
        headline: "EX is down 32.0% over 24h.",
        rugLine: null,
      },
      at: "2026-09-28T00:00:00.000Z",
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed?.token?.state, "BEARISH");
  assert.equal(parsed?.kind, "post");
  assert.equal(splitEditorInput(bearish, "").url, "");
  assert.equal(parseEditorHandoff("not-json"), null);
});
