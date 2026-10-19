// Rules and instructions are stored as plain text, one point per line.

// Longer than this, a line reads as a paragraph and is cut into its sentences.
const PARAGRAPH = 160;
const MARKER = /^(?:[-*•]|\d+[.)])\s+/;
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z"'(])/;

export function pointsOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(MARKER, ""))
    .filter((line) => line !== "")
    .flatMap((line) => (line.length > PARAGRAPH ? line.split(SENTENCE_END) : [line]));
}

export function textOf(points: readonly string[]): string {
  return points
    .map((point) => point.trim())
    .filter((point) => point !== "")
    .join("\n");
}
