import type { Autonomy } from "@office-town/contract";
import { useState } from "react";
import { AUTONOMY } from "./autonomy.ts";
import { MoreButton, OptionRows } from "./Choice.tsx";

const EVERYDAY: Autonomy[] = ["supervised", "trusted", "full"];

interface AutonomyChoiceProps {
  name: string;
  value: Autonomy;
  // Goes through the bypass gate, which warns before turning every check off.
  onChoose: (level: Autonomy) => void;
}

// The harness's own bypass stays behind "More options", since it removes every check.
export function AutonomyChoice({ name, value, onChoose }: AutonomyChoiceProps) {
  const [more, setMore] = useState(value === "bypass");
  const levels = more ? [...EVERYDAY, "bypass" as const] : EVERYDAY;
  return (
    <>
      <OptionRows
        name={name}
        label="How much it can do without asking you"
        value={value}
        options={levels.map((level) => ({
          value: level,
          title: AUTONOMY[level].label,
          description: AUTONOMY[level].description,
        }))}
        onChange={onChoose}
      />
      {more ? null : <MoreButton onClick={() => setMore(true)}>More options</MoreButton>}
    </>
  );
}
