/**
 * Deterministic validation layer for generated XPulse content.
 * The LLM may write; it cannot decide whether its output is factually acceptable.
 */

import { validateEditorialShape, type EditorialQualityGate } from "./editorial-standard.ts";
import type { ContentKind } from "./content-score.ts";
import type { TokenFactSet } from "./content-create.ts";

export type ContentValidationReport = {
  pass: boolean;
  violations: string[];
  warnings: string[];
  editorial: EditorialQualityGate;
};

function normalizeNumber(value: string): string {
  return value
    .replace(/,/g, "")
    .replace(/\$/g, "")
    .replace(/%/g, "")
    .replace(/×/g, "x")
    .toLowerCase();
}

function numericTokens(text: string): string[] {
  return (text.match(/\$?\d+(?:[.,]\d+)*(?:\.\d+)?(?:%|x|×)?/gi) ?? [])
    .map(normalizeNumber)
    .filter(Boolean);
}

function sourceNumericTokens(facts: TokenFactSet): Set<string> {
  const source = JSON.stringify({
    identity: facts.identity,
    metrics: facts.metrics,
    findings: facts.findings,
    story: facts.story,
    risks: facts.risks,
    market: facts.market,
    xPatterns: facts.xPatterns,
  });
  return new Set(numericTokens(source));
}

function repeatedSentences(text: string): number {
  const seen = new Set<string>();
  let repeated = 0;
  for (const sentence of text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter((part) => part.length >= 24)) {
    if (seen.has(sentence)) repeated += 1;
    seen.add(sentence);
  }
  return repeated;
}

/**
 * Validates only properties that can be checked from the supplied fact set.
 * It deliberately does not attempt semantic truth judgments that require an LLM.
 */
export function validateGeneratedContent(
  text: string,
  kind: ContentKind,
  facts: TokenFactSet,
): ContentValidationReport {
  const editorial = validateEditorialShape(text, kind);
  const violations = [...editorial.violations];
  const warnings = [...editorial.notes];

  if (!text.trim()) violations.push("empty_output");

  if (!text.includes(facts.identity.address)) {
    violations.push("token_contract_missing");
  }

  const allowedNumbers = sourceNumericTokens(facts);
  const numericText =
    kind === "thread"
      ? text
          .split(/\n+/)
          .map((line) => line.replace(/^\s*\d+\s*[/.)-]\s*/, ""))
          .join("\n")
      : text;
  const unsupportedNumbers = numericTokens(numericText).filter(
    (token) => !allowedNumbers.has(token),
  );

  const claimNumbers = unsupportedNumbers;
  if (claimNumbers.length) {
    violations.push(
      "unsupported_numeric_claim:" + [...new Set(claimNumbers)].slice(0, 6).join(","),
    );
  }

  const repeated = repeatedSentences(text);
  if (repeated > 0) violations.push("repeated_sentences");

  if (/\n\s*\n\s*\n/.test(text)) warnings.push("excessive_blank_lines");

  if (kind === "thread") {
    const beats = text
      .split(/\n\s*\n/)
      .map((beat) => beat.trim())
      .filter(Boolean);
    if (beats.length > 10) warnings.push("thread_over_10_beats");
    if (beats.length > 0 && beats.some((beat) => beat.length > 280)) {
      violations.push("thread_tweet_over_280");
    }
  }

  return {
    pass: violations.length === 0,
    violations: [...new Set(violations)],
    warnings: [...new Set(warnings)],
    editorial,
  };
}
