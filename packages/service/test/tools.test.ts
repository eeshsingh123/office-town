import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionOptions } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionRegistry } from "../src/registry/session-registry.ts";
import { openStore } from "../src/store/sqlite-store.ts";
import type { Store } from "../src/store/store.ts";
import { askUser } from "../src/tools/ask-user.ts";
import { type RunningToolServer, startToolServer } from "../src/tools/tool-server.ts";
import { addAgent } from "./support/agents.ts";
import { FakeSession } from "./support/fake-session.ts";

const options: SessionOptions = {
  harness: "opencode",
  environment: { kind: "native" },
  permissionMode: "ask",
};

let directory: string;
let store: Store;
let tools: RunningToolServer;
let registry: SessionRegistry;
let sessions: FakeSession[];

// The parts of the answers this test reads.
interface Reply {
  result: { tools: { name: string }[]; content: { text: string }[]; isError?: boolean };
}

async function rpc(token: string | undefined, method: string, params: object = {}) {
  const response = await fetch(tools.url, {
    method: "POST",
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (response.status === 200 ? await response.json() : {}) as Reply;
  return { status: response.status, body };
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-tools-"));
  store = openStore(directory);
  tools = await startToolServer(store);
  sessions = [];
  registry = new SessionRegistry(store, {
    createSession: (_options, extras) => {
      const session = new FakeSession(extras);
      sessions.push(session);
      return session;
    },
    tools,
  });
  tools.offer([askUser(registry)]);
});

afterEach(async () => {
  await registry.close();
  await tools.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("tool server", () => {
  it("serves only the session it gave a token, puts ask_user's question in Needs you and sends the answer back", async () => {
    const task = store.createTask("Pick a colour");
    const agent = addAgent(store);
    const session = await registry.start({
      taskId: task.id,
      agentId: agent.id,
      options,
      message: { text: "Pick a colour" },
    });
    const token = sessions[0]?.extras.toolServers?.[0]?.token;

    expect((await rpc(undefined, "tools/list")).status).toBe(401);
    expect((await rpc("not-a-token", "tools/list")).status).toBe(401);
    const listed = await rpc(token, "tools/list");
    expect(listed.body.result.tools.map((tool) => tool.name)).toEqual(["ask_user"]);
    const refused = await rpc(token, "tools/call", { name: "ask_user", arguments: {} });
    expect(refused.body.result.isError).toBe(true);

    const asked = await rpc(token, "tools/call", {
      name: "ask_user",
      arguments: { question: "Red or blue?", options: ["Red", "Blue"] },
    });
    expect(asked.body.result.content[0]?.text).toContain("with the user");
    const [waiting] = store.listPendingRequests().requests;
    if (waiting?.event.type !== "question.requested") throw new Error("expected a question");
    expect(waiting.event.payload.questions[0]?.options).toEqual([
      { label: "Red" },
      { label: "Blue" },
    ]);

    const { requestId } = waiting.event.payload;
    await registry.send(session.id, {
      type: "answerQuestion",
      requestId,
      answers: [{ questionId: "1", selected: ["Blue"] }],
    });
    expect(store.listPendingRequests().requests).toEqual([]);
    expect(sessions[0]?.sent.at(-1)).toEqual({
      type: "prompt",
      text: 'The user answered your question "Red or blue?": Blue',
      origin: { kind: "answer", requestId },
    });

    await registry.stop(session.id);
    expect((await rpc(token, "tools/list")).status).toBe(401);
  });
});
