import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentRecord,
  type DepartmentRecord,
  type HarnessCatalog,
  type Team,
  userRequestEventSchema,
} from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApiServer, startApiServer } from "../src/api/server.ts";
import { SessionRegistry } from "../src/registry/session-registry.ts";
import { openStore } from "../src/store/sqlite-store.ts";
import type { Store } from "../src/store/store.ts";
import { cachedCatalogs } from "../src/team/catalogs.ts";
import { proposeTeam } from "../src/team/propose-team.ts";
import { askUser } from "../src/tools/ask-user.ts";
import { type RunningToolServer, startToolServer } from "../src/tools/tool-server.ts";
import { FakeSession } from "./support/fake-session.ts";

const TOKEN = "test-token";
const native = { kind: "native" } as const;
const catalogs: Record<string, HarnessCatalog> = {
  claude: { models: [{ id: "haiku", name: "Haiku", efforts: [] }] },
  opencode: {
    models: [{ id: "opencode-go/free-model", name: "Free", access: "free", efforts: ["low"] }],
  },
};

let directory: string;
let store: Store;
let tools: RunningToolServer;
let registry: SessionRegistry;
let server: ApiServer;
let sessions: FakeSession[];

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // The test reads the few fields it checks; the schemas are proven elsewhere.
  // biome-ignore lint/suspicious/noExplicitAny: a test reading JSON replies
  const json: any = response.status === 204 ? {} : await response.json();
  return { status: response.status, json };
}

async function propose(session: FakeSession, input: object) {
  const response = await fetch(tools.url, {
    method: "POST",
    headers: { authorization: `Bearer ${session.extras.toolServers?.[0]?.token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "propose_team", arguments: input },
    }),
  });
  const { result } = (await response.json()) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  return { text: result.content[0]?.text ?? "", isError: result.isError === true };
}

function waitingProposal() {
  const event = userRequestEventSchema.parse(store.listPendingRequests().requests[0]?.event);
  if (event.type !== "proposal.requested") throw new Error("expected a proposal");
  return event;
}

async function answer(sessionId: string, requestId: string, decision: object) {
  return call("POST", `/sessions/${sessionId}/commands`, {
    type: "answerProposal",
    requestId,
    answer: decision,
  });
}

const workersOf = async (department: DepartmentRecord) =>
  ((await call("GET", "/agents")).json as AgentRecord[])
    .filter((agent) => agent.departmentId === department.id && agent.id !== department.leadAgentId)
    .map((agent) => [agent.name, agent.role]);

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-team-"));
  store = openStore(join(directory, "data"));
  tools = await startToolServer(store);
  sessions = [];
  registry = new SessionRegistry(
    store,
    (_options, extras) => {
      const session = new FakeSession(extras);
      sessions.push(session);
      return session;
    },
    tools,
  );
  const readCatalog = cachedCatalogs(async (harness) => {
    const catalog = catalogs[harness];
    if (catalog === undefined) throw new Error("not installed");
    return catalog;
  });
  tools.offer([askUser(registry), proposeTeam({ store, registry, readCatalog })]);
  server = await startApiServer({ registry, store, readCatalog, token: TOKEN, port: 0 });
});

afterEach(async () => {
  await server.close();
  await registry.close();
  await tools.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("teams", () => {
  it("lets a new lead propose its team, which the user edits and approves into a department", async () => {
    const project = join(directory, "bakery");
    mkdirSync(project);
    const workspace = (await call("POST", "/workspaces", { name: "Bakery", folders: [project] }))
      .json;
    const started = await call("POST", "/tasks/team", {
      goal: "Build a bakery site",
      team: {
        lead: { settings: { harness: "claude", environment: native } },
        workspaceId: workspace.id,
        autonomy: "trusted",
      },
    });
    expect(started.status).toBe(201);
    const [lead] = sessions;
    if (lead === undefined) throw new Error("expected the lead to start");
    expect(lead.sent[1]).toMatchObject({ origin: { kind: "brief" } });
    expect(JSON.stringify(lead.sent[1])).toContain("opencode-go/free-model (free)");

    const wrong = await propose(lead, {
      name: "Web team",
      roles: [{ role: "Writer", purpose: "Writes", harness: "claude", model: "opus-9" }],
    });
    expect(wrong).toMatchObject({ isError: true, text: expect.stringContaining("haiku") });
    const roles = [
      {
        role: "Frontend developer",
        purpose: "Builds the page",
        harness: "opencode",
        model: "opencode-go/free-model",
      },
      { role: "Copywriter", purpose: "Writes the menu", harness: "claude", model: "haiku" },
    ];
    expect((await propose(lead, { name: "Web team", roles })).isError).toBe(false);
    const proposal = waitingProposal();
    expect(proposal.payload.place).toEqual({
      workspaceName: "Bakery",
      folders: [project],
      autonomy: "trusted",
    });

    // The user renames a role before approving.
    const team: Team = proposal.payload.team;
    const [frontend, writer] = team.roles;
    if (frontend === undefined || writer === undefined) throw new Error("expected two roles");
    const edited = { ...team, roles: [frontend, { ...writer, role: "Writer" }] };
    const { requestId } = proposal.payload;
    expect(
      (await answer(started.json.id, requestId, { outcome: "approved", team: edited })).status,
    ).toBe(204);
    const [department] = (await call("GET", "/departments")).json as DepartmentRecord[];
    if (department === undefined) throw new Error("expected the department");
    expect(department).toMatchObject({
      name: "Web team",
      autonomy: "trusted",
      branchPerWorker: true,
    });
    expect((await workersOf(department)).map(([, role]) => role)).toEqual([
      "Frontend developer",
      "Writer",
    ]);
    expect((await call("GET", `/tasks/${started.json.taskId}`)).json.task.departmentId).toBe(
      department.id,
    );
    expect(lead.sent.at(-1)).toMatchObject({
      origin: { kind: "notice", summary: "You approved the team: Frontend developer, Writer" },
    });

    // One goal at a time: the department is at work.
    const second = await call("POST", "/tasks/team", {
      goal: "Another",
      team: { departmentId: department.id },
    });
    expect(second.status).toBe(409);

    // A change keeps the writer by name, drops the frontend developer and adds a tester. Declined
    // first, so nothing changes; then approved.
    const [, writerName] = (await workersOf(department)).map(([name]) => name);
    const change = {
      name: "Web team",
      roles: [
        { role: "Writer", purpose: "Writes the menu", harness: "claude", keep: writerName },
        { role: "Tester", purpose: "Checks the page", harness: "claude" },
      ],
    };
    await propose(lead, change);
    await answer(started.json.id, waitingProposal().payload.requestId, { outcome: "declined" });
    expect((await workersOf(department)).length).toBe(2);
    await propose(lead, change);
    const changed = waitingProposal();
    expect(changed.payload.departmentId).toBe(department.id);
    await answer(started.json.id, changed.payload.requestId, {
      outcome: "approved",
      team: changed.payload.team,
    });
    expect(await workersOf(department)).toEqual([
      [writerName, "Writer"],
      [expect.any(String), "Tester"],
    ]);

    // A change made by hand reaches the lead at work.
    const byHand = {
      name: "Web team",
      roles: [
        {
          role: "Designer",
          purpose: "Draws",
          settings: { harness: "claude", environment: native },
        },
      ],
    };
    expect((await call("PUT", `/departments/${department.id}/team`, byHand)).status).toBe(200);
    expect(lead.sent.at(-1)).toMatchObject({
      origin: { kind: "notice", summary: expect.stringContaining("joined as Designer") },
    });
  });
});
