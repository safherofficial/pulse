import { readFileSync } from "node:fs";

export type MemoryWeights = {
  criteria: Record<string, number>;
  thresholds: { weak: number; good: number; target: number };
  contentTypes: Record<string, number>;
};
export type MemoryBundle = {
  weights: MemoryWeights;
  rules: { limits: Record<string, number>; rules: Array<{ id: string; severity: string; pattern: string; fix: string }> };
  lexicon: Record<string, unknown>;
  hooks: { templates: Array<Record<string, unknown>>; thread: { maxPosts: number; flow: string[] } };
  examples: { examples: Array<Record<string, unknown>> };
  style: Record<string, unknown>;
};
const cache = new Map<string, unknown>();
function loadJson<T>(name: string): T {
  const hit = cache.get(name);
  if (hit) return hit as T;
  const raw = readFileSync(new URL("./memory/" + name, import.meta.url), "utf8");
  const value = JSON.parse(raw) as T;
  cache.set(name, value);
  return value;
}
export function loadMemory(): MemoryBundle {
  const weights = loadJson<MemoryWeights>("weights.json");
  const rules = loadJson<MemoryBundle["rules"]>("rules.json");
  const lexicon = loadJson<Record<string, unknown>>("lexicon.json");
  const hooks = loadJson<MemoryBundle["hooks"]>("hooks_templates.json");
  const examples = loadJson<MemoryBundle["examples"]>("examples.json");
  const style = loadJson<Record<string, unknown>>("style_profile.json");
  if (!weights.criteria || !weights.thresholds || !weights.contentTypes) throw new Error("Invalid memory weights.json");
  if (!Array.isArray(rules.rules) || !rules.limits) throw new Error("Invalid memory rules.json");
  if (!Array.isArray(hooks.templates) || hooks.thread.maxPosts < 1) throw new Error("Invalid memory hooks_templates.json");
  if (!Array.isArray(examples.examples) || examples.examples.length < 45) throw new Error("Invalid memory examples.json");
  if (!style.tone || !style.language) throw new Error("Invalid memory style_profile.json");
  return { weights, rules, lexicon, hooks, examples, style };
}
export function validateMemoryAtStartup(): void { loadMemory(); }
function tokenSet(text: string): Set<string> { return new Set((text.toLowerCase().match(/[a-zà-ÿ0-9']+/gi) ?? []).filter((t) => t.length > 2)); }
function jaccard(a: Set<string>, b: Set<string>): number { const union = new Set([...a, ...b]); if (!union.size) return 1; let intersection = 0; for (const token of a) if (b.has(token)) intersection++; return intersection / union.size; }
export function retrieveMemory(text: string, kind: "post" | "thread" | "article", limit = 3) {
  const memory = loadMemory(); const source = tokenSet(text);
  const examples = memory.examples.examples.filter((item) => item.category === kind).map((item) => ({ item, similarity: jaccard(source, tokenSet(String(item.before ?? ""))) })).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  const rules = memory.rules.rules.filter((rule) => { try { return new RegExp(rule.pattern, "i").test(text); } catch { return false; } }).slice(0, 6);
  const priorityCriteria = Object.entries(memory.weights.criteria).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([criterion, weight]) => ({ criterion, weight }));
  return { memory, examples, rules, priorityCriteria };
}
export function memoryPromptContext(text: string, kind: "post" | "thread" | "article"): string {
  const hit = retrieveMemory(text, kind);
  return [
    "DATABASE MEMORY — authoritative editorial memory, not facts:",
    "Weights: " + JSON.stringify(hit.memory.weights.criteria),
    "Thresholds: " + JSON.stringify(hit.memory.weights.thresholds),
    "Priority criteria: " + JSON.stringify(hit.priorityCriteria),
    "Matched rules: " + JSON.stringify(hit.rules),
    "Style: " + JSON.stringify(hit.memory.style),
    "Relevant before/after examples: " + JSON.stringify(hit.examples.map(({ item, similarity }) => ({ similarity: Number(similarity.toFixed(3)), ...item }))),
    "Hook templates: " + JSON.stringify(hit.memory.hooks.templates.slice(0, 5)),
    "Use examples as patterns only. Never copy their facts or wording.",
  ].join("\n");
}