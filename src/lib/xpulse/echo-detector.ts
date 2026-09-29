export type EchoReport = {
  exact: boolean;
  tokenJaccard: number;
  characterSimilarity: number;
  lengthRatio: number;
  combinedSimilarity: number;
  isEcho: boolean;
};
function tokens(text: string): Set<string> { return new Set((text.toLowerCase().match(/[a-zà-ÿ0-9_]+/gi) ?? []).filter(Boolean)); }
function jaccard(a: Set<string>, b: Set<string>): number { const union = new Set([...a, ...b]); if (!union.size) return 1; let hit = 0; for (const t of a) if (b.has(t)) hit++; return hit / union.size; }
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let left = i; const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const value = Math.min(prev[j] + 1, left + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      next.push(value); left = value;
    }
    for (let j = 0; j < next.length; j++) prev[j] = next[j];
  }
  return prev[b.length];
}
export function detectEcho(input: string, output: string, threshold = 0.9): EchoReport {
  const a = input.trim(); const b = output.trim();
  const max = Math.max(a.length, b.length, 1);
  const characterSimilarity = 1 - editDistance(a, b) / max;
  const tokenJaccard = jaccard(tokens(a), tokens(b));
  const lengthRatio = Math.min(a.length, b.length) / max;
  const combinedSimilarity = characterSimilarity * 0.6 + tokenJaccard * 0.4;
  const exact = a === b;
  return { exact, tokenJaccard, characterSimilarity, lengthRatio, combinedSimilarity, isEcho: exact || (combinedSimilarity >= threshold && lengthRatio >= 0.9) };
}