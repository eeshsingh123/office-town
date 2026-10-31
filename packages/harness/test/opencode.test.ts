import path from "node:path";
import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { opencodeAdapter } from "../src/adapters/opencode/adapter.ts";
import { describeAdapterConformance } from "./support/conformance.ts";
import { loadRecording, replay, replayOptions } from "./support/replay.ts";

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
const withEffort = (effort: string) => ({ ...replayOptions, effort });

describeAdapterConformance(opencodeAdapter, recordings);

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

  it("attaches the core's tool servers over ACP, keeps their tokens out of the reported lines, allows their tools, and reports calls to them as theirs", async () => {
    const toolServer = { name: "office-town", url: "http://127.0.0.1:1/mcp", token: "secret" };
    const attached = {
      transport: "http" as const,
      name: "office-town",
      token: "secret",
      url: toolServer.url,
      headers: { Authorization: "Bearer secret" },
    };
    expect(configOf({ ...replayOptions, toolServers: [attached] }).permission).toMatchObject({
      "office-town_*": "allow",
    });

    const { events, written, lines } = await replay(
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
    // The token reaches the harness, never the lines the core stores.
    expect(lines.map((line) => line.text).join("\n")).not.toContain("secret");
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

  it("performs the handshake, then sends the prompt once the session exists, resuming an earlier one when given", async () => {
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

    const resumeSessionId = "ses_f01fc672affeHbUsfz1oeMbkVA";
    const resumed = await replay(opencodeAdapter, recording("resumed"), {
      ...replayOptions,
      resumeSessionId,
    });
    const sent = resumed.written.map((line) => JSON.parse(line));
    expect(sent.map((message) => message.method)).toEqual([
      "initialize",
      "session/resume",
      "session/prompt",
    ]);
    expect(sent[1].params).toMatchObject({ sessionId: resumeSessionId, cwd: "/workspace" });
    expect(sent[2].params.sessionId).toBe(resumeSessionId);
    expect(only(resumed.events, "session.started")[0]?.payload.harnessSessionId).toBe(
      resumeSessionId,
    );
  });

  it("sets the chosen effort before the first prompt, or names the values the model offers", async () => {
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

    const invalid = await replay(
      opencodeAdapter,
      effortRecording.slice(0, 2),
      withEffort("extreme"),
    );

    expect(invalid.written.some((line) => line.includes("session/set_config_option"))).toBe(false);
    expect(only(invalid.events, "error")[0]?.payload).toEqual({
      message: `This model's effort can be low, medium, high, default, so "extreme" was ignored.`,
      fatal: false,
    });
  });

  it("starts an action once its input is known, passes the options through, fails it once denied, and counts thinking as output", async () => {
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
    // The turn's usage is its last model step, which is the conversation's length.
    expect(only(events, "turn.ended")[0]?.payload.usage).toEqual({
      inputTokens: 10405,
      outputTokens: 1025,
      cachedInputTokens: 10297,
      contextTokens: 11430,
    });

    const denied = await replay(opencodeAdapter, recordings["write-denied"]);
    expect(only(denied.events, "permission.resolved")[0]?.payload.outcome).toBe("denied");
    expect(only(denied.events, "action.ended")[0]?.payload.outcome).toBe("failed");
  });

  it("recounts a conversation from its export: every model step, its thinking, and its sub-agents", () => {
    const step = (input: number, output: number, reasoning: number, read: number) => ({
      info: {
        role: "assistant",
        tokens: { input, output, reasoning, cache: { read, write: 0 } },
      },
      parts: [],
    });
    const exported = {
      info: { id: "ses_parent" },
      messages: [
        { info: { role: "user" }, parts: [{ type: "text" }] },
        {
          ...step(100, 10, 5, 1000),
          parts: [
            {
              type: "tool",
              tool: "task",
              state: { metadata: { sessionId: "ses_child", parentSessionId: "ses_parent" } },
            },
          ],
        },
        step(50, 20, 0, 1200),
      ],
    };
    const recount = opencodeAdapter.recount;

    expect(recount?.command("ses_parent").args).toEqual(["export", "ses_parent"]);
    expect(recount?.parse(`Exporting session…\n${JSON.stringify(exported)}`)).toEqual({
      usage: { inputTokens: 2350, outputTokens: 35, cachedInputTokens: 2200 },
      children: ["ses_child"],
    });
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

  it("delivers a waiting prompt once a tool ends, by cancelling, as one turn that goes on", async () => {
    const [initialized, created, firstPrompt] = recordings["two-turns"];
    const update = (sessionUpdate: string, status: string) => ({
      receive: {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "ses_f02f20244ffeGZ3GTsAkqcIE1h",
          update: { sessionUpdate, toolCallId: "call-1", title: "bash", kind: "execute", status },
        },
      },
    });
    const answer = (id: number, stopReason: string, inputTokens: number) => ({
      receive: {
        jsonrpc: "2.0",
        id,
        result: { stopReason, usage: { inputTokens, outputTokens: 1 } },
      },
    });
    const { events, written } = await replay(opencodeAdapter, [
      initialized,
      created,
      firstPrompt,
      update("tool_call", "in_progress"),
      { send: { type: "prompt", text: "from the user" } },
      update("tool_call_update", "completed"),
      answer(3, "cancelled", 10),
      answer(4, "end_turn", 5),
    ] as (typeof recordings)["two-turns"]);

    const sent = written.map((line) => JSON.parse(line));
    expect(sent.map((message) => message.method).slice(-3)).toEqual([
      "session/prompt",
      "session/cancel",
      "session/prompt",
    ]);
    expect(sent.at(-1).params.prompt[0].text).toBe("from the user");
    const ended = only(events, "turn.ended");
    expect(ended.map((event) => event.payload.outcome)).toEqual(["completed"]);
    expect(ended[0]?.payload.usage?.inputTokens).toBe(15);
    expect(events.findLast((event) => event.type === "turn.started")?.sequence).toBeGreaterThan(
      events.findLast((event) => event.type === "message")?.sequence ?? 0,
    );
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
});
