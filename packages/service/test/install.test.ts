import type { InstallExit, RunningInstall } from "@office-town/harness";
import { describe, expect, it } from "vitest";
import { installRoutes } from "../src/api/install-routes.ts";
import type { Route, RouteRequest } from "../src/api/routes.ts";

const request: RouteRequest = {
  param: () => "opencode",
  query: new URLSearchParams(),
  body: async () => ({}),
  bytes: async () => Buffer.alloc(0),
};

function routes(start: Parameters<typeof installRoutes>[0]) {
  const all = installRoutes(start);
  const find = (method: Route["method"]) => all.find((route) => route.method === method);
  return { post: find("POST"), get: find("GET") };
}

describe("install routes", () => {
  it("refuses an app with no installer here, and reports nothing for it", async () => {
    const { post, get } = routes(async () => undefined);
    await expect(post?.reply(request)).rejects.toMatchObject({ status: 400 });
    expect(() => get?.reply(request)).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("shows the installer's latest line, then its last error line when it fails", async () => {
    const exit = Promise.withResolvers<InstallExit>();
    let print = (_line: string) => {};
    const { post, get } = routes(async (_harness, onLine) => {
      print = onLine;
      return { exited: exit.promise, stop: async () => {} } satisfies RunningInstall;
    });
    await post?.reply(request);
    print("\u001b[32m 10%\r 55%\u001b[0m");
    expect(await get?.reply(request)).toMatchObject({ json: { state: "running", line: "55%" } });

    exit.resolve({ code: 1, stderr: "npm error code E404\nnpm error 404 Not Found\n" });
    await exit.promise;
    expect(await get?.reply(request)).toMatchObject({
      json: { state: "failed", message: "The installer failed. npm error 404 Not Found" },
    });
  });
});
