import type { EnvironmentSpec } from "@office-town/contract";

const TITLE_LENGTH = 60;
// The UI always runs on the same machine as the core, so its own system is the native one.
const NATIVE_NAME = navigator.userAgent.includes("Windows")
  ? "Windows"
  : navigator.userAgent.includes("Mac")
    ? "macOS"
    : "Linux";

export function environmentName(environment: EnvironmentSpec): string {
  return environment.kind === "wsl" ? `WSL · ${environment.distro}` : NATIVE_NAME;
}

const POLITE_START =
  /^(?:(?:hey|hi|hello|ok|okay)[,!.]?\s+)?(?:(?:please|pls|kindly)\s+)?(?:(?:can|could|would|will) you\s+(?:please\s+)?|i (?:want|need|would like) you to\s+|help me\s+)?/i;

// A short title from the prompt's first sentence, without the polite opening: "Hi, can you
// please write a haiku about the sea. Keep it short" reads "Write a haiku about the sea".
export function taskTitle(prompt: string): string {
  const line = prompt.trim().split("\n")[0] ?? "";
  const sentence = (line.split(/(?<=[.!?])\s+/)[0] ?? line).replace(/[.!?]+$/, "");
  const rest = sentence.replace(POLITE_START, "");
  const title = rest === "" ? sentence : `${rest[0]?.toUpperCase() ?? ""}${rest.slice(1)}`;
  if (title.length <= TITLE_LENGTH) return title;
  const cut = title.slice(0, TITLE_LENGTH - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > TITLE_LENGTH / 2 ? cut.slice(0, space) : cut}…`;
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

// "4 min ago", "yesterday", "3 days ago".
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
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
