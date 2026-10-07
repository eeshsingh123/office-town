import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Overflow } from "@office-town/contract";

// Larger text goes to a file: it keeps the database small and its cache full of events.
const INLINE_BYTES = 16 * 1024;
const PREVIEW_BYTES = 4 * 1024;
const FILE_CAP_BYTES = 16 * 1024 * 1024;

export interface KeptApart {
  preview: string;
  overflow: Overflow;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

// Streaming mode holds back a character cut in half instead of decoding it as garbage.
export function utf8Prefix(data: Buffer, bytes: number): string {
  return new TextDecoder().decode(data.subarray(0, bytes), { stream: true });
}

function utf8Suffix(data: Buffer, bytes: number): string {
  let start = Math.max(0, data.length - bytes);
  // Skips the continuation bytes of a character cut in half.
  while (start < data.length && (data.readUInt8(start) & 0xc0) === 0x80) start += 1;
  return data.subarray(start).toString("utf8");
}

// The harness resends the whole output each update, so only the changed end is kept.
export function previewOutput(text: string): KeptApart | undefined {
  const bytes = Buffer.byteLength(text);
  if (bytes <= INLINE_BYTES) return undefined;
  return {
    preview: utf8Suffix(Buffer.from(text), PREVIEW_BYTES),
    overflow: { bytes, truncated: true },
  };
}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
}

// One folder per session, so deleting a session removes one folder.
export class ResultFiles {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  keepApart(sessionId: string, sequence: number, text: string): KeptApart | undefined {
    const bytes = Buffer.byteLength(text);
    if (bytes <= INLINE_BYTES) return undefined;
    const data = Buffer.from(text);
    const truncated = bytes > FILE_CAP_BYTES;
    const folder = join(this.#root, sessionId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, `${sequence}.txt`),
      truncated ? utf8Prefix(data, FILE_CAP_BYTES) : text,
    );
    return { preview: utf8Prefix(data, PREVIEW_BYTES), overflow: { bytes, truncated } };
  }

  read(sessionId: string, sequence: number): string | undefined {
    try {
      return readFileSync(join(this.#root, sessionId, `${sequence}.txt`), "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  remove(sessionId: string): Promise<void> {
    return rm(join(this.#root, sessionId), { recursive: true, force: true });
  }

  async size(): Promise<number> {
    const entries = await readdir(this.#root, { recursive: true, withFileTypes: true }).catch(
      (error: unknown) => {
        if (isMissing(error)) return [];
        throw error;
      },
    );
    const files = entries.filter((entry) => entry.isFile());
    const sizes = await Promise.all(
      files.map((file) => fileSize(join(file.parentPath, file.name))),
    );
    return sizes.reduce((total, size) => total + size, 0);
  }
}
