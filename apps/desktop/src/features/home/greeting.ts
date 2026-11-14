import { useYou } from "../you/you.ts";

// "Good morning, Eesh": by the clock only, so the page title stays the same (a1-24).
export function useGreeting(): string {
  const { name } = useYou();
  const hour = new Date().getHours();
  const time = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const [first] = name.trim().split(/\s+/);
  return `Good ${time}${first ? `, ${first}` : ""}`;
}
