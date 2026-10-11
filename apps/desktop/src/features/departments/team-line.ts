export function teamLine(members: number): string {
  if (members <= 0) return "A lead working alone";
  return `A lead and ${members} ${members === 1 ? "person" : "people"}`;
}
