const TITLE_LENGTH = 90;

// A task's title is the first line of its prompt.
export function taskTitle(prompt: string): string {
  const line = prompt.trim().split("\n")[0] ?? "";
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}
