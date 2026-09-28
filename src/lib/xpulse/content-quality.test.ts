import test from "node:test";
import assert from "node:assert/strict";
import { generateFromFactSet, type TokenFactSet } from "./content-create.ts";
import { buildEditorialSystemPrompt, EDITORIAL_ENGINE_BASELINE, EDITORIAL_ENGINE_VERSION, validateEditorialShape, preferenceSignature } from "./editorial-standard.ts";

function makeFacts(state: TokenFactSet["market"]["state"] = "POSITIVE"): TokenFactSet {
  const severe = state === "SEVERE_RISK";
  return {
    identity: {
      name: "Example Token",
      symbol: "EXT",
      chain: "Solana",
      address: "ExampleContract11111111111111111111111111111111",
    },
    metrics: [
      { key: "price", value: severe ? "$0.00001" : "$0.0123" },
      { key: "change_24h", value: severe ? "-96.0%" : "+18.4%" },
      { key: "liquidity", value: severe ? "$6.0K" : "$185.0K" },
      { key: "volume_24h", value: "$640.0K" },
      { key: "market_cap", value: "$2.40M" },
      { key: "cap_band", value: "small-cap" },
      { key: "trades_24h", value: "620 buys / 410 sells" },
    ],
    findings: [
      "24h volume is 3.5× liquidity — elevated turnover.",
      "Buy flow is stronger than sell flow in the returned snapshot.",
    ],
    story: severe
      ? "EXT is in severe risk territory on this snapshot."
      : "EXT is showing constructive momentum, but the signal is still a snapshot.",
    risks: severe
      ? ["Liquidity is extremely thin at $6.0K."]
      : ["XPulse risk score is a reading of this snapshot, not an official market rating."],
    dexPaid: "paid",
    boosts: 3,
    xPatterns: ["Concrete opening", "Contrarian framing"],
    xNote: "Public X sample is available.",
    market: {
      state,
      riskScore: severe ? 86 : 24,
      riskBand: severe ? "critical" : "moderate",
      signals: [
        {
          type: "price_window",
          severity: severe ? "critical" : "low",
          polarity: severe ? "risk" : "support",
          value: severe ? -96 : 18.4,
          explanation: severe
            ? "Price is down 96.0% over 24h."
            : "Price is up 18.4% over 24h.",
          basis: "fact",
        },
        {
          type: "volume_liquidity",
          severity: "medium",
          polarity: severe ? "risk" : "context",
          value: 3.5,
          explanation: "24h volume is 3.5× liquidity — elevated turnover.",
          basis: "derived",
        },
      ],
      facts: severe
        ? [
            "Price is down 96.0% over 24h.",
            "Last price is $0.00001.",
            "Market cap is $2.40M.",
            "Liquidity is extremely thin at $6.0K.",
            "24h volume is 3.5× liquidity — elevated turnover.",
          ]
        : [
            "Price is up 18.4% over 24h.",
            "Last price is $0.0123.",
            "Market cap is $2.40M.",
            "Liquidity is comparatively healthy at $185.0K.",
            "24h volume is 3.5× liquidity — elevated turnover.",
          ],
      conclusions: severe
        ? ["The snapshot shows severe market deterioration."]
        : ["The move is constructive, but volume turnover is elevated versus liquidity."],
      caveats: [
        "XPulse risk score is a reading of this snapshot, not an official market rating.",
        "Missing fields were not estimated.",
      ],
      rugPullRisk: severe ? "unconfirmed" : "low",
      headline: severe
        ? "EXT is in severe risk territory on this snapshot."
        : "EXT is showing constructive momentum in the measured window.",
      rugLine: severe
        ? "The drawdown is a severe risk signal, not proof of a rug pull."
        : null,
      window: "24h",
      worstChange: severe ? -96 : 18.4,
    },
    builtAt: "2026-09-28T00:00:00.000Z",
  };
}

function beats(text: string): string[] {
  return text.split(/\n\s*\n/).filter(Boolean);
}

test("fallback post synthesizes a thesis instead of dumping the raw metric list", () => {
  const result = generateFromFactSet(makeFacts(), "post");
  assert.ok(result.text.length > 350);
  assert.ok(result.text.includes("constructive momentum"));
  assert.ok(!result.text.includes("Price:"));
  assert.ok(result.text.includes("3.5× liquidity"));
});

test("fallback thread has progression and no outline labels", () => {
  const result = generateFromFactSet(makeFacts(), "thread");
  const rows = beats(result.text);
  assert.ok(rows.length >= 8);
  assert.ok(rows.every((row, index) => row.startsWith((index + 1) + "/ ")));
  assert.ok(rows.every((row) => row.length <= 280));
  assert.ok(!/\b(?:Hook|Context|Insight|Summary|Implication):/i.test(result.text));
  assert.ok(result.text.includes("3.5× liquidity"));
  assert.ok(result.text.includes("constructive momentum"));
});

test("fallback article develops an argument with interpretation", () => {
  const result = generateFromFactSet(makeFacts(), "article");
  assert.ok(result.text.length > 1800);
  assert.ok(result.text.includes("The setup"));
  assert.ok(result.text.includes("Where the signals connect"));
  assert.ok(result.text.includes("Bottom line"));
  assert.ok(result.text.includes("3.5× liquidity"));
});

test("severe risk remains visible in fallback writing", () => {
  const result = generateFromFactSet(makeFacts("SEVERE_RISK"), "thread");
  assert.ok(result.text.includes("severe"));
  assert.ok(result.text.includes("96.0%"));
  assert.ok(!/exciting opportunity|could explode|strong opportunity/i.test(result.text));
});


test("global editorial standard is format-specific, versioned, and preference-aware", () => {
  assert.equal(EDITORIAL_ENGINE_VERSION, "v1.0");
  assert.equal(EDITORIAL_ENGINE_BASELINE, "v1.0");
  const post = buildEditorialSystemPrompt("post", { tone: "technical", audience: "builders" });
  const thread = buildEditorialSystemPrompt("thread", { tone: "technical", audience: "builders" });
  const article = buildEditorialSystemPrompt("article", { tone: "technical", audience: "builders" });
  assert.notEqual(post, thread);
  assert.notEqual(thread, article);
  assert.match(post, /TONE: technical/);
  assert.match(post, /AUDIENCE: builders/);
  assert.match(preferenceSignature({ format: "thread", tone: "human", variant: 3 }), /tone:human/);
  assert.match(preferenceSignature({ format: "thread", tone: "human", variant: 3 }), /variant:3/);
});

test("global quality gate rejects generic AI language and shallow threads", () => {
  const badPost = validateEditorialShape("In today's rapidly evolving Web3 landscape, let's dive in.", "post");
  assert.equal(badPost.pass, false);
  const badThread = validateEditorialShape("1/ First beat.\n\n2/ Second beat.\n\n3/ Third beat.", "thread");
  assert.equal(badThread.pass, false);
  assert.ok(badThread.violations.includes("thread_needs_progression"));
});

test("draft generator keeps format identity and avoids outline-label threads", () => {
  const draft =
    "$EXT is up 18.4% over 24h. Liquidity is $185K. Volume is $640K. The move is constructive but turnover is elevated versus liquidity. Watch the relationship between price and liquidity.";
  const thread = generateFromFactSet(makeFacts(), "thread");
  assert.match(thread.text, /^1\//);
  assert.doesNotMatch(thread.text, /^(?:Hook|Context|Insight|Summary|Implication):/m);
  const postGate = validateEditorialShape(
    generateFromFactSet(makeFacts(), "post").text,
    "post",
  );
  assert.equal(postGate.pass, true);
});
