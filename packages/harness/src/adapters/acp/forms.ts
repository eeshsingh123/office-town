import type { Question } from "@office-town/contract";
import type { AnsweredQuestion } from "../../adapter.ts";
import type { FormField } from "./messages.ts";

type Fields = Record<string, FormField>;

// A choice's companion field, where the user's own words go when no option fits.
const ownWordsKey = (key: string) => `${key}_custom`;

const optionsOf = (field: FormField) => field.oneOf ?? field.items?.anyOf ?? [];

const labelOf = (option: ReturnType<typeof optionsOf>[number]) =>
  option.title ?? String(option.const);

const YES_NO = [{ label: "Yes" }, { label: "No" }];

// One question per field the user fills in; a choice's own-words companion is not asked apart.
export function questionsOf(fields: Fields): Question[] {
  const companions = new Set(Object.keys(fields).map(ownWordsKey));
  return Object.entries(fields)
    .filter(([key]) => !companions.has(key))
    .map(([key, field]) => ({
      questionId: key,
      text: field.description ?? field.title ?? key,
      ...(field.description !== undefined && field.title !== undefined
        ? { header: field.title }
        : {}),
      options:
        field.type === "boolean"
          ? YES_NO
          : optionsOf(field).map((option) => ({
              label: labelOf(option),
              ...(option.description === undefined ? {} : { description: option.description }),
            })),
      multiSelect: field.type === "array",
    }));
}

function fieldValue(field: FormField, picked: string[]): unknown {
  switch (field.type) {
    case "array":
      return picked;
    case "boolean":
      return picked[0] === "Yes";
    case "number":
    case "integer":
      return Number(picked[0]);
    default:
      return picked[0];
  }
}

// The form's answer: each picked label as its option's value, the user's own words in the
// companion field when the field has one, or as the value of a field with no options.
export function contentOf(fields: Fields, answered: AnsweredQuestion[]): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const { question, selected } of answered) {
    const key = question.questionId;
    const field = fields[key];
    if (field === undefined) continue;
    const options = optionsOf(field);
    const picked = selected.flatMap((label) => {
      const option = options.find((candidate) => labelOf(candidate) === label);
      return option === undefined ? [] : [String(option.const)];
    });
    const ownWords = selected.filter((label) => !options.some((o) => labelOf(o) === label));
    if (options.length === 0 && field.type !== "boolean") {
      content[key] = fieldValue(field, ownWords);
      continue;
    }
    if (picked.length > 0 || field.type === "boolean") {
      content[key] = fieldValue(field, field.type === "boolean" ? selected : picked);
    }
    if (ownWords.length > 0 && fields[ownWordsKey(key)] !== undefined) {
      content[ownWordsKey(key)] = ownWords.join(", ");
    }
  }
  return content;
}
