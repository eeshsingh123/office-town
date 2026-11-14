// One count for a department's size everywhere, the lead included (design audit a2-25).
export function peopleLine(people: number): string {
  return people === 1 ? "1 person" : `${people} people`;
}
