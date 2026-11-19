import { type AgentColour, agentColours } from "@office-town/contract";
import { Check } from "lucide-react";
import form from "./Form.module.css";

interface ColourPickerProps {
  label: string;
  value: AgentColour;
  onChange: (colour: AgentColour) => void;
}

// The pick carries a tick and its name shows under the row, so it never rests on colour alone.
export function ColourPicker({ label, value, onChange }: ColourPickerProps) {
  const picked = agentColours.find((colour) => colour.value === value);
  return (
    <div className={form.swatchPicker}>
      <div role="radiogroup" aria-label={label} className={form.swatches}>
        {agentColours.map((colour) => (
          // biome-ignore lint/a11y/useSemanticElements: a round swatch, not a native radio button
          <button
            key={colour.value}
            type="button"
            role="radio"
            aria-checked={value === colour.value}
            aria-label={colour.label}
            title={colour.label}
            className={form.swatch}
            style={{ background: colour.value }}
            onClick={() => onChange(colour.value)}
          >
            {value === colour.value ? <Check size={14} strokeWidth={3} aria-hidden /> : null}
          </button>
        ))}
      </div>
      {picked === undefined ? null : <span className={form.hint}>{picked.label}</span>}
    </div>
  );
}
