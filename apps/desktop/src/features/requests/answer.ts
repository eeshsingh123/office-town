import { useState } from "react";

const DETAIL_LIMIT = 2000;

// The part of a request's input a person needs to decide: the command, else the file, else all.
export function detailOf(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const fields = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "url"]) {
    if (typeof fields[key] === "string") return fields[key];
  }
  const text = JSON.stringify(input, null, 2);
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text;
}

export function useAnswer() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (answer: () => Promise<void>) => {
    setSending(true);
    setError(undefined);
    try {
      await answer();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSending(false);
    }
  };
  return { sending, error, run };
}
