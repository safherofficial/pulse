/**
 * Deterministic market-state reading for a token snapshot.
 * Price collapse is a fact. A rug pull is an inference and is never
 * declared from one metric.
 */
import { formatMarketCapCompact, formatTokenPrice } from "./format.ts";

export type MarketStance =
  | "BULLISH"
  | "POSITIVE"
  | "NEUTRAL"
  | "CAUTION"
  | "BEARISH"
  | "SEVERE_RISK"
  | "COLLAPSED";

export type RugPullRisk = "low" | "elevated" | "high" | "critical" | "unconfirmed";

export type SignalSeverity = "low" | "medium" | "high" | "critical";

export type MarketSignal = {
  type: string;
  severity: SignalSeverity;
  polarity: "risk" | "support" | "context";
  value: number | null;
  explanation: string;
  /** fact = printed from a source field; derived = calculated; risk = interpretation */
  basis: "fact" | "derived" | "risk";
};

export type MarketDiagnosis = {
  state: MarketStance;
  riskScore: number;
  riskBand: "low" | "moderate" | "elevated" | "high" | "critical";
  signals: MarketSignal[];
  facts: string[];
  conclusions: string[];
  caveats: string[];
  rugPullRisk: RugPullRisk;
  /** Stable sentence. Generation must keep this wording. */
  headline: string;
  /** Stable inference sentence, or null when rug language would overclaim. */
  rugLine: string | null;
  window: "1h" | "6h" | "24h" | null;
  worstChange: number | null;
};

export type MarketStateInput = {
  name: string;
  symbol: string;
  chain: string;
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  priceChange1h: number | null;
  priceChange6h: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  website: string | null;
  twitter: string | null;
  mentionsAvailability: "available" | "empty" | "unavailable";
  mentionTexts: string[];
};

const NEGATIVE_X = /\b(rug|rugged|scam|honeypot|dead|dump|collapse|worthless|exit liquidity)\b/i;
const POSITIVE_X = /\b(bullish|moon|sending|breakout|undervalued|accumulate)\b/i;

function finite(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function usd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function bandFor(score: number): MarketDiagnosis["riskBand"] {
  if (score <= 20) return "low";
  if (score <= 40) return "moderate";
  if (score <= 60) return "elevated";
  if (score <= 80) return "high";
  return "critical";
}

function pickWindow(input: MarketStateInput): { change: number; window: "1h" | "6h" | "24h" } | null {
  const rows: Array<{ change: number; window: "1h" | "6h" | "24h" }> = [];
  const h1 = finite(input.priceChange1h);
  const h6 = finite(input.priceChange6h);
  const h24 = finite(input.priceChange24h);
  if (h1 != null) rows.push({ change: h1, window: "1h" });
  if (h6 != null) rows.push({ change: h6, window: "6h" });
  if (h24 != null) rows.push({ change: h24, window: "24h" });
  if (!rows.length) return null;
  const collapse = rows.filter((row) => row.change <= -90);
  if (collapse.length) {
    return collapse.reduce((worst, row) => (row.change < worst.change ? row : worst));
  }
  return rows.find((row) => row.window === "24h") ?? rows.find((row) => row.window === "6h") ?? rows[0]!;
}

export function analyzeTokenState(input: MarketStateInput): MarketDiagnosis {
  const symbol = input.symbol || input.name || "Token";
  const windowPick = pickWindow(input);
  const change = windowPick?.change ?? null;
  const window = windowPick?.window ?? null;
  const liq = finite(input.liquidityUsd);
  const vol = finite(input.volume24h);
  const buys = finite(input.buys24h);
  const sells = finite(input.sells24h);
  const trades = buys != null && sells != null ? buys + sells : null;
  const sellShare = trades != null && trades > 0 && sells != null ? sells / trades : null;
  const volLiq = liq != null && liq > 0 && vol != null ? vol / liq : null;
  const hasSite = Boolean(input.website && input.website.trim());
  const hasX = Boolean(input.twitter && input.twitter.trim());
  const noOfficial = !hasSite && !hasX;

  const veryLowLiq = liq != null && liq < 25_000;
  const extremeLiq = liq != null && liq < 8_000;
  const healthyLiq = liq != null && liq >= 100_000;
  const sellPressure = sellShare != null && trades != null && trades >= 20 && sellShare >= 0.65;
  const extremeSells = sellShare != null && trades != null && trades >= 20 && sellShare >= 0.8;
  const volImbalance = volLiq != null && volLiq >= 5;
  const extremeTurnover = volLiq != null && volLiq >= 8;
  const deadBook = vol != null && vol < 8_000 && (liq == null || liq < 80_000);
  const healthyBook = healthyLiq && (hasSite || hasX) && !sellPressure && !volImbalance;

  const corroborators = [veryLowLiq, sellPressure, volImbalance, noOfficial].filter(Boolean).length;

  const signals: MarketSignal[] = [];
  const facts: string[] = [];
  const conclusions: string[] = [];
  const caveats: string[] = [
    "XPulse risk score is a reading of this snapshot, not an official market rating.",
    "Missing fields were not estimated.",
  ];

  if (change != null && window) {
    const abs = Math.abs(change).toFixed(1);
    const direction = change <= -1 ? "down" : change >= 1 ? "up" : "roughly flat";
    const fact =
      direction === "roughly flat"
        ? `Price is roughly flat over ${window} (${change.toFixed(1)}%).`
        : `Price is ${direction} ${abs}% over ${window}.`;
    facts.push(fact);
    const collapse = change <= -90;
    signals.push({
      type: "price_window",
      severity: collapse ? "critical" : change <= -40 ? "high" : change <= -15 ? "medium" : "low",
      polarity: change <= -8 ? "risk" : change >= 8 ? "support" : "context",
      value: change,
      basis: "fact",
      explanation: fact,
    });
  } else {
    facts.push("No 1h, 6h, or 24h price change was returned.");
    caveats.push("Direction is not inferred without a price-change window.");
  }

  if (finite(input.priceUsd) != null) {
    const px = formatTokenPrice(input.priceUsd);
    if (px) facts.push(`Last price is ${px}.`);
  }
  const mcap = formatMarketCapCompact(input.marketCap);
  if (mcap) facts.push(`Market cap is ${mcap}.`);

  if (liq != null) {
    const explanation = extremeLiq
      ? `Liquidity is extremely thin at ${usd(liq)}.`
      : veryLowLiq
        ? `Liquidity is very low at ${usd(liq)}.`
        : healthyLiq
          ? `Liquidity is comparatively healthy at ${usd(liq)}.`
          : `Liquidity is ${usd(liq)}.`;
    facts.push(explanation);
    signals.push({
      type: "liquidity",
      severity: extremeLiq ? "critical" : veryLowLiq ? "high" : healthyLiq ? "low" : "medium",
      polarity: veryLowLiq ? "risk" : healthyLiq ? "support" : "context",
      value: liq,
      basis: veryLowLiq || extremeLiq ? "risk" : "fact",
      explanation,
    });
  }

  if (vol != null) {
    const explanation = deadBook
      ? `24h volume is thin at ${usd(vol)}.`
      : `24h volume is ${usd(vol)}.`;
    facts.push(explanation);
    if (deadBook) {
      signals.push({
        type: "activity",
        severity: "medium",
        polarity: "risk",
        value: vol,
        basis: "derived",
        explanation,
      });
    }
  }

  if (volImbalance && volLiq != null) {
    const explanation = `24h volume is ${volLiq.toFixed(1)}× liquidity — turnover is abnormal relative to the pool.`;
    signals.push({
      type: "volume_liquidity",
      severity: extremeTurnover ? "critical" : "high",
      polarity: "risk",
      value: volLiq,
      basis: "derived",
      explanation,
    });
    conclusions.push(explanation);
  }

  if (buys != null && sells != null) {
    const explanation = sellPressure
      ? `Sells dominate the 24h tape (${Math.round(sells)} sells vs ${Math.round(buys)} buys).`
      : `24h flow is ${Math.round(buys)} buys and ${Math.round(sells)} sells.`;
    facts.push(explanation);
    if (sellPressure) {
      signals.push({
        type: "sell_pressure",
        severity: extremeSells ? "critical" : "high",
        polarity: "risk",
        value: sellShare,
        basis: "derived",
        explanation,
      });
    }
  }

  if (noOfficial) {
    const explanation = "No official website or official X account was returned with this snapshot.";
    signals.push({
      type: "official_presence",
      severity: change != null && change <= -90 ? "high" : "medium",
      polarity: "risk",
      value: null,
      basis: "fact",
      explanation,
    });
    facts.push(explanation);
  } else if (hasX || hasSite) {
    facts.push(
      hasX && hasSite
        ? "An official website and an official X link are present in the market metadata."
        : hasX
          ? "An official X link is present in the market metadata."
          : "An official website is present in the market metadata.",
    );
  }

  if (input.mentionsAvailability === "unavailable") {
    facts.push("Public X mentions are temporarily unavailable.");
    caveats.push("A missing X sample is not evidence that nobody is talking, and it is not a bullish signal.");
  } else if (input.mentionsAvailability === "empty" || input.mentionTexts.length === 0) {
    facts.push("No verified public X mentions were found for this token in the current sample.");
    if (change != null && change <= -50) {
      signals.push({
        type: "x_mentions",
        severity: "low",
        polarity: "context",
        value: 0,
        basis: "fact",
        explanation: "The public X sample is empty. That is weak social confirmation, not a reason to flip the market read.",
      });
    }
  } else {
    const negatives = input.mentionTexts.filter((text) => NEGATIVE_X.test(text)).length;
    const positives = input.mentionTexts.filter((text) => POSITIVE_X.test(text)).length;
    facts.push(`Public X sample includes ${input.mentionTexts.length} matching post${input.mentionTexts.length === 1 ? "" : "s"}.`);
    if (negatives > positives && negatives > 0) {
      const explanation =
        "Sampled public X posts include negative language. That is a social signal, not proof of what happened.";
      signals.push({
        type: "x_mentions",
        severity: "medium",
        polarity: "risk",
        value: negatives,
        basis: "derived",
        explanation,
      });
      conclusions.push(explanation);
    } else {
      conclusions.push("Public X mentions are not treated as proof of a bullish outcome.");
    }
  }

  const collapse = change != null && change <= -90;
  const extreme = change != null && change <= -95;
  let state: MarketStance;
  let rugPullRisk: RugPullRisk;

  if (collapse) {
    if (healthyBook) {
      state = "SEVERE_RISK";
      rugPullRisk = "unconfirmed";
    } else if (extreme && corroborators >= 2) {
      state = "COLLAPSED";
      rugPullRisk = corroborators >= 3 || extremeLiq || extremeSells ? "critical" : "high";
    } else if (extreme) {
      state = "COLLAPSED";
      rugPullRisk = corroborators >= 1 ? "high" : "unconfirmed";
    } else if (corroborators >= 2) {
      state = "SEVERE_RISK";
      rugPullRisk = "high";
    } else {
      state = "SEVERE_RISK";
      rugPullRisk = corroborators === 0 ? "unconfirmed" : "elevated";
    }
  } else if (change != null && change <= -15) {
    state = veryLowLiq && (sellPressure || volImbalance) ? "SEVERE_RISK" : "BEARISH";
    rugPullRisk = corroborators >= 3 ? "elevated" : "low";
  } else if (
    (change != null && change <= -8) ||
    veryLowLiq ||
    sellPressure ||
    (volImbalance && !healthyLiq)
  ) {
    state = "CAUTION";
    rugPullRisk = corroborators >= 3 ? "elevated" : "low";
  } else if (change != null && change >= 20 && healthyLiq && !sellPressure && !volImbalance) {
    state = "BULLISH";
    rugPullRisk = "low";
  } else if (change != null && change >= 8 && !veryLowLiq && !sellPressure) {
    state = "POSITIVE";
    rugPullRisk = "low";
  } else if (change == null && (veryLowLiq || noOfficial && deadBook)) {
    state = "CAUTION";
    rugPullRisk = "low";
  } else {
    state = "NEUTRAL";
    rugPullRisk = corroborators >= 2 ? "elevated" : "low";
  }

  // A single non-collapse flag must not talk like a rug.
  if (!collapse && rugPullRisk !== "low" && rugPullRisk !== "elevated") rugPullRisk = "elevated";

  let score = 8;
  if (change != null) {
    if (change <= -98) score += 55;
    else if (change <= -95) score += 48;
    else if (change <= -90) score += 40;
    else if (change <= -50) score += 24;
    else if (change <= -20) score += 14;
    else if (change <= -8) score += 6;
    else if (change >= 8 && healthyLiq) score -= 4;
  }
  if (extremeLiq) score += 18;
  else if (veryLowLiq) score += 12;
  else if (healthyLiq) score -= 6;
  if (extremeSells) score += 16;
  else if (sellPressure) score += 12;
  if (extremeTurnover) score += 14;
  else if (volImbalance) score += 8;
  if (noOfficial) score += 8;
  if (deadBook && (change == null || change < 0)) score += 6;
  if (healthyBook && !collapse) score -= 6;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const pct = change == null ? null : `${Math.abs(change).toFixed(1)}%`;
  const span = window ?? "the available window";
  let headline: string;
  if (state === "COLLAPSED" && pct) {
    headline = `${symbol} is down ${pct} over ${span}. The market has deteriorated severely. This is not a bullish setup.`;
  } else if (state === "SEVERE_RISK" && pct && change != null && change < 0) {
    headline = `${symbol} is down ${pct} over ${span}. The current structure shows severe risk, not a bullish setup.`;
  } else if (state === "BEARISH" && pct) {
    headline = `${symbol} is down ${pct} over ${span}. Activity and structure are weakening.`;
  } else if (state === "CAUTION" && pct && change != null && change < 0) {
    headline = `${symbol} is down ${pct} over ${span}. The snapshot calls for caution, not a promotional read.`;
  } else if (state === "CAUTION") {
    headline = `${symbol} has structural caveats in this snapshot. Caution comes before any upside story.`;
  } else if (state === "BULLISH" && pct) {
    headline = `${symbol} is up ${pct} over ${span}, and liquidity is deep enough to take the move seriously.`;
  } else if (state === "POSITIVE" && pct) {
    headline = `${symbol} is up ${pct} over ${span}. The tape is constructive, not a blank check.`;
  } else if (pct && change != null && Math.abs(change) < 8) {
    headline = `${symbol} is roughly unchanged over ${span}. The snapshot is balanced, not a directional call.`;
  } else {
    headline = `${symbol} does not have a clean directional read in the fields that came back.`;
  }

  let rugLine: string | null = null;
  if (collapse && (rugPullRisk === "high" || rugPullRisk === "critical")) {
    rugLine =
      "Available data shows multiple signals consistent with a possible rug pull. That is an inference, not proof that funds were taken.";
  } else if (collapse && rugPullRisk === "unconfirmed") {
    rugLine =
      "A drawdown this large is a severe red flag. Price decline alone does not prove a rug pull.";
  } else if (collapse && rugPullRisk === "elevated") {
    rugLine =
      "The decline is severe and at least one structural flag is present. That raises rug-pull risk, and it still is not confirmation.";
  }

  if (state === "BULLISH" || state === "POSITIVE") {
    conclusions.unshift("Upside language is limited to the measured move and the liquidity behind it.");
  } else if (state === "NEUTRAL") {
    conclusions.unshift("Nothing in the snapshot supports a bullish or bearish campaign.");
  } else if (state === "BEARISH") {
    conclusions.unshift("The editorial read is bearish until newer data changes the tape.");
  } else {
    conclusions.unshift("Severe deterioration is the story. It is not being rewritten as an opportunity.");
  }
  if (rugLine) conclusions.push(rugLine);

  conclusions.unshift(headline);

  return {
    state,
    riskScore: score,
    riskBand: bandFor(score),
    signals,
    facts,
    conclusions,
    caveats,
    rugPullRisk,
    headline,
    rugLine,
    window,
    worstChange: change,
  };
}

export function analyzeTokenIntel(intel: {
  identity: {
    name: string;
    symbol: string;
    chain: string;
    website: string | null;
    twitter: string | null;
  };
  market: {
    priceUsd: number | null;
    marketCap: number | null;
    liquidityUsd: number | null;
    priceChange1h: number | null;
    priceChange6h: number | null;
    priceChange24h: number | null;
    volume24h: number | null;
    buys24h: number | null;
    sells24h: number | null;
  };
  mentions: {
    availability: "available" | "empty" | "unavailable";
    items: Array<{ text: string }>;
  };
}): MarketDiagnosis {
  return analyzeTokenState({
    name: intel.identity.name,
    symbol: intel.identity.symbol,
    chain: intel.identity.chain,
    priceUsd: intel.market.priceUsd,
    marketCap: intel.market.marketCap,
    liquidityUsd: intel.market.liquidityUsd,
    priceChange1h: intel.market.priceChange1h,
    priceChange6h: intel.market.priceChange6h,
    priceChange24h: intel.market.priceChange24h,
    volume24h: intel.market.volume24h,
    buys24h: intel.market.buys24h,
    sells24h: intel.market.sells24h,
    website: intel.identity.website,
    twitter: intel.identity.twitter,
    mentionsAvailability: intel.mentions.availability,
    mentionTexts: intel.mentions.items.map((item) => item.text),
  });
}

