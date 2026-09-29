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
  memoryLog: { schemaVersion: number; maxEntries: number; accepted: unknown[]; rejected: unknown[]; history: unknown[] };
};
const cache = new Map<string, unknown>();
function loadJson<T>(name: string): T {
  const hit = cache.get(name);
  if (hit) return hit as T;
  const fileUrl = name === "weights.json" ? new URL("./memory/weights.json", import.meta.url) : name === "rules.json" ? new URL("./memory/rules.json", import.meta.url) : name === "lexicon.json" ? new URL("./memory/lexicon.json", import.meta.url) : name === "hooks_templates.json" ? new URL("./memory/hooks_templates.json", import.meta.url) : name === "examples.json" ? new URL("./memory/examples.json", import.meta.url) : name === "style_profile.json" ? new URL("./memory/style_profile.json", import.meta.url) : new URL("./memory/memory_log.json", import.meta.url);
  const raw = readFileSync(fileUrl, "utf8");
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
  const memoryLog = loadJson<MemoryBundle["memoryLog"]>("memory_log.json");
  if (!weights.criteria || !weights.thresholds || !weights.contentTypes) throw new Error("Invalid memory weights.json");
  if (!Array.isArray(rules.rules) || !rules.limits) throw new Error("Invalid memory rules.json");
  if (!Array.isArray(hooks.templates) || hooks.thread.maxPosts < 1) throw new Error("Invalid memory hooks_templates.json");
  if (!Array.isArray(examples.examples) || examples.examples.length < 45) throw new Error("Invalid memory examples.json");
  if (!style.tone || !style.language) throw new Error("Invalid memory style_profile.json");
  if (!Number.isFinite(memoryLog.maxEntries) || memoryLog.maxEntries < 1) throw new Error("Invalid memory_log.json");
  return { weights, rules, lexicon, hooks, examples, style, memoryLog };
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
export async function memoryPromptContextAsync(text: string, kind: "post" | "thread" | "article"): Promise<string> {
  const staticContext = memoryPromptContext(text, kind);
  try {
    const { getSql } = await import("@/lib/db");
    const sql = getSql();
    const rows = await sql<{ before_text: string; after_text: string; status: string; before_score: number; after_score: number }>`
      select before_text, after_text, status, before_score, after_score
      from xpulse_editor_memory
      where kind = ${kind}
      order by created_at desc
      limit 12
    `;
    const source = tokenSet(text);
    const relevant = rows.map((row) => ({ ...row, similarity: jaccard(source, tokenSet(row.before_text)) })).sort((a, b) => b.similarity - a.similarity).slice(0, 4);
    return staticContext + "\nPersisted accepted/rejected examples: " + JSON.stringify(relevant.map((row) => ({ status: row.status, before: row.before_text, after: row.after_text, beforeScore: row.before_score, afterScore: row.after_score, similarity: Number(row.similarity.toFixed(3)) })));
  } catch {
    return staticContext + "\nPersisted memory unavailable; use static memory only.";
  }
}

export async function recordMemoryExample(input: { kind: "post" | "thread" | "article"; status: "accepted" | "rejected"; beforeText: string; afterText: string; beforeScore: number; afterScore: number; criteria: string[] }): Promise<void> {
  const { getSql } = await import("@/lib/db");
  const sql = getSql();
  await sql`
    insert into xpulse_editor_memory (id, kind, status, before_text, after_text, before_score, after_score, criteria)
    values (${crypto.randomUUID()}, ${input.kind}, ${input.status}, ${input.beforeText}, ${input.afterText}, ${input.beforeScore}, ${input.afterScore}, ${JSON.stringify(input.criteria)}::jsonb)
  `;
  await sql`
    delete from xpulse_editor_memory
    where id in (
      select id from xpulse_editor_memory order by created_at asc
      offset 500
    )
  `;
}
export async function exportMemorySnapshot(): Promise<string> {
  const memory = loadMemory();
  try {
    const { getSql } = await import("@/lib/db");
    const sql = getSql();
    const rows = await sql<{ kind: string; status: string; before_text: string; after_text: string; before_score: number; after_score: number; criteria: unknown; created_at: string | Date }>`
      select kind, status, before_text, after_text, before_score, after_score, criteria, created_at
      from xpulse_editor_memory
      order by created_at desc
      limit 500
    `;
    return JSON.stringify({ ...memory, learned: rows }, null, 2);
  } catch {
    return JSON.stringify(memory, null, 2);
  }
}

export async function importMemorySnapshot(snapshot: unknown): Promise<number> {
  if (!snapshot || typeof snapshot !== "object") throw new Error("Invalid memory snapshot.");
  const learned = Array.isArray((snapshot as { learned?: unknown }).learned) ? (snapshot as { learned: unknown[] }).learned : [];
  const { getSql } = await import("@/lib/db");
  const sql = getSql();
  let inserted = 0;
  for (const item of learned.slice(0, 500)) {
    const row = item as Record<string, unknown>;
    if (
      (row.kind === "post" || row.kind === "thread" || row.kind === "article") &&
      (row.status === "accepted" || row.status === "rejected") &&
      typeof row.before_text === "string" && typeof row.after_text === "string" &&
      Number.isFinite(Number(row.before_score)) && Number.isFinite(Number(row.after_score))
    ) {
      await sql`
        insert into xpulse_editor_memory (id, kind, status, before_text, after_text, before_score, after_score, criteria)
        values (${crypto.randomUUID()}, ${row.kind}, ${row.status}, ${row.before_text}, ${row.after_text}, ${Number(row.before_score)}, ${Number(row.after_score)}, ${JSON.stringify(Array.isArray(row.criteria) ? row.criteria : [])}::jsonb)
      `;
      inserted++;
    }
  }
  return inserted;
}
