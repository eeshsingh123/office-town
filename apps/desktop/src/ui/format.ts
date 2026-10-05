import type { EnvironmentSpec, HarnessDescription, ProfileRecord } from "@office-town/contract";

const TITLE_LENGTH = 90;
// The UI always runs on the same machine as the core, so its own system is the native one.
const NATIVE_NAME = navigator.userAgent.includes("Windows")
  ? "Windows"
  : navigator.userAgent.includes("Mac")
    ? "macOS"
    : "Linux";

export function environmentName(environment: EnvironmentSpec): string {
  return environment.kind === "wsl" ? `WSL · ${environment.distro}` : NATIVE_NAME;
}

// How a profile's agents work, such as "Claude Code · haiku · low".
export function profileSummary(
  { settings }: Pick<ProfileRecord, "settings">,
  harnesses: readonly HarnessDescription[],
): string {
  const harness = harnesses.find((known) => known.harness === settings.harness)?.name;
  return [harness ?? settings.harness, settings.model, settings.effort]
    .filter((part) => part !== undefined)
    .join(" · ");
}

// A task's title is the first line of its prompt.
export function taskTitle(prompt: string): string {
  const line = prompt.trim().split("\n")[0] ?? "";
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}

export function elapsed(from: string, to: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// 18200 reads as "18.2k".
export function compactCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function byteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// A time within the next day reads as a clock time, a later one as a day.
export function whenNext(iso: string): string {
  const at = new Date(iso);
  if (at.getTime() - Date.now() < 24 * 60 * 60 * 1000) return `at ${clockTime(iso)}`;
  return at.toLocaleDateString([], { weekday: "long" });
}
