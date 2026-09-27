/**
 * Structural detectors. A detector firing is an observation, not a new rule.
 * Rules are proposed only after the sample and score gates in the trend engine.
 */

import type { ContentFormat, ObservedPost } from "./types.ts";

export type PatternDetector = {
  patternId: string;
  name: string;
  description: string;
  format: ContentFormat | "any";
  lever: string;
  leverDescription: string;
  appliesTo: ContentFormat[];
  test: (post: ObservedPost) => boolean;
};

function firstLine(text: string): string {
  return text.split(/\n+/)[0]?.trim() ?? "";
}

function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export const PATTERN_DETECTORS: PatternDetector[] = [
  {
    patternId: "HOOK_QUESTION",
    name: "Question hook",
    description: "The opening line asks a question.",
    format: "any",
    lever: "surface_existing_question",
    leverDescription: "If the author already asked a question below a long opener, move that sentence up. Do not invent a question.",
    appliesTo: ["post", "thread", "article"],
    test: (post) => firstLine(post.text).includes("?"),
  },
  {
    patternId: "CONTRARIAN_PATTERN",
    name: "Contrarian opening",
    description: "The opening pushes against a default take.",
    format: "any",
    lever: "keep_contrarian_open",
    leverDescription: "Leave an existing contrarian first line in place. Do not add one.",
    appliesTo: ["post", "thread", "article"],
    test: (post) => /\b(nobody|most people|stop|the hard truth|wrong|don't|do not)\b/i.test(firstLine(post.text)),
  },
  {
    patternId: "DATA_PATTERN",
    name: "Concrete number",
    description: "The post contains a number the author wrote.",
    format: "any",
    lever: "surface_existing_number",
    leverDescription: "If the hook has no number and a later sentence does, move that sentence up. Do not invent a figure.",
    appliesTo: ["post", "thread", "article"],
    test: (post) => /\d/.test(post.text),
  },
  {
    patternId: "EDUCATIONAL_PATTERN",
    name: "Educational frame",
    description: "The post teaches a step or a reason.",
    format: "any",
    lever: "keep_educational_order",
    leverDescription: "Keep the author's explanatory order. Do not add a lesson.",
    appliesTo: ["post", "thread", "article"],
    test: (post) => /\b(how to|here's|here is|step \d|the reason)\b/i.test(post.text),
  },
  {
    patternId: "STORY_PATTERN",
    name: "Story sequence",
    description: "The post sequences a personal or observed event.",
    format: "any",
    lever: "keep_story_order",
    leverDescription: "Do not reorder a story into a pitch.",
    appliesTo: ["post", "thread", "article"],
    test: (post) => /\b(i|we|yesterday|last week)\b/i.test(post.text) && /\b(then|after|when)\b/i.test(post.text),
  },
  {
    patternId: "THREAD_PATTERN",
    name: "Numbered thread",
    description: "The text is a thread or already uses numbered beats.",
    format: "thread",
    lever: "number_thread_beats",
    leverDescription: "Number beats that already exist.",
    appliesTo: ["thread"],
    test: (post) => post.kind === "thread" || /^\s*\d+\s*\//m.test(post.text),
  },
  {
    patternId: "ARTICLE_PATTERN",
    name: "Long-form note",
    description: "The text is an article or uses section breaks.",
    format: "article",
    lever: "article_hierarchy",
    leverDescription: "Keep a headline and paragraph breaks. Do not add a conclusion the author did not write.",
    appliesTo: ["article"],
    test: (post) => post.kind === "article" || /\n#{1,3}\s+\S/.test(post.text),
  },
  {
    patternId: "CTA_PATTERN",
    name: "Existing reply ask",
    description: "The author already asks for a reply.",
    format: "any",
    lever: "keep_existing_cta",
    leverDescription: "Keep an ask the author wrote. Do not append a new CTA.",
    appliesTo: ["post", "thread"],
    test: (post) => /\b(what do you|what's your|whats your|your read|reply if)\b/i.test(post.text),
  },
  {
    patternId: "LENGTH_PATTERN",
    name: "Short post",
    description: "Word count sits in a short post band.",
    format: "post",
    lever: "prefer_existing_brevity",
    leverDescription: "Do not pad a short post.",
    appliesTo: ["post"],
    test: (post) => {
      const count = words(post.text);
      return count >= 12 && count <= 45;
    },
  },
  {
    patternId: "OPENING_PATTERN",
    name: "Concrete opening",
    description: "The first line already contains a number.",
    format: "any",
    lever: "keep_concrete_open",
    leverDescription: "Do not bury an opening that already carries a number.",
    appliesTo: ["post", "thread", "article"],
    test: (post) => /\d/.test(firstLine(post.text)),
  },
  {
    patternId: "BREAKDOWN_PATTERN",
    name: "Breakdown list",
    description: "The post already uses list beats.",
    format: "any",
    lever: "keep_list_breaks",
    leverDescription: "Keep list breaks the author wrote.",
    appliesTo: ["post", "thread", "article"],
    test: (post) => /\n\s*(?:[-•]|\d+\.)\s+\S/.test(post.text),
  },
  {
    patternId: "HASHTAG_PATTERN",
    name: "Hashtag present",
    description: "The post includes at least one hashtag.",
    format: "any",
    lever: "add_observed_hashtag",
    leverDescription: "Rejected unless scoreContent actually rises. The default scorer penalizes hashtag spam, so this usually stays rolled back.",
    appliesTo: ["post"],
    test: (post) => /(^|\s)#\w+/.test(post.text),
  },
];

export function detectorById(patternId: string): PatternDetector | undefined {
  return PATTERN_DETECTORS.find((detector) => detector.patternId === patternId);
}
