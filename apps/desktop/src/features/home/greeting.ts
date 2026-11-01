import { useState } from "react";
import { useYou } from "../you/you.ts";

const RARE_CHANCE = 1 / 12;

// `to` is ", Eesh", or empty until a name is saved.
type Line = (to: string) => string;

const ANY_TIME: Line[] = [
  (to) => `Welcome back${to}`,
  (to) => `Good to see you${to}`,
  (to) => `What are we building${to}?`,
  (to) => `The office is open${to}`,
  (to) => `No meetings today${to}`,
];

function byTheClock(now: Date): Line[] {
  const hour = now.getHours();
  const day = now.getDay();
  return [
    ...(hour < 4 ? [(to: string) => `Still up${to}?`] : []),
    ...(hour >= 5 && hour < 7 ? [(to: string) => `You're up early${to}`] : []),
    ...(day === 5 && hour >= 15 ? [(to: string) => `Almost the weekend${to}`] : []),
    ...(day === 0 || day === 6 ? [(to: string) => `Working the weekend${to}?`] : []),
  ];
}

function usual(now: Date): Line {
  const hour = now.getHours();
  const time = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return (to) => `Good ${time}${to}`;
}

function pickLine(now: Date): Line {
  if (Math.random() >= RARE_CHANCE) return usual(now);
  const rare = [...ANY_TIME, ...byTheClock(now)];
  return rare[Math.floor(Math.random() * rare.length)] ?? usual(now);
}

// Picked once each time Home opens, so a rare line does not change as the page updates.
export function useGreeting(): string {
  const { name } = useYou();
  const [line] = useState(() => pickLine(new Date()));
  const [first] = name.trim().split(/\s+/);
  return line(first ? `, ${first}` : "");
}
