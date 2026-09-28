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