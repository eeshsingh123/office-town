import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore } from "../electron/core-process.ts";

const CORE_ENTRY = fileURLToPath(new URL("../../../packages/service/src/main.ts", import.meta.url));
// Prints a ready line, then ignores its stdin and never exits by itself.
const STUBBORN_CORE = `
  process.stdout.write(JSON.stringify({ url: "http://127.0.0.1:1", token: "t" }) + "\\n");
  setInterval(() => {}, 1000);
`;

let folder: string | undefined;

afterEach(() => {
  if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
  folder = undefined;
});

describe("core process", () => {
  it("stops the real core by closing its stdin, without killing it", async () => {
    folder = mkdtempSync(join(tmpdir(), "office-town-core-"));
    const onCrash = vi.fn();
    const core = await startCore(
      {
        executable: process.execPath,
        args: [CORE_ENTRY, "--data-folder", folder, "--stop-when-stdin-closes"],
        env: process.env,
      },
      { onCrash, stopTimeoutMs: 60_000 },
    );
    const health = await fetch(`${core.ready.url}/tasks`, {
      headers: { authorization: `Bearer ${core.ready.token}` },
    });
    expect(health.status).toBe(200);

    const started = Date.now();
    await core.stop();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(onCrash).not.toHaveBeenCalled();
  });

  it("kills a core that does not exit in time, and reports one that exits by itself", async () => {
    const onCrash = vi.fn();
    const stubborn = await startCore(
      { executable: process.execPath, args: ["-e", STUBBORN_CORE], env: process.env },
      { onCrash, stopTimeoutMs: 200 },
    );
    await stubborn.stop();
    expect(onCrash).not.toHaveBeenCalled();

    const crashed = Promise.withResolvers<string>();
    await startCore(
      {
        executable: process.execPath,
        args: [
          "-e",
          `${STUBBORN_CORE}; setTimeout(() => { console.error("out of memory"); process.exit(3); }, 100)`,
        ],
        env: process.env,
      },
      { onCrash: crashed.resolve },
    );
    expect(await crashed.promise).toContain("out of memory");
  });
});
