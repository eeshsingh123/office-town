import type { AgentSettings, HarnessDescription, HarnessModel } from "@office-town/contract";

type Settings = Pick<AgentSettings, "harness" | "model" | "effort">;

// Claude Code lists its default as a model of its own; the picker offers it once, by name.
export const DEFAULT_MODEL = "default";

// The default is named after the model it stands for, as Claude Code says ("Opus 5.5 · Best for …").
function defaultName(models: readonly HarnessModel[]): string | undefined {
  const named = models.find((model) => model.id === DEFAULT_MODEL)?.description?.split(" · ")[0];
  return named === undefined || named.trim() === "" ? undefined : named.trim();
}

// Shown only until the AI app's list arrives, or for a model it no longer lists:
// "claude-haiku-5-5" and "opencode-go/longcat-2.5-free" read as "Haiku 5.5" and "Longcat 2.5 Free".
function readableId(id: string): string {
  const words = (id.split("/").at(-1) ?? id)
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .split("-");
  return words
    .reduce<string[]>((parts, word) => {
      const previous = parts.at(-1);
      if (/^\d+$/.test(word) && previous !== undefined && /\d$/.test(previous)) {
        parts[parts.length - 1] = `${previous}.${word}`;
      } else parts.push(word);
      return parts;
    }, [])
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

// The one name a model goes by in the app, for a picked alias ("haiku") and for the full id a
// running session reports ("claude-haiku-5-5") alike. Undefined means the AI app's own default
// when it does not say which model that is.
export function modelName(
  models: readonly HarnessModel[] | undefined,
  id: string | undefined,
): string | undefined {
  const list = models ?? [];
  if (id === undefined || id === DEFAULT_MODEL) return defaultName(list);
  const found =
    list.find((model) => model.id === id) ??
    list.find((model) => model.resolvedId === id && model.id !== DEFAULT_MODEL);
  if (found !== undefined) return found.name;
  if (list.some((model) => model.id === DEFAULT_MODEL && model.resolvedId === id)) {
    return defaultName(list) ?? readableId(id);
  }
  return readableId(id);
}

// With nothing picked, an AI app that does not say what its default is (OpenCode) offers the values
// most of its models share; a value its default lacks is ignored at the start, with a note.
export function effortsOf(
  models: readonly HarnessModel[] | undefined,
  id: string | undefined,
): readonly string[] {
  const list = models ?? [];
  const picked = id ?? DEFAULT_MODEL;
  const found =
    list.find((model) => model.id === picked) ?? list.find((model) => model.resolvedId === picked);
  if (found !== undefined) return found.efforts;
  if (id !== undefined) return [];
  const thinking = list.filter((model) => model.efforts.length > 0);
  const shared = (effort: string) =>
    thinking.filter((model) => model.efforts.includes(effort)).length * 2 >= thinking.length;
  return [...new Set(thinking.flatMap((model) => model.efforts))].filter(shared);
}

const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

// The harness's own word when it has one we don't know.
export const effortLabel = (effort: string) =>
  EFFORT_LABELS[effort] ?? `${effort[0]?.toUpperCase() ?? ""}${effort.slice(1)}`;

export function effortName(effort: string): string {
  return `${effortLabel(effort)} effort`;
}

// Free comes first, so an AI app with free models reads as one you can use at no cost.
export function accessNote(models: readonly HarnessModel[] | undefined): string | undefined {
  if (models?.some((model) => model.access === "free")) return "Free models";
  if (models?.some((model) => model.access === "plan")) return "In your plan";
  return undefined;
}

// Such as "Sonnet 5.5 · Claude Code · Medium effort".
export function modelLine(
  settings: Settings,
  harnesses: readonly HarnessDescription[],
  models: readonly HarnessModel[] | undefined,
): string {
  const app = harnesses.find((known) => known.harness === settings.harness)?.name;
  return [
    modelName(models, settings.model) ?? "Default model",
    app ?? settings.harness,
    settings.effort === undefined ? undefined : effortName(settings.effort),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}
