import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";

const BRIDGE = join(import.meta.dirname, "..", "src", "environment", "tool-bridge.ts");

describe("tool bridge", () => {
  it("forwards each line to the tool server with the token, and answers every request", async () => {
    const seen: { authorization: string | undefined; body: string }[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      seen.push({ authorization: request.headers.authorization, body });
      const message = JSON.parse(body);
      if (message.id === undefined) response.writeHead(202).end();
      else if (message.id === 2) response.writeHead(413).end();
      else response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;

    const bridge = spawn(process.execPath, [BRIDGE, url], {
      env: { ...process.env, OFFICE_TOWN_TOOL_TOKEN: "secret" },
    });
    const output = createInterface({ input: bridge.stdout });
    bridge.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    bridge.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    const [line] = (await once(output, "line")) as [string];
    bridge.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/call"}\n');
    const [refused] = (await once(output, "line")) as [string];
    bridge.stdin.end();
    await once(bridge, "exit");
    server.close();

    expect(JSON.parse(line)).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    // A request the server refuses still gets an answer, so the harness does not wait for it.
    expect(JSON.parse(refused)).toMatchObject({ id: 2, error: { code: -32603 } });
    expect(seen.map((call) => call.authorization)).toEqual(Array(3).fill("Bearer secret"));
  });
});
