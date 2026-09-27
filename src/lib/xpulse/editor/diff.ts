export type DiffMark = {
  type: "same" | "added" | "removed";
  text: string;
};

/** Line diff. Same lines stay; the rest are removed or added. No fuzzy rewrite claim. */
export function diffLines(before: string, after: string): DiffMark[] {
  const left = before.split("\n");
  const right = after.split("\n");
  const used = new Set<number>();
  const marks: DiffMark[] = [];
  for (const line of left) {
    const index = right.findIndex((item, i) => !used.has(i) && item === line);
    if (index >= 0) {
      used.add(index);
      marks.push({ type: "same", text: line });
    } else if (line.trim()) {
      marks.push({ type: "removed", text: line });
    }
  }
  right.forEach((line, index) => {
    if (!used.has(index) && line.trim()) marks.push({ type: "added", text: line });
  });
  return marks;
}
