import type { Autonomy } from "@office-town/contract";
import { AUTONOMY } from "../../ui/autonomy.ts";
import form from "../../ui/Form.module.css";

// Most careful first; an agent may only move left of its team's level.
const ORDER: Autonomy[] = ["supervised", "trusted", "full", "bypass"];

interface AsksFirstProps {
  name: string;
  // The team's level; none for a template, which has no team yet.
  base: Autonomy | undefined;
  // Such as "the Web team" or "its team".
  baseName: string;
  value: Autonomy | undefined;
  onChange: (value: Autonomy | undefined) => void;
}

// An agent can be made more careful than its team. To let it do more, the team's setting changes.
export function AsksFirst({ name, base, baseName, value, onChange }: AsksFirstProps) {
  const limit = base === undefined ? ORDER.indexOf("full") : ORDER.indexOf(base);
  const stricter = ORDER.slice(0, limit).toReversed();
  return (
    <div className={form.field} role="radiogroup" aria-label="When it asks you first">
      <label className={form.choice}>
        <input
          type="radio"
          name={name}
          checked={value === undefined}
          onChange={() => onChange(undefined)}
        />
        <span className={form.choiceText}>
          <strong>Same as {baseName}</strong>
          <span className={form.hint}>
            {base === undefined ? "Follows the team it joins." : AUTONOMY[base].description}
          </span>
        </span>
      </label>
      {stricter.map((level) => (
        <label key={level} className={form.choice}>
          <input
            type="radio"
            name={name}
            checked={value === level}
            onChange={() => onChange(level)}
          />
          <span className={form.choiceText}>
            <strong>{AUTONOMY[level].label}</strong>
            <span className={form.hint}>{AUTONOMY[level].description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
