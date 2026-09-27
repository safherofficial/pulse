import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyDexPaid, interpretDexOrdersHttp } from "./dex-paid.ts";
import {
  assembleTokenMentions,
  classifyMentionKind,
  normalizePublicMention,
  officialHandleFromUrl,
  type RawXStatus,
} from "./token-mentions.ts";
import {
  SCROLL_TOP_THRESHOLD,
  collapsibleAria,
  scrollPageToTop,
  shouldShowScrollTop,
  toggleOpen,
} from "./ui-behavior.ts";

function status(partial: Partial<RawXStatus> & { text: string }): RawXStatus {
  return {
    type: "status",
    id: "1234567890123456789",
    url: "https://x.com/bonk_inu/status/1234567890123456789",
    likes: 12,
    created_at: "Fri Sep 25 16:12:50 +0000 2026",
    author: { name: "BONK!!!", screen_name: "bonk_inu", verification: { verified: true } },
    ...partial,
  };
}

test("X mention keeps a real token post and drops a shared-word false positive", () => {
  const kept = normalizePublicMention(status({ text: "watching $BONK today" }), {
    symbol: "BONK",
    name: "Bonk",
    address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    officialHandle: "bonk_inu",
  });
  assert.ok(kept);
  assert.equal(kept?.author, "BONK!!!");
  assert.equal(kept?.handle, "bonk_inu");
  assert.equal(kept?.url, "https://x.com/bonk_inu/status/1234567890123456789");
  assert.equal(kept?.kind, "official");
  assert.equal(kept?.likes, 12);

  const dropped = normalizePublicMention(
    status({
      text: "Flyers send Bonk to the Phantoms",
      author: { name: "Sports", screen_name: "sportsdesk" },
      url: "https://x.com/sportsdesk/status/1234567890123456789",
    }),
    {
      symbol: "BONK",
      name: "Bonk",
      address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      officialHandle: "bonk_inu",
    },
  );
  assert.equal(dropped, null);
});

test("missing optional X metrics stay null", () => {
  const mention = normalizePublicMention(
    status({
      text: "BONK vs SHIB market cap",
      likes: undefined,
      created_at: undefined,
      author: { name: "", screen_name: "desk", verified: false },
      url: "https://x.com/desk/status/1234567890123456789",
    }),
    { symbol: "BONK", name: "Bonk", address: "addr", officialHandle: null },
  );
  assert.ok(mention);
  assert.equal(mention?.likes, null);
  assert.equal(mention?.at, null);
  assert.equal(mention?.verified, false);
  assert.equal(mention?.kind, "other");
  assert.equal(mention?.author, "desk");
});

test("mention availability distinguishes empty from a down provider", () => {
  const empty = assembleTokenMentions({
    symbol: "BONK",
    name: "Bonk",
    address: "addr",
    twitter: "https://x.com/bonk_inu",
    search: { state: "ok", statuses: [] },
    profiles: [{ state: "ok", statuses: [] }],
    now: "2026-09-27T00:00:00.000Z",
  });
  assert.equal(empty.availability, "empty");
  assert.equal(empty.totalFound, 0);
  assert.equal(empty.note, "No verified public X mentions found for this token right now.");

  const down = assembleTokenMentions({
    symbol: "BONK",
    name: "Bonk",
    address: "addr",
    twitter: null,
    search: { state: "unavailable" },
    profiles: [{ state: "unavailable" }],
    now: "2026-09-27T00:00:00.000Z",
  });
  assert.equal(down.availability, "unavailable");
  assert.equal(down.totalFound, null);
  assert.equal(down.items.length, 0);
  assert.match(down.note, /temporarily unavailable/i);
});

test("official handle parsing and neutral classification", () => {
  assert.equal(officialHandleFromUrl("https://twitter.com/bonk_inu"), "bonk_inu");
  assert.equal(officialHandleFromUrl("https://x.com/intent/tweet"), null);
  assert.equal(
    classifyMentionKind({ handle: "bonk_inu", officialHandle: "bonk_inu", verified: true }),
    "official",
  );
  assert.equal(
    classifyMentionKind({
      handle: "somekol",
      officialHandle: null,
      verified: false,
      catalog: {
        platform: "x",
        handle: "somekol",
        displayName: "Some KOL",
        profileUrl: "https://x.com/somekol",
        category: "creator",
        official: false,
        source: "catalog",
        verificationStatus: "unknown",
      },
    }),
    "kol",
  );
  assert.equal(
    classifyMentionKind({ handle: "desk", officialHandle: null, verified: true }),
    "verified",
  );
  assert.equal(
    classifyMentionKind({ handle: "desk", officialHandle: null, verified: false }),
    "other",
  );
});

test("DEX paid states stay separate from boosts and failures", () => {
  const paid = classifyDexPaid({
    ok: true,
    orders: [{ type: "tokenProfile", status: "approved" }],
    boosts: [],
    pairBoosts: null,
    chainSupported: true,
  });
  assert.equal(paid.dexPaid, true);
  assert.equal(paid.paidListing, true);
  assert.equal(paid.boostActive, 0);

  const takeover = classifyDexPaid({
    ok: true,
    orders: [{ type: "communityTakeover", status: "approved" }],
    boosts: [],
    pairBoosts: 4,
    chainSupported: true,
  });
  assert.equal(takeover.dexPaid, true);

  const notPaid = interpretDexOrdersHttp({
    status: 200,
    body: { orders: [], boosts: [] },
    pairBoosts: 9,
    chainSupported: true,
  });
  assert.equal(notPaid.dexPaid, false);
  assert.equal(notPaid.boostActive, 0);

  const pending = classifyDexPaid({
    ok: true,
    orders: [{ type: "tokenProfile", status: "processing" }],
    boosts: [],
    pairBoosts: null,
    chainSupported: true,
  });
  assert.equal(pending.dexPaid, null);

  const failed = interpretDexOrdersHttp({
    status: 503,
    body: { orders: [] },
    pairBoosts: 2,
    chainSupported: true,
  });
  assert.equal(failed.dexPaid, null);
  assert.equal(failed.boostActive, 2);
  assert.notEqual(failed.dexPaid, false);

  const malformed = interpretDexOrdersHttp({
    status: 200,
    body: { unexpected: true },
    pairBoosts: null,
    chainSupported: true,
  });
  assert.equal(malformed.dexPaid, null);
  assert.equal(malformed.boostActive, null);

  const boostOnly = classifyDexPaid({
    ok: true,
    orders: [],
    boosts: [{ amount: 30 }],
    pairBoosts: null,
    chainSupported: true,
  });
  assert.equal(boostOnly.dexPaid, false);
  assert.equal(boostOnly.boostActive, 30);
  assert.equal(boostOnly.paidListing, false);

  const unsupported = classifyDexPaid({
    ok: true,
    orders: [],
    boosts: [],
    pairBoosts: null,
    chainSupported: false,
  });
  assert.equal(unsupported.dexPaid, null);
});

test("collapsible aria and scroll-to-top contract", () => {
  assert.equal(toggleOpen(false), true);
  assert.equal(toggleOpen(true), false);
  const openAria = collapsibleAria(true, "section-1");
  const closedAria = collapsibleAria(false, "section-1");
  assert.equal(openAria["aria-expanded"], true);
  assert.equal(closedAria["aria-expanded"], false);
  assert.equal(openAria["aria-controls"], "section-1");

  assert.equal(shouldShowScrollTop(0), false);
  assert.equal(shouldShowScrollTop(SCROLL_TOP_THRESHOLD), false);
  assert.equal(shouldShowScrollTop(SCROLL_TOP_THRESHOLD + 1), true);

  const calls: ScrollToOptions[] = [];
  scrollPageToTop({
    scrollTo(options) {
      calls.push(options);
    },
  });
  assert.deepEqual(calls, [{ top: 0, behavior: "smooth" }]);
  assert.equal(shouldShowScrollTop(Number.NaN), false);
});
