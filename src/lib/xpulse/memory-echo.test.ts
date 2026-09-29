import test from "node:test";
import assert from "node:assert/strict";
import { detectEcho } from "./echo-detector.ts";
import { loadMemory } from "./memory.ts";
import { scoreContent } from "./content-score.ts";

test("echo detector rejects identical output", () => {
  const report = detectEcho("Una tesi precisa con dati concreti.", "Una tesi precisa con dati concreti.");
  assert.equal(report.isEcho, true);
  assert.equal(report.exact, true);
});

test("echo detector allows a material rewrite", () => {
  const report = detectEcho("Oggi voglio parlare di una metrica importante.", "La metrica conta solo quando sai cosa misura e perché.");
  assert.equal(report.isEcho, false);
});

test("memory files validate and contain seeded examples", () => {
  const memory = loadMemory();
  assert.equal(memory.weights.criteria.hook, 1.25);
  assert.equal(memory.weights.thresholds.target, 80);
  assert.ok(memory.examples.examples.length >= 45);
});

test("score weights materially change total", () => {
  const text = "Perché questa metrica conta? Il dato è 42%. La domanda è cosa succede dopo."; 
  const normal = scoreContent(text, "post");
  const weighted = scoreContent(text, "post", { hook: 3, clarity: 0.2, density: 1, curiosity: 1, emotion: 1, shareability: 1, structure: 1, readability: 1, human: 1, anti_spam: 1 });
  assert.notEqual(normal.total, weighted.total);
});