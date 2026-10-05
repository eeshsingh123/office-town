import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export const BRIDGE_TOKEN = "OFFICE_TOWN_TOOL_TOKEN";

const INTERNAL_ERROR = -32603;

function idOf(line: string): unknown {
  try {
    return (JSON.parse(line) as { id?: unknown }).id;
  } catch {
    return undefined;
  }
}

async function forward(url: string, token: string, line: string): Promise<string | undefined> {
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
    if (response.status === 202) return undefined;
    if (response.ok && text.trim() !== "") return JSON.stringify(JSON.parse(text));
    throw new Error(`the tool server answered ${response.status}`);
  } catch (error) {
    // The harness reads stderr as the server's log.
    process.stderr.write(`Office Town tool bridge: ${error}\n`);
    // A request still gets an answer, so the harness does not wait on it until its timeout.
    const id = idOf(line);
    if (id === undefined) return undefined;
    const message = `Office Town's tool server could not be reached: ${error}`;
    return JSON.stringify({ jsonrpc: "2.0", id, error: { code: INTERNAL_ERROR, message } });
  }
}

// A stdio MCP server that forwards each JSON-RPC line to the core's tool server over HTTP. It runs
// on Windows for a harness in WSL, where 127.0.0.1 is the Windows machine's own.
function bridge(url: string, token: string): void {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", async (line) => {
    if (line.trim() === "") return;
    const answer = await forward(url, token, line);
    if (answer !== undefined) process.stdout.write(`${answer}\n`);
  });
  lines.on("close", () => process.exit(0));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  bridge(process.argv[2] ?? "", process.env[BRIDGE_TOKEN] ?? "");
}
