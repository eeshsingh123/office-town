import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";

// Characters Windows refuses in a file name, and control characters.
const UNSAFE_IN_NAME = /[<>:"/|?*\p{Cc}]/gu;

// Windows also drops a trailing dot or space.
export function safeFileName(name: string): string {
  const safe = basename(name.replaceAll("\\", "/"))
    .replace(UNSAFE_IN_NAME, "_")
    .replace(/[. ]+$/, "")
    .trim();
  return safe === "" ? "file" : safe;
}

export interface SavedFile {
  path: string;
  bytes: number;
  sha256: string;
}

// One folder per attachment, so its name stays the user's and two files of one name never meet.
export class AttachmentFiles {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  // Read-only on disk, so what the user picked is what every agent gets.
  save(id: string, name: string, content: Buffer): SavedFile {
    const folder = join(this.#root, id);
    mkdirSync(folder, { recursive: true });
    const path = join(folder, safeFileName(name));
    writeFileSync(path, content, { flag: "wx" });
    chmodSync(path, 0o444);
    return {
      path,
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }

  async remove(id: string): Promise<void> {
    await rm(join(this.#root, id), { recursive: true, force: true });
  }
}
