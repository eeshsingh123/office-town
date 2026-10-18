import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

// A small app for tests and live checks: one read and one change.
function notesServer(notes: string[]): McpServer {
  const server = new McpServer({ name: "notes", version: "1" });
  server.registerTool(
    "search_notes",
    {
      description: "Find notes that contain some text.",
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ query }) => ({
      content: [
        { type: "text", text: notes.filter((note) => note.includes(query)).join("\n") || "None" },
      ],
    }),
  );
  server.registerTool(
    "create_note",
    { description: "Save a new note.", inputSchema: { text: z.string() } },
    ({ text }) => {
      notes.push(text);
      return { content: [{ type: "text", text: `Saved note ${notes.length}.` }] };
    },
  );
  return server;
}

const SEED = ["Pricing: the team plan is 12 dollars a seat.", "Launch is on Friday."];

export interface NotesApp {
  url: string;
  notes: string[];
  close(): Promise<void>;
}

// Stateless: a fresh server per request, as the SDK's own example does.
export async function startNotesApp(port = 0, token?: string): Promise<NotesApp> {
  const notes = [...SEED];
  const http = createServer(async (request, response) => {
    if (token !== undefined && request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    // Without a session id generator it is stateless.
    const transport = new StreamableHTTPServerTransport({});
    response.on("close", () => transport.close());
    await notesServer(notes).connect(transport as Transport);
    await transport.handleRequest(request, response);
  });
  http.listen(port, "127.0.0.1");
  await once(http, "listening");
  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
    notes,
    async close() {
      http.closeAllConnections();
      http.close();
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.includes("--stdio")) {
    await notesServer([...SEED]).connect(new StdioServerTransport());
  } else {
    const app = await startNotesApp(Number(process.argv[2] ?? 0));
    console.log(app.url);
  }
}
