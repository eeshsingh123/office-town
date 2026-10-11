// Who a task goes to: one of these, or a department's id. No department id can take these, since
// an id starts with a letter or digit.
export const SOLO = "~solo";
export const CHIEF = "~chief";
// No department yet: the lead proposes one.
export const PROPOSE = "~propose";

export interface Mention {
  // "@" names who takes the task, "#" adds a Library file, "/" picks a template.
  kind: "@" | "#" | "/";
  query: string;
  // Where the mark is in the text.
  start: number;
}

// The word being typed at the caret, when it starts with "@" or "#" anywhere or "/" at the very
// start. A path such as src/app never matches, since each must follow a space.
export function mentionAt(text: string, caret: number): Mention | undefined {
  const found = /(^|\s)([@#/])([^\s@#/]*)$/.exec(text.slice(0, caret));
  if (found === null) return undefined;
  const kind = found[2] as Mention["kind"];
  const query = found[3] ?? "";
  const start = caret - query.length - 1;
  if (kind === "/" && start !== 0) return undefined;
  return { kind, query: query.toLowerCase(), start };
}

// The text once the typed mention is taken out.
export function withoutMention(text: string, mention: Mention, caret: number): string {
  return (text.slice(0, mention.start) + text.slice(caret)).replace(/^\s+/, "");
}
