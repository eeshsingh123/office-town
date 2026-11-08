// Older versions saved some choices as plain text, which reads back as that text.
function fromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// What an earlier launch learned from the CLIs, shown at once as reading it again takes seconds.
// Storage can be cleared or blocked, and a saved value can predate a change to its shape.
export function loadLastKnown<T>(
  name: string,
  parse: (saved: unknown) => T | undefined,
): T | undefined {
  try {
    const saved = localStorage.getItem(`office-town.${name}`);
    return saved === null ? undefined : parse(fromText(saved));
  } catch {
    return undefined;
  }
}

export function saveLastKnown(name: string, value: unknown) {
  const key = `office-town.${name}`;
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Could not save ${name}.`, error);
  }
}
