import type { TextareaHTMLAttributes } from "react";
import form from "./Form.module.css";

interface LineFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

// A one-line value that wraps as it grows, so a long line stays readable. Enter adds no line break.
export function LineField({ value, onChange, className, ...props }: LineFieldProps) {
  return (
    <textarea
      rows={1}
      {...props}
      className={[form.input, form.line, className].filter(Boolean).join(" ")}
      value={value}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
      onChange={(event) => onChange(event.target.value.replace(/\s*\r?\n\s*/g, " "))}
    />
  );
}
