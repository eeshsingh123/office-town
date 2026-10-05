import path from "node:path";
import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { opencodeAdapter } from "../src/adapters/opencode/adapter.ts";
import { describeAdapterConformance } from "./support/conformance.ts";
import { loadLines, loadRecording, replay, replayOptions } from "./support/replay.ts";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", "opencode", name);
const recording = (name: string) => loadRecording(fixture(`${name}.jsonl`));

const recordings = {
  "write-allowed": recording("write-allowed"),
  "write-denied": recording("write-denied"),
  "plan-and-subagent": recording("plan-and-subagent"),
  "two-turns": recording("two-turns"),
  "interrupt-pending-permission": recording("interrupt-pending-permission"),
  "team-tool": recording("team-tool"),
};
// Recorded with an effort chosen, so it only replays correctly with one.
const effortRecording = recording("effort");
const catalogOutput = loadLines(fixture("catalog.txt"));
const withEffort = (effort: string) => ({ ...replayOptions, effort });

describeAdapterConformance(opencodeAdapter, recordings, catalogOutput);

function only<T extends SessionEvent["type"]>(events: SessionEvent[], type: T) {
  return events.filter((event): event is Extract<SessionEvent, { type: T }> => event.type === type);
}

function configOf(options: Parameters<typeof opencodeAdapter.buildCommand>[0]) {
  const command = opencodeAdapter.buildCommand(options);
  return JSON.parse(command.env?.OPENCODE_CONFIG_CONTENT ?? "{}");
}

describe("opencode adapter", () => {
  it("passes the permission mode, model and additional folders as inline config, leaving the user's config alone", () => {
    expect(opencodeAdapter.buildCommand(replayOptions)).toMatchObject({
      binary: "opencode",
      args: ["acp"],
    });
    expect(configOf(replayOptions)).toEqual({
      permission: { edit: "ask", bash: "ask", webfetch: "ask" },
    });
    const tuned = {
      ...replayOptions,
      permissionMode: "bypass" as const,
      model: "a/b",
      additionalPaths: ["/notes/", "C:\\Data"],
    };
    expect(configOf(tuned)).toEqual({
      permission: {
        edit: "allow",
        bash: "allow",
        webfetch: "allow",
        external_directory: { "/notes/*": "allow", "C:\\Data\\*": "allow" },
      },
      model: "a/b",
    });
  });

  it("attaches the core's tool servers over ACP, allows their tools, and reports calls to them as theirs", async () => {
    const toolServer = { name: "office-town", url: "http://127.0.0.1:1/mcp", token: "secret" };
    const attached = {
      transport: "http" as const,
      name: "office-town",
      url: toolServer.url,
      headers: { Authorization: "Bearer secret" },
    };
    expect(configOf({ ...replayOptions, toolServers: [attached] }).permission).toMatchObject({
      "office-town_*": "allow",
    });

    const { events, written } = await replay(
      opencodeAdapter,
      recordings["team-tool"],
      replayOptions,
      { toolServers: [toolServer] },
    );
    const opened = JSON.parse(written[1] ?? "");
    expect(opened.method).toBe("session/new");
    expect(opened.params.mcpServers).toEqual([
      {
        type: "http",
        name: "office-town",
        url: toolServer.url,
        headers: [{ name: "Authorization", value: "Bearer secret" }],
      },
    ]);
    expect(only(events, "action.started").map((event) => event.payload.tool)).toEqual([
      { server: "office-town", name: "ask_user" },
    ]);
  });

  it("turns off what it can when isolated, and says what still loads", () => {
    const env = opencodeAdapter.buildCommand({ ...replayOptions, isolated: true }).env ?? {};
    expect(env).toMatchObject({
      OPENCODE_PURE: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    });
    expect(opencodeAdapter.buildCommand(replayOptions).env?.OPENCODE_PURE).toBeUndefined();
    expect(opencodeAdapter.capabilities.isolation).toBe("partial");
    expect(opencodeAdapter.isolationNote).toContain("global");
  });

  it("performs the handshake, then sends the prompt once the session exists", async () => {
    const { events, written } = await replay(opencodeAdapter, recordings["write-allowed"]);

    expect(written.slice(0, 3).map((line) => JSON.parse(line).method)).toEqual([
      "initialize",
      "session/new",
      "session/prompt",
    ]);
    expect(only(events, "session.started")[0]?.payload).toEqual({
      harnessSessionId: "ses_f02f3e6afffe7FEhhi26uQhMlv",
      model: "opencode/big-pickle",
    });
  });

  it("reads its models from the CLI's list, with each model's provider, what it costs, and its variants as its effort values, leaving out models that cannot call tools", () => {
    expect(opencodeAdapter.catalog?.parse(catalogOutput).models).toEqual([
      {
        id: "opencode/big-pickle",
        name: "Big Pickle",
        provider: "opencode",
        access: "free",
        efforts: [],
      },
      {
        id: "opencode/ling-3.1-flash-free",
        name: "Ling 3.1 Flash Free",
        provider: "opencode",
        access: "free",
        efforts: ["low", "medium", "high"],
      },
      {
        id: "opencode-go/deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        provider: "opencode-go",
        access: "plan",
        efforts: ["low", "high", "max"],
      },
    ]);
  });

  it("sets the chosen effort on the new session before the first prompt", async () => {
    const { events, written } = await replay(opencodeAdapter, effortRecording, withEffort("high"));

    const sent = written.map((line) => JSON.parse(line));
    expect(sent.map((message) => message.method)).toEqual([
      "initialize",
      "session/new",
      "session/set_config_option",
      "session/prompt",
    ]);
    expect(sent[2].params).toMatchObject({ configId: "effort", value: "high" });
    expect(only(events, "error")).toEqual([]);
    expect(only(events, "turn.ended")[0]?.payload.outcome).toBe("completed");
  });

  it("says which effort values the model offers when the chosen one is not among them", async () => {
    const { events, written } = await replay(
      opencodeAdapter,
      effortRecording.slice(0, 2),
      withEffort("extreme"),
    );

    expect(written.some((line) => line.includes("session/set_config_option"))).toBe(false);
    expect(only(events, "error")[0]?.payload).toEqual({
      message: `This model's effort can be low, medium, high, default, so "extreme" was ignored.`,
      fatal: false,
    });
  });

  it("starts an action once its input is known and passes the harness's options through", async () => {
    const { events, written } = await replay(opencodeAdapter, recordings["write-allowed"]);

    const [write, shell] = only(events, "action.started");
    expect(write?.payload).toMatchObject({
      kind: "edit",
      title: "write",
      input: { content: "hi", filePath: "C:\\work\\hello.txt" },
      locations: ["C:\\work\\hello.txt"],
    });
    expect(shell?.payload).toMatchObject({ kind: "execute", title: "echo done" });

    const [request] = only(events, "permission.requested");
    expect(request?.payload.actionId).toBe(write?.payload.actionId);
    expect(request?.payload.options).toEqual([
      { optionId: "once", label: "Allow once", kind: "allow_once" },
      { optionId: "always", label: "Always allow", kind: "allow_always" },
      { optionId: "reject", label: "Reject", kind: "reject_once" },
    ]);
    expect(written.map((line) => JSON.parse(line))).toContainEqual({
      jsonrpc: "2.0",
      id: 0,
      result: { outcome: { outcome: "selected", optionId: "once" } },
    });
  });

  it("joins streamed fragments into whole messages and reasoning", async () => {
    const allowed = await replay(opencodeAdapter, recordings["write-allowed"]);
    const denied = await replay(opencodeAdapter, recordings["write-denied"]);

    const replies = only(allowed.events, "message").filter((e) => e.payload.role === "assistant");
    expect(replies.map((event) => event.payload.text)).toEqual([
      'Created hello.txt with "hi"\ndone',
    ]);
    expect(only(denied.events, "reasoning")).toHaveLength(1);
    expect(only(denied.events, "reasoning.delta").length).toBeGreaterThan(1);
    expect(only(denied.events, "reasoning")[0]?.payload.text).toContain("use the write tool.");
  });

  it("reports streamed command output once, then the result", async () => {
    const { events } = await replay(opencodeAdapter, recordings["write-allowed"]);

    expect(only(events, "action.updated").map((event) => event.payload.output)).toEqual(["done\n"]);
    expect(only(events, "action.ended").map((event) => event.payload.result)).toEqual([
      "Wrote file successfully.",
      "done\n",
    ]);
  });

  it("resumes an earlier session instead of creating one, and reports its id", async () => {
    const resumeSessionId = "ses_f01fc672affeHbUsfz1oeMbkVA";
    const { events, written } = await replay(opencodeAdapter, recording("resumed"), {
      ...replayOptions,
      resumeSessionId,
    });

    const sent = written.map((line) => JSON.parse(line));
    expect(sent.map((message) => message.method)).toEqual([
      "initialize",
      "session/resume",
      "session/prompt",
    ]);
    expect(sent[1].params).toMatchObject({ sessionId: resumeSessionId, cwd: "/workspace" });
    expect(sent[2].params.sessionId).toBe(resumeSessionId);
    expect(only(events, "session.started")[0]?.payload.harnessSessionId).toBe(resumeSessionId);
    expect(only(events, "turn.ended")[0]?.payload.outcome).toBe("completed");
  });

  it("fails the action when the user denies it", async () => {
    const { events } = await replay(opencodeAdapter, recordings["write-denied"]);

    expect(only(events, "permission.resolved")[0]?.payload.outcome).toBe("denied");
    expect(only(events, "action.ended")[0]?.payload.outcome).toBe("failed");
  });

  it("reads the todo list as the plan and a sub-agent call as a delegation", async () => {
    const { events } = await replay(opencodeAdapter, recordings["plan-and-subagent"]);

    expect(only(events, "plan.updated").map((event) => event.payload.steps)).toEqual([
      [
        { id: "1", title: "look at files", status: "in_progress" },
        { id: "2", title: "report", status: "pending" },
      ],
      [
        { id: "1", title: "look at files", status: "completed" },
        { id: "2", title: "report", status: "completed" },
      ],
    ]);
    expect(only(events, "action.started").map((event) => event.payload)).toEqual([
      expect.objectContaining({ kind: "delegate", title: "Glob for txt files", planStepId: "1" }),
    ]);
  });

  it("answers a pending permission as cancelled when interrupted, and stays usable", async () => {
    const { events, written } = await replay(
      opencodeAdapter,
      recordings["interrupt-pending-permission"],
    );

    expect(written.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "session/cancel" }),
        { jsonrpc: "2.0", id: 0, result: { outcome: { outcome: "cancelled" } } },
      ]),
    );
    expect(only(events, "permission.resolved")[0]?.payload.outcome).toBe("cancelled");
    expect(only(events, "turn.ended").map((event) => event.payload.outcome)).toEqual([
      "interrupted",
      "completed",
    ]);
  });

  it("holds a second prompt until the turn in progress ends", async () => {
    const [initialized, created, firstPrompt, ...rest] = recordings["two-turns"];
    const { written } = await replay(opencodeAdapter, [
      initialized,
      created,
      firstPrompt,
      { send: { type: "prompt", text: "queued" } },
      ...rest.filter((entry) => "receive" in entry),
    ] as typeof rest);

    const prompts = written
      .map((line) => JSON.parse(line))
      .filter((message) => message.method === "session/prompt");
    expect(prompts.map((message) => message.params.prompt[0].text)).toEqual([
      "Run the shell command: sleep 20",
      "queued",
    ]);
    expect(written.findIndex((line) => line.includes("queued"))).toBeGreaterThan(
      written.findIndex((line) => line.includes('"optionId":"once"')),
    );
  });

  it("ends the session as failed when the harness rejects the handshake", async () => {
    const { events } = await replay(opencodeAdapter, [
      { receive: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Not logged in" } } },
    ]);

    expect(events.map((event) => [event.type, event.payload])).toEqual([
      ["error", { message: 'The harness rejected "initialize": Not logged in', fatal: true }],
      ["session.ended", { reason: "failed", exitCode: null }],
    ]);
  });
});
