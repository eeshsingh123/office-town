import path from "node:path";
import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it, vi } from "vitest";
import { claudeAdapter } from "../src/adapters/claude/adapter.ts";
import { describeAdapterConformance } from "./support/conformance.ts";
import {
  loadLines,
  loadRecording,
  type RecordingEntry,
  replay,
  replayOptions,
} from "./support/replay.ts";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", "claude", name);
const recording = (name: string) => loadRecording(fixture(`${name}.jsonl`));

const recordings = {
  "write-allowed": recording("write-allowed"),
  "write-denied": recording("write-denied"),
  "plan-and-subagent": recording("plan-and-subagent"),
  "plan-other-names": recording("plan-other-names"),
  "interrupt-running": recording("interrupt-running"),
  "interrupt-pending-permission": recording("interrupt-pending-permission"),
  "question-answered": recording("question-answered"),
  "resumed-streamed": recording("resumed-streamed"),
  "team-tool": recording("team-tool"),
};

const toolServer = { name: "office-town", url: "http://127.0.0.1:1/mcp", token: "secret" };

const catalogOutput = loadLines(fixture("catalog.jsonl")).filter((line) => line !== "");

describeAdapterConformance(claudeAdapter, recordings, catalogOutput);

function only<T extends SessionEvent["type"]>(events: SessionEvent[], type: T) {
  return events.filter((event): event is Extract<SessionEvent, { type: T }> => event.type === type);
}

const types = (events: SessionEvent[]) => events.map((event) => event.type);

describe("claude adapter", () => {
  it("passes model, effort and additional folders to the CLI only when chosen", () => {
    const plain = claudeAdapter.buildCommand(replayOptions);
    const tuned = claudeAdapter.buildCommand({
      ...replayOptions,
      model: "sonnet",
      effort: "high",
      additionalPaths: ["/notes", "/data"],
    });

    expect(plain.binary).toBe("claude");
    expect(plain.args).not.toContain("--model");
    expect(plain.args).not.toContain("--effort");
    expect(plain.args).not.toContain("--add-dir");
    expect(tuned.args.join(" ")).toContain("--model sonnet --effort high");
    expect(tuned.args.join(" ")).toContain("--add-dir /notes --add-dir /data");
  });

  it("resumes an earlier session by its id, and reports the same id again", async () => {
    const resumeSessionId = "0036e5e3-8459-41a1-96ac-19a516ceb281";
    const command = claudeAdapter.buildCommand({ ...replayOptions, resumeSessionId });
    const { events } = await replay(claudeAdapter, recordings["resumed-streamed"]);

    expect(claudeAdapter.buildCommand(replayOptions).args).not.toContain("--resume");
    expect(command.args.join(" ")).toContain(`--resume ${resumeSessionId}`);
    expect(only(events, "session.started")[0]?.payload.harnessSessionId).toBe(resumeSessionId);
  });

  it("attaches the core's tool servers with their tokens off the command line, allows their tools, and reports calls to them as theirs", async () => {
    const headers = { Authorization: "Bearer secret" };
    const { args, env } = claudeAdapter.buildCommand({
      ...replayOptions,
      toolServers: [
        { transport: "http", name: "office-town", token: "secret", url: toolServer.url, headers },
      ],
    });
    expect(args.join(" ")).not.toContain("secret");
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1] ?? "")).toEqual({
      mcpServers: {
        "office-town": {
          type: "http",
          url: toolServer.url,
          // biome-ignore lint/suspicious/noTemplateCurlyInString: a variable Claude fills in
          headers: { Authorization: "Bearer ${OFFICE_TOWN_TOOL_TOKEN_0}" },
        },
      },
    });
    expect(env).toEqual({
      OFFICE_TOWN_TOOL_TOKEN_0: "secret",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    });
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("mcp__office-town");
    expect(claudeAdapter.buildCommand(replayOptions).args).not.toContain("--mcp-config");

    const { events } = await replay(claudeAdapter, recordings["team-tool"], replayOptions, {
      toolServers: [toolServer],
    });
    expect(only(events, "action.started").map((event) => event.payload.tool)).toEqual([
      undefined,
      { server: "office-town", name: "ask_user" },
    ]);
    expect(only(events, "permission.requested")).toEqual([]);
  });

  it("keeps out the user's and the project's own files, settings, MCP servers and skills when isolated", () => {
    const args = claudeAdapter.buildCommand({ ...replayOptions, isolated: true }).args.join(" ");
    expect(args).toContain("--setting-sources  --disable-slash-commands");
    expect(claudeAdapter.capabilities.isolation).toBe("full");
  });

  // D-68: Claude apps load for the login unless blocked, so an agent gets only its own, and
  // every call to one asks, for the core to decide.
  it("blocks the login's other Claude apps and asks before each call to an allowed one", () => {
    const { args, env } = claudeAdapter.buildCommand({
      ...replayOptions,
      vendorApps: ["claude.ai Notion"],
      blockedApps: ["claude.ai Gmail"],
    });
    expect(JSON.parse(args[args.indexOf("--settings") + 1] ?? "")).toEqual({
      deniedMcpServers: [{ serverName: "claude.ai Gmail" }],
      permissions: { ask: ["mcp__claude_ai_Notion"] },
    });
    expect(env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBeUndefined();
    expect(claudeAdapter.buildCommand(replayOptions).env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBe(
      "false",
    );
  });

  it("reports a write, asks permission for it, completes it once allowed and fails it once denied", async () => {
    const { events, written } = await replay(claudeAdapter, recordings["write-allowed"]);

    expect(types(events)).toEqual([
      "message",
      "session.started",
      "turn.started",
      "message",
      "action.started",
      "permission.requested",
      "permission.resolved",
      "action.ended",
      "action.started",
      "limits.updated",
      "action.ended",
      "message",
      "turn.ended",
      "session.ended",
    ]);
    const [write, shell] = only(events, "action.started");
    expect(write?.payload).toMatchObject({
      kind: "edit",
      title: "Write: C:\\work\\hello.txt",
      locations: ["C:\\work\\hello.txt"],
    });
    expect(shell?.payload).toMatchObject({ kind: "execute", title: "Bash: Run echo done command" });

    const [request] = only(events, "permission.requested");
    expect(request?.payload.actionId).toBe(write?.payload.actionId);
    expect(request?.payload.options.map((option) => option.kind)).toEqual([
      "allow_once",
      "allow_always",
      "reject_once",
    ]);
    expect(JSON.parse(written[1] as string)).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: request?.payload.requestId,
        response: { behavior: "allow", updatedInput: request?.payload.input },
      },
    });
    expect(only(events, "turn.ended")[0]?.payload).toMatchObject({
      outcome: "completed",
      usage: { inputTokens: 72122, outputTokens: 453, cachedInputTokens: 34545 },
    });

    const denied = await replay(claudeAdapter, recordings["write-denied"]);
    expect(JSON.parse(denied.written[1] as string).response.response.behavior).toBe("deny");
    expect(only(denied.events, "permission.resolved")[0]?.payload.outcome).toBe("denied");
    expect(only(denied.events, "action.ended")[0]?.payload).toMatchObject({ outcome: "failed" });
  });

  it("reports each window's use and reset, and the main conversation's length at each turn's end", async () => {
    const { events } = await replay(claudeAdapter, recordings["plan-and-subagent"]);

    // A sub-agent's calls have their own conversation, so they never count here.
    expect(only(events, "turn.ended").map((event) => event.payload.usage?.contextTokens)).toEqual([
      38583, 39529,
    ]);

    expect(only(events, "limits.updated")[0]?.payload.limits).toEqual([
      {
        id: "five_hour",
        label: "five hour",
        usedFraction: 0.04,
        resetsAt: "2026-10-02T16:40:00.000Z",
      },
      {
        id: "seven_day",
        label: "seven day",
        usedFraction: 0.04,
        resetsAt: "2026-10-06T13:00:00.000Z",
      },
    ]);
  });

  it("signs in through an account's own folder, and counts a refused turn as a full window", () => {
    const { env } = claudeAdapter.buildCommand({ ...replayOptions, accountFolder: "/data/work" });
    expect(env?.CLAUDE_CONFIG_DIR).toBe("/data/work");
    expect(claudeAdapter.buildCommand(replayOptions).env?.CLAUDE_CONFIG_DIR).toBeUndefined();

    const refused = {
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        rateLimitType: "five_hour",
        unifiedWindows: { five_hour: { utilization: 0.97 }, seven_day: { utilization: 0.4 } },
      },
    };
    const { events } = claudeAdapter
      .createTranslator(replayOptions)
      .receive(JSON.stringify(refused));
    expect(events).toEqual([
      {
        type: "limits.updated",
        payload: {
          limits: [
            { id: "five_hour", label: "five hour", usedFraction: 1 },
            { id: "seven_day", label: "seven day", usedFraction: 0.4 },
          ],
        },
      },
    ]);
  });

  it("offers only changes that end with the session, says what each changes, and returns it", async () => {
    const allowAlways = recordings["write-allowed"].map(
      (entry): RecordingEntry =>
        "send" in entry && entry.send.type === "answerPermission"
          ? { send: { type: "answerPermission", choose: "allow_always" } }
          : entry,
    );
    const { events, written } = await replay(claudeAdapter, allowAlways);

    const options = only(events, "permission.requested")[0]?.payload.options;
    expect(options?.find((option) => option.kind === "allow_always")?.label).toBe(
      "Allow all file edits for this session",
    );
    expect(JSON.parse(written[1] as string).response.response.updatedPermissions).toEqual([
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ]);

    const sessionRule = {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "npm test" }],
      behavior: "allow",
      destination: "session",
    };
    const request = (id: string, suggestions: unknown[]): RecordingEntry => ({
      receive: {
        type: "control_request",
        request_id: id,
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          input: {},
          permission_suggestions: suggestions,
        },
      },
    });
    const { events: offered, written: answered } = await replay(claudeAdapter, [
      request("saved-to-disk", [{ ...sessionRule, destination: "localSettings" }]),
      request("mixed", [sessionRule, { type: "setMode", mode: "acceptEdits" }]),
      { send: { type: "answerPermission", choose: "allow_always" } },
    ]);

    const [savedToDisk, mixed] = only(offered, "permission.requested");
    expect(savedToDisk?.payload.options.map((option) => option.kind)).toEqual([
      "allow_once",
      "reject_once",
    ]);
    expect(mixed?.payload.options[1]?.label).toBe("Always allow Bash (npm test) for this session");
    expect(JSON.parse(answered[0] as string).response.response.updatedPermissions).toEqual([
      sessionRule,
    ]);
  });

  it("reports a question as a question and hands the user's answer back", async () => {
    const { events, written } = await replay(claudeAdapter, recordings["question-answered"]);

    expect(only(events, "permission.requested")).toEqual([]);
    const [asked] = only(events, "question.requested");
    const [question] = asked?.payload.questions ?? [];
    expect(question?.options.map((option) => option.label)).toEqual(["Red", "Blue"]);
    expect(question?.multiSelect).toBe(false);
    expect(asked?.payload.actionId).toBe(only(events, "action.started")[0]?.payload.actionId);

    expect(JSON.parse(written[1] as string).response.response).toMatchObject({
      behavior: "allow",
      updatedInput: { answers: { [question?.text as string]: "Blue" } },
    });
    expect(only(events, "question.resolved")[0]?.payload).toEqual({
      requestId: asked?.payload.requestId,
      outcome: "answered",
      answers: [{ questionId: "1", selected: ["Blue"] }],
    });
    expect(only(events, "action.ended")[0]?.payload.result).toContain("Blue");
  });

  it("builds the plan from task tool calls instead of reporting them as actions", async () => {
    const { events } = await replay(claudeAdapter, recordings["plan-and-subagent"]);

    expect(only(events, "plan.updated").at(-1)?.payload.steps).toEqual([
      { id: "1", title: "Look at files", status: "completed" },
      { id: "2", title: "Report", status: "completed" },
    ]);
    const titles = only(events, "action.started").map((event) => event.payload.title);
    expect(titles.some((title) => title.startsWith("Task"))).toBe(false);

    // The CLI's own record is read, whatever the model named the fields.
    const { events: renamed } = await replay(claudeAdapter, recordings["plan-other-names"]);
    expect(only(renamed, "error")).toEqual([]);
    expect(only(renamed, "plan.updated").at(-1)?.payload.steps).toEqual([
      { id: "1", title: "List files", status: "completed" },
      { id: "2", title: "Report", status: "completed" },
    ]);
  });

  it("nests a sub-agent's work under its action and ends it when the sub-agent finishes", async () => {
    const { events } = await replay(claudeAdapter, recordings["plan-and-subagent"]);

    const actions = only(events, "action.started");
    const agent = actions.find((event) => event.payload.kind === "delegate");
    const glob = actions.find((event) => event.payload.title === "Glob: *.txt");
    expect(glob?.payload.parentActionId).toBe(agent?.payload.actionId);

    const ended = only(events, "action.ended");
    const agentEnded = ended.find((event) => event.payload.actionId === agent?.payload.actionId);
    const globEnded = ended.find((event) => event.payload.actionId === glob?.payload.actionId);
    expect(agentEnded?.payload.result).toContain("hello.txt");
    expect(agentEnded?.sequence).toBeGreaterThan(globEnded?.sequence ?? Number.POSITIVE_INFINITY);
  });

  it("ends an interrupted turn as interrupted, cancels its pending permission and stays usable", async () => {
    const { events } = await replay(claudeAdapter, recordings["interrupt-running"]);

    expect(only(events, "turn.ended").map((event) => event.payload.outcome)).toEqual([
      "interrupted",
      "completed",
    ]);
    expect(only(events, "error")).toEqual([]);

    const pending = await replay(claudeAdapter, recordings["interrupt-pending-permission"]);
    expect(only(pending.events, "permission.resolved")[0]?.payload.outcome).toBe("cancelled");
    expect(only(pending.events, "turn.ended")[0]?.payload.outcome).toBe("interrupted");
  });
});

describe("claude plan usage", () => {
  const readLimits = claudeAdapter.accounts?.readLimits;
  const signIn = (expiresAt: number) =>
    JSON.stringify({ claudeAiOauth: { accessToken: "token", expiresAt } });

  it("reads the windows /usage shows as fractions, and skips an expired sign-in", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        five_hour: { utilization: 2, resets_at: "2026-10-12T13:39:59.575102+00:00" },
        seven_day: { utilization: 83, resets_at: "2026-10-13T12:59:59+00:00" },
        seven_day_opus: null,
        extra_usage: { is_enabled: false },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      expect(await readLimits?.(signIn(Date.now() - 1000))).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
      expect(await readLimits?.(signIn(Date.now() + 60_000))).toEqual([
        {
          id: "five_hour",
          label: "five hour",
          usedFraction: 0.02,
          resetsAt: "2026-10-12T13:39:59.575Z",
        },
        {
          id: "seven_day",
          label: "seven day",
          usedFraction: 0.83,
          resetsAt: "2026-10-13T12:59:59.000Z",
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
