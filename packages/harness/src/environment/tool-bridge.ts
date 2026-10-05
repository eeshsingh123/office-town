import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export const BRIDGE_TOKEN = "OFFICE_TOWN_TOOL_TOKEN";

// A stdio MCP server that forwards each JSON-RPC line to the core's tool server over HTTP. It runs
// on Windows for a harness in WSL, where 127.0.0.1 is the Windows machine's own.
function bridge(url: string, token: string): void {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", async (line) => {
    if (line.trim() === "") return;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: line,
      });
      const text = await response.text();
      if (response.status === 202 || text.trim() === "") return;
      process.stdout.write(`${JSON.stringify(JSON.parse(text))}\n`);
    } catch (error) {
      // The harness reads stderr as the server's log; a lost call surfaces as its timeout.
      process.stderr.write(`Office Town tool bridge: ${error}\n`);
    }
  });
  lines.on("close", () => process.exit(0));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  bridge(process.argv[2] ?? "", process.env[BRIDGE_TOKEN] ?? "");
}
