import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Entry } from "@napi-rs/keyring";

const SERVICE = "Office Town";
// Windows keeps at most 1280 characters per credential, so longer values are split.
const CHUNK = 1000;

// A connector's keys and sign-in, never in SQLite, prompts, command lines or logs (D-67).
export interface Secrets {
  // "file" when this computer has no credential store.
  readonly kind: "store" | "file";
  read(id: string): string | undefined;
  write(id: string, value: string): void;
  remove(id: string): void;
}

function credentialStore(): Secrets {
  const entry = (name: string) => new Entry(SERVICE, name);
  const remove = (id: string) => {
    const count = Number(entry(id).getPassword() ?? 0);
    for (let index = 0; index < count; index += 1) entry(`${id}#${index}`).deletePassword();
    entry(id).deletePassword();
  };
  return {
    kind: "store",
    read(id) {
      const count = entry(id).getPassword();
      if (count === null) return undefined;
      const parts = Array.from({ length: Number(count) }, (_, index) =>
        entry(`${id}#${index}`).getPassword(),
      );
      return parts.some((part) => part === null) ? undefined : parts.join("");
    },
    write(id, value) {
      remove(id);
      const parts = value.match(new RegExp(`[^]{1,${CHUNK}}`, "g")) ?? [];
      parts.forEach((part, index) => {
        entry(`${id}#${index}`).setPassword(part);
      });
      entry(id).setPassword(String(parts.length));
    },
    remove,
  };
}

// Readable by the user only; used where no credential store answers, such as Linux without one.
function secretsFile(dataFolder: string): Secrets {
  const file = join(dataFolder, "secrets.json");
  const load = (): Record<string, string> =>
    existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>) : {};
  const save = (values: Record<string, string>) =>
    writeFileSync(file, JSON.stringify(values), { mode: 0o600 });
  return {
    kind: "file",
    read: (id) => load()[id],
    write(id, value) {
      save({ ...load(), [id]: value });
    },
    remove(id) {
      const { [id]: _, ...rest } = load();
      save(rest);
    },
  };
}

export function openSecrets(dataFolder: string): Secrets {
  const store = credentialStore();
  try {
    store.write("check", "ok");
    store.remove("check");
    return store;
  } catch (error) {
    console.error("No credential store answered; connector keys go to a private file.", error);
    return secretsFile(dataFolder);
  }
}
