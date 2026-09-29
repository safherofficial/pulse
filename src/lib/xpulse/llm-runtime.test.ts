import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonObject } from "./llm-runtime.ts";

test("LLM JSON parser accepts strict JSON", () => {
  assert.deepEqual(parseJsonObject('{"text":"hello","changed":[]}'), { text: "hello", changed: [] });
});

test("LLM JSON parser extracts fenced JSON safely", () => {
  const parsed = parseJsonObject('```json\\n{"summary":"ok","suggestions":[]}\\n```');
  assert.deepEqual(parsed, { summary: "ok", suggestions: [] });
});

test("LLM JSON parser rejects arrays and invalid JSON", () => {
  assert.equal(parseJsonObject("[1,2,3]"), null);
  assert.equal(parseJsonObject("not json"), null);
});