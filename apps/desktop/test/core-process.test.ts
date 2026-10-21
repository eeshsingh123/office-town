import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore } from "../electron/core-process.ts";

const CORE_ENTRY = fileURLToPath(new URL("../../../packages/service/src/main.ts", import.meta.url));
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
    // Well under the stop timeout, so it ended on its own; a loaded machine can take seconds.
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(onCrash).not.toHaveBeenCalled();
  });
});
