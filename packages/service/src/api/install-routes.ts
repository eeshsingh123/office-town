import { stripVTControlCharacters } from "node:util";
import type { HarnessInstall } from "@office-town/contract";
import { startHarnessInstall } from "@office-town/harness";
import { RequestError } from "./errors.ts";
import type { Route } from "./routes.ts";

// An installer stuck on a prompt nobody can see ends on its own.
const INSTALL_TIMEOUT_MS = 10 * 60_000;
// Without colours, and only the last redraw of a progress bar, which redraws after a carriage return.
function progressLine(line: string): string {
  return stripVTControlCharacters(line.split("\r").at(-1) ?? "").trim();
}

function failureMessage(code: number | null, stderr: string, line: string | undefined): string {
  const reason = stderr.split("\n").map(progressLine).findLast(Boolean) ?? line;
  const stopped = code === null ? "The installer was stopped." : "The installer failed.";
  return reason === undefined ? stopped : `${stopped} ${reason}`;
}

// Setup's Install button (D-75): one installer per AI app at a time, and the UI asks how it went.
export function installRoutes(): Route[] {
  const installs = new Map<string, HarnessInstall>();
  return [
    {
      method: "POST",
      path: "/harnesses/:harness/install",
      reply: async ({ param }) => {
        const harness = param("harness");
        const running = installs.get(harness);
        if (running?.state === "running") return { status: 200, json: running };
        let install: HarnessInstall = { state: "running" };
        installs.set(harness, install);
        const process = await startHarnessInstall(harness, (output) => {
          const line = progressLine(output);
          if (line === "") return;
          install = { ...install, line };
          installs.set(harness, install);
        }).catch((error: unknown) => {
          installs.delete(harness);
          throw error;
        });
        if (process === undefined) {
          installs.delete(harness);
          throw new RequestError(400, "invalid_request", "This app cannot be installed from here.");
        }
        const timer = setTimeout(() => void process.stop(), INSTALL_TIMEOUT_MS);
        void process.exited.then(({ code, stderr }) => {
          clearTimeout(timer);
          install =
            code === 0
              ? { state: "done" }
              : { state: "failed", message: failureMessage(code, stderr, install.line) };
          installs.set(harness, install);
        });
        return { status: 200, json: install };
      },
    },
    {
      method: "GET",
      path: "/harnesses/:harness/install",
      reply: ({ param }) => {
        const install = installs.get(param("harness"));
        if (install === undefined) {
          throw new RequestError(404, "not_found", "No installer has run for this app.");
        }
        return { status: 200, json: install };
      },
    },
  ];
}
