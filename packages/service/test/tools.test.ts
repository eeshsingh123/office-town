import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionOptions } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postUpdate } from "../src/feed/post-update.ts";
import { ProgressMarks, postProgress } from "../src/feed/progress.ts";
import { FeedProjector, taskKey } from "../src/feed/projector.ts";
import { SessionRegistry } from "../src/registry/session-registry.ts";
import { openStore } from "../src/store/sqlite-store.ts";
import type { Store } from "../src/store/store.ts";
import { TaskStates } from "../src/team/task-state.ts";
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
let feed: FeedProjector;

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
  const states = new TaskStates(store);
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
  states.follow(registry);
  feed = new FeedProjector(store, registry);
  new ProgressMarks(store, registry);
  tools.offer([askUser(registry), postUpdate(store), postProgress(store)]);
});

afterEach(async () => {
  feed.stop();
  await registry.close();
  await tools.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("tool server", () => {
  // Feed (D-137, D-138): one card while the task works, the ask as a post that closes when
  // answered, an agent's posts capped into its card, and a restart that writes nothing twice.
  // Progress updates (D-141): not offered while off, refused with nothing new or too soon, and
  // taken in place on the card, which moves to the top.
  it("serves only the session it gave a token, puts ask_user's question in Needs you and Feed, sends the answer back, caps an agent's posts, and takes progress updates only when earned", async () => {
    const task = store.createTask("Pick a colour");
    const agent = addAgent(store);
    const session = await registry.start({
      taskId: task.id,
      agentId: agent.id,
      options,
      message: { text: "Pick a colour" },
    });
    const token = sessions[0]?.extras.toolServers?.[0]?.token;
    feed.start();
    await vi.waitFor(() => expect(store.feed.byKey(taskKey(task.id))?.kind).toBe("living"));

    expect((await rpc(undefined, "tools/list")).status).toBe(401);
    expect((await rpc("not-a-token", "tools/list")).status).toBe(401);
    const listed = await rpc(token, "tools/list");
    expect(listed.body.result.tools.map((tool) => tool.name)).toEqual(["ask_user", "post_update"]);
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
    const asks = () => store.feed.page({ show: "needs-you" }).posts;
    await vi.waitFor(() => expect(asks().map((post) => post.state)).toEqual(["open"]), 5000);
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
    await vi.waitFor(() => expect(asks().map((post) => post.state)).toEqual(["answered"]));

    for (const title of ["One", "Two", "Three", "Four"]) {
      await rpc(token, "tools/call", { name: "post_update", arguments: { title } });
    }
    const posted = store.feed
      .page({ show: "all" })
      .posts.filter((post) => post.kind === "heads-up");
    expect(posted.map((post) => post.title)).toEqual(["Three", "Two", "One"]);
    expect(store.feed.byKey(taskKey(task.id))?.note).toBe("Four");

    const count = store.feed.page({ show: "all" }).posts.length;
    const again = new FeedProjector(store, registry);
    again.start();
    await new Promise((resolve) => setTimeout(resolve, 400));
    again.stop();
    expect(store.feed.page({ show: "all" }).posts).toHaveLength(count);

    const progress = (title: string) =>
      rpc(token, "tools/call", { name: "post_progress", arguments: { title } });
    const text = (reply: Awaited<ReturnType<typeof rpc>>) =>
      reply.body.result?.content[0]?.text ?? "";
    expect(listed.body.result.tools.map((tool) => tool.name)).not.toContain("post_progress");
    await progress("Off");
    expect(store.feed.updatesOf(task.id)).toEqual([]);
    store.setTaskUpdates(task.id, true);
    expect(text(await progress("Too early"))).toContain("nothing new");
    const milestone = store.createMilestone({
      taskId: task.id,
      outcome: "Blue everywhere",
      see: "Every page is blue",
      origin: "agent",
    });
    store.updateMilestone(milestone.id, { status: "met" });
    expect(text(await progress("Blue is in"))).toContain("Posted");
    const card = store.feed.byKey(taskKey(task.id));
    expect(card?.update).toMatchObject({
      title: "Blue is in",
      after: 'After "Blue everywhere" was met',
    });
    expect(card?.updates).toBe(1);
    expect(store.feed.page({ show: "all" }).posts[0]?.id).toBe(card?.id);
    store.updateMilestone(milestone.id, { status: "not_met" });
    expect(text(await progress("Again"))).toContain("30 minutes apart");
    expect(store.feed.updatesOf(task.id).map((update) => update.title)).toEqual(["Blue is in"]);

    await registry.stop(session.id);
    expect((await rpc(token, "tools/list")).status).toBe(401);
  });
});
