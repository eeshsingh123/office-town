import { type AgentColour, agentColours } from "@office-town/contract";
import form from "./Form.module.css";

interface ColourPickerProps {
  label: string;
  value: AgentColour;
  onChange: (colour: AgentColour) => void;
}

export function ColourPicker({ label, value, onChange }: ColourPickerProps) {
  return (
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
        />
      ))}
    </div>
  );
}
