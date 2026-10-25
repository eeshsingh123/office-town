import { type ActionKind, actionKindSchema, type PermissionOption } from "@office-town/contract";
import {
  type AdapterEvent,
  type AttachedToolServer,
  attachedTool,
  type InlineImage,
  type LaunchOptions,
  type Translation,
  type Translator,
} from "../../adapter.ts";
import { type JsonRpcId, JsonRpcPeer, METHOD_NOT_FOUND } from "../../json-rpc.ts";
import {
  type ConfigOption,
  chunkSchema,
  delegationInputSchema,
  initializeResultSchema,
  permissionParamsSchema,
  planSchema,
  promptResultSchema,
  sessionResultSchema,
  setOptionResultSchema,
  type ToolCall,
  todoInputSchema,
  toolCallSchema,
  updateParamsSchema,
} from "./messages.ts";

const PROTOCOL_VERSION = 1;
const SESSION_METHODS = new Set(["session/new", "session/resume", "session/load"]);
const SET_OPTION = "session/set_config_option";
const EFFORT_CATEGORY = "thought_level";
const NOTHING: Translation = { events: [], outgoing: [] };

interface TextStream {
  type: "message" | "reasoning";
  messageId: string | undefined;
  text: string;
}

interface ActionState {
  status: string;
  started: boolean;
  output: string;
}

function kindOf(call: ToolCall): ActionKind {
  if (delegationInputSchema.safeParse(call.rawInput).success) return "delegate";
  const kind = actionKindSchema.safeParse(call.kind);
  return kind.success ? kind.data : "other";
}

function outputOf(call: ToolCall): string {
  return (call.content ?? []).map((part) => part.content?.text ?? "").join("");
}

// ACP names an HTTP server's headers and a command's variables as name and value pairs.
function mcpServerOf(server: AttachedToolServer) {
  const pairs = (record: Record<string, string>) =>
    Object.entries(record).map(([name, value]) => ({ name, value }));
  return server.transport === "http"
    ? { type: "http", name: server.name, url: server.url, headers: pairs(server.headers) }
    : { name: server.name, command: server.command, args: server.args, env: pairs(server.env) };
}

const modelOption = (options: ConfigOption[]) =>
  options.find((option) => option.category === "model" || option.id === "model");

function stepsOf(
  entries: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>,
) {
  return entries.map((entry, index) => ({
    id: String(index + 1),
    title: entry.content,
    status: entry.status,
  }));
}

export class AcpTranslator implements Translator {
  readonly #peer = new JsonRpcPeer();
  readonly #cwd: string;
  readonly #queuedPrompts: object[][] = [];
  readonly #actions = new Map<string, ActionState>();
  readonly #planCalls = new Set<string>();
  readonly #permissions = new Map<string, JsonRpcId>();
  readonly #model: string | undefined;
  readonly #effort: string | undefined;
  readonly #resumeSessionId: string | undefined;
  readonly #toolServers: AttachedToolServer[];
  readonly #toolPrefixes: (server: string) => string[];
  #sessionId: string | undefined;
  // The setting the harness is applying: the model first, then its effort.
  #configuring: "model" | "effort" | undefined;
  #options: ConfigOption[] = [];
  // While session/load replays the conversation, whose turns the trace already has.
  #loading = false;
  #turnActive = false;
  #stream: TextStream | undefined;

  constructor(
    options: Pick<
      LaunchOptions,
      "workspacePath" | "model" | "effort" | "resumeSessionId" | "toolServers"
    >,
    toolPrefixes: (server: string) => string[],
  ) {
    this.#cwd = options.workspacePath;
    this.#model = options.model;
    this.#effort = options.effort;
    this.#resumeSessionId = options.resumeSessionId;
    this.#toolServers = options.toolServers;
    this.#toolPrefixes = toolPrefixes;
  }

  open(): string[] {
    const clientCapabilities = {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    };
    return [
      this.#peer.request("initialize", { protocolVersion: PROTOCOL_VERSION, clientCapabilities }),
    ];
  }

  receive(line: string): Translation {
    const incoming = this.#peer.parse(line);
    switch (incoming.kind) {
      case "result":
        return this.#result(incoming.method, incoming.result);
      case "error":
        return this.#failure(incoming.method, incoming.message);
      case "notification":
        if (incoming.method !== "session/update" || this.#loading) return NOTHING;
        return this.#updated(this.#update(incoming.params));
      case "request":
        if (incoming.method === "session/request_permission") {
          return this.#permissionRequest(incoming.id, incoming.params);
        }
        return {
          events: [],
          outgoing: [this.#peer.reject(incoming.id, METHOD_NOT_FOUND, "Method not found")],
        };
    }
  }

  // A text chunk that completes no earlier message is only a fragment of the message to come.
  #updated(events: AdapterEvent[]): Translation {
    const partial =
      events.length > 0 &&
      events.every((event) => event.type === "message.delta" || event.type === "reasoning.delta");
    return { events, outgoing: [], partial };
  }

  // ACP allows one prompt at a time, so later prompts wait for the turn in progress to end.
  prompt(text: string, images: InlineImage[]): Translation {
    this.#queuedPrompts.push([
      ...images.map(({ mimeType, data }) => ({ type: "image", mimeType, data })),
      { type: "text", text },
    ]);
    return this.#nextPrompt();
  }

  answerPermission(requestId: string, option: PermissionOption): Translation {
    const id = this.#permissions.get(requestId);
    if (id === undefined) throw new Error(`Unknown permission request "${requestId}".`);
    this.#permissions.delete(requestId);
    const outcome = { outcome: "selected", optionId: option.optionId };
    return { events: [], outgoing: [this.#peer.respond(id, { outcome })] };
  }

  // The protocol has no way for an agent to ask a question, so there is never one to answer.
  answerQuestion(requestId: string): Translation {
    throw new Error(`Unknown question "${requestId}".`);
  }

  interrupt(): Translation {
    if (!this.#turnActive) return NOTHING;
    const events: AdapterEvent[] = [];
    const outgoing = [this.#peer.notify("session/cancel", { sessionId: this.#sessionId })];
    // The protocol requires every pending permission request to be answered as cancelled.
    for (const [requestId, id] of this.#permissions) {
      outgoing.push(this.#peer.respond(id, { outcome: { outcome: "cancelled" } }));
      events.push({ type: "permission.resolved", payload: { requestId, outcome: "cancelled" } });
    }
    this.#permissions.clear();
    return { events, outgoing };
  }

  #result(method: string, result: unknown): Translation {
    if (method === "initialize") return this.#openSession(result);
    if (SESSION_METHODS.has(method)) return this.#sessionCreated(result);
    if (method === SET_OPTION) return this.#optionSet(result);
    if (method === "session/prompt") return this.#turnEnded(result);
    return NOTHING;
  }

  #failure(method: string, message: string): Translation {
    if (method === SET_OPTION) {
      const error = `The harness did not apply the chosen settings: ${message}`;
      return this.#configured([{ type: "error", payload: { message: error, fatal: false } }]);
    }
    if (method !== "session/prompt") {
      const error = `The harness rejected "${method}": ${message}`;
      return {
        events: [{ type: "error", payload: { message: error, fatal: true } }],
        outgoing: [],
      };
    }
    this.#turnActive = false;
    const next = this.#nextPrompt();
    const events: AdapterEvent[] = [
      ...this.#flush(),
      { type: "error", payload: { message, fatal: false } },
      { type: "turn.ended", payload: { outcome: "failed" } },
      ...next.events,
    ];
    return { events, outgoing: next.outgoing };
  }

  // A harness that cannot resume a session loads it instead, which replays it first.
  #openSession(result: unknown): Translation {
    const location = { cwd: this.#cwd, mcpServers: this.#toolServers.map(mcpServerOf) };
    if (this.#resumeSessionId === undefined) {
      return { events: [], outgoing: [this.#peer.request("session/new", location)] };
    }
    const capabilities = initializeResultSchema.parse(result).agentCapabilities;
    const resumes = capabilities?.sessionCapabilities?.resume !== undefined;
    this.#loading = !resumes && capabilities?.loadSession === true;
    const method = resumes || !this.#loading ? "session/resume" : "session/load";
    const params = { sessionId: this.#resumeSessionId, ...location };
    return { events: [], outgoing: [this.#peer.request(method, params)] };
  }

  #sessionCreated(result: unknown): Translation {
    this.#loading = false;
    const session = sessionResultSchema.parse(result);
    const sessionId = session.sessionId ?? this.#resumeSessionId;
    if (sessionId === undefined) throw new Error("The harness did not name the new session.");
    this.#sessionId = sessionId;
    this.#options = session.configOptions ?? [];
    const current = modelOption(this.#options)?.currentValue;
    const model = this.#model ?? current;
    const started: AdapterEvent = {
      type: "session.started",
      payload: {
        harnessSessionId: sessionId,
        ...(typeof model === "string" ? { model } : {}),
      },
    };
    return this.#configure([started], "model");
  }

  // The model first, then the effort, whose values belong to the model. Both can only be chosen
  // once the session exists.
  #configure(events: AdapterEvent[], from: "model" | "effort"): Translation {
    const model = from === "model" ? this.#applyModel() : undefined;
    if (model !== undefined) {
      this.#configuring = "model";
      return { events, outgoing: [model] };
    }
    const effort = this.#applyEffort(this.#options);
    if (effort.outgoing.length > 0) {
      this.#configuring = "effort";
      return { events: [...events, ...effort.events], outgoing: effort.outgoing };
    }
    return this.#configured([...events, ...effort.events]);
  }

  #optionSet(result: unknown): Translation {
    if (this.#configuring !== "model") return this.#configured([]);
    this.#options = setOptionResultSchema.parse(result).configOptions ?? this.#options;
    return this.#configure([], "effort");
  }

  // For a harness whose command line cannot name the model; one it already runs is left alone.
  #applyModel(): string | undefined {
    const setting = modelOption(this.#options);
    const offered = (setting?.options ?? []).flatMap((option) => option.value ?? []);
    if (this.#model === undefined || setting === undefined) return undefined;
    if (setting.currentValue === this.#model || !offered.includes(this.#model)) return undefined;
    const params = { sessionId: this.#sessionId, configId: setting.id, value: this.#model };
    return this.#peer.request(SET_OPTION, params);
  }

  #applyEffort(options: ConfigOption[]): Translation {
    if (this.#effort === undefined) return NOTHING;
    const setting = options.find((option) => option.category === EFFORT_CATEGORY);
    const offered = (setting?.options ?? []).flatMap((option) => option.value ?? []);
    if (setting === undefined || !offered.includes(this.#effort)) {
      const reason =
        offered.length === 0
          ? "This model has no effort setting"
          : `This model's effort can be ${offered.join(", ")}`;
      const message = `${reason}, so "${this.#effort}" was ignored.`;
      return { events: [{ type: "error", payload: { message, fatal: false } }], outgoing: [] };
    }
    const params = { sessionId: this.#sessionId, configId: setting.id, value: this.#effort };
    return { events: [], outgoing: [this.#peer.request(SET_OPTION, params)] };
  }

  #configured(events: AdapterEvent[]): Translation {
    this.#configuring = undefined;
    const next = this.#nextPrompt();
    return { events: [...events, ...next.events], outgoing: next.outgoing };
  }

  #turnEnded(result: unknown): Translation {
    const { stopReason, usage } = promptResultSchema.parse(result);
    this.#turnActive = false;
    const events = this.#flush();
    const failed = stopReason !== "end_turn" && stopReason !== "cancelled";
    if (failed) {
      const message = `The turn stopped early (${stopReason}).`;
      events.push({ type: "error", payload: { message, fatal: false } });
    }
    const cached = usage?.cachedReadTokens ?? 0;
    const input = (usage?.inputTokens ?? 0) + cached + (usage?.cachedWriteTokens ?? 0);
    // Thinking is billed as output but reported apart.
    const output = (usage?.outputTokens ?? 0) + (usage?.thoughtTokens ?? 0);
    events.push({
      type: "turn.ended",
      payload: {
        outcome: stopReason === "cancelled" ? "interrupted" : failed ? "failed" : "completed",
        ...(usage === undefined
          ? {}
          : {
              usage: {
                inputTokens: input,
                outputTokens: output,
                cachedInputTokens: cached,
                // OpenCode reports only the turn's last model step, which is the conversation's length.
                contextTokens: input + output,
              },
            }),
      },
    });
    const next = this.#nextPrompt();
    return { events: [...events, ...next.events], outgoing: next.outgoing };
  }

  #nextPrompt(): Translation {
    if (this.#sessionId === undefined || this.#configuring !== undefined || this.#turnActive) {
      return NOTHING;
    }
    const prompt = this.#queuedPrompts.shift();
    if (prompt === undefined) return NOTHING;
    this.#turnActive = true;
    const params = { sessionId: this.#sessionId, prompt };
    return {
      events: [{ type: "turn.started" }],
      outgoing: [this.#peer.request("session/prompt", params)],
    };
  }

  #update(params: unknown): AdapterEvent[] {
    const { update } = updateParamsSchema.parse(params);
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        return this.#chunk("message", update);
      case "agent_thought_chunk":
        return this.#chunk("reasoning", update);
      case "tool_call":
      case "tool_call_update":
        return [...this.#flush(), ...this.#toolCall(toolCallSchema.parse(update))];
      case "plan": {
        const steps = stepsOf(planSchema.parse(update).entries);
        return [...this.#flush(), { type: "plan.updated", payload: { steps } }];
      }
      default:
        return [];
    }
  }

  // Text arrives in fragments; a message is complete once something else follows it.
  #chunk(type: TextStream["type"], update: unknown): AdapterEvent[] {
    const { messageId, content } = chunkSchema.parse(update);
    const text = content.text ?? "";
    const delta: AdapterEvent[] = text === "" ? [] : [{ type: `${type}.delta`, payload: { text } }];
    if (this.#stream?.type === type && this.#stream.messageId === messageId) {
      this.#stream.text += text;
      return delta;
    }
    const events = this.#flush();
    this.#stream = { type, messageId, text };
    return [...events, ...delta];
  }

  #flush(): AdapterEvent[] {
    const stream = this.#stream;
    this.#stream = undefined;
    if (stream === undefined || stream.text === "") return [];
    return stream.type === "message"
      ? [{ type: "message", payload: { role: "assistant", text: stream.text } }]
      : [{ type: "reasoning", payload: { text: stream.text } }];
  }

  #toolCall(call: ToolCall): AdapterEvent[] {
    if (this.#planCalls.has(call.toolCallId)) return [];
    // OpenCode reports its todo list as a tool call rather than as a plan update.
    const todos = todoInputSchema.safeParse(call.rawInput);
    if (todos.success) {
      this.#planCalls.add(call.toolCallId);
      this.#actions.delete(call.toolCallId);
      return [{ type: "plan.updated", payload: { steps: stepsOf(todos.data.todos) } }];
    }

    const state = this.#actions.get(call.toolCallId) ?? {
      status: "pending",
      started: false,
      output: "",
    };
    this.#actions.set(call.toolCallId, state);
    state.status = call.status ?? state.status;
    // A pending call has no input yet, so the action starts once the harness fills it in.
    if (state.status === "pending") return [];

    const events = this.#started(call, state);
    const output = outputOf(call);
    if (state.status === "completed" || state.status === "failed") {
      this.#actions.delete(call.toolCallId);
      const outcome = state.status;
      events.push({
        type: "action.ended",
        payload: { actionId: call.toolCallId, outcome, result: output },
      });
    } else if (output !== "" && output !== state.output) {
      state.output = output;
      events.push({ type: "action.updated", payload: { actionId: call.toolCallId, output } });
    }
    return events;
  }

  #started(call: ToolCall, state: ActionState): AdapterEvent[] {
    if (state.started) return [];
    state.started = true;
    const title = call.title ?? "Tool call";
    const tool = attachedTool(title, this.#toolServers, this.#toolPrefixes);
    return [
      {
        type: "action.started",
        payload: {
          actionId: call.toolCallId,
          kind: kindOf(call),
          title,
          input: call.rawInput ?? {},
          ...(call.locations?.length ? { locations: call.locations.map((l) => l.path) } : {}),
          ...(tool === undefined ? {} : { tool }),
        },
      },
    ];
  }

  // The core's own tools never ask: what they lead to is guarded where it happens.
  #permissionRequest(id: JsonRpcId, params: unknown): Translation {
    const { toolCall, options } = permissionParamsSchema.parse(params);
    const allow = options.find((option) => option.kind === "allow_once");
    const own = attachedTool(toolCall.title ?? "", this.#toolServers, this.#toolPrefixes);
    if (own !== undefined && allow !== undefined) {
      const outcome = { outcome: "selected", optionId: allow.optionId };
      return { events: [], outgoing: [this.#peer.respond(id, { outcome })] };
    }
    const requestId = `permission-${id}`;
    this.#permissions.set(requestId, id);
    const state = this.#actions.get(toolCall.toolCallId) ?? {
      status: "pending",
      started: false,
      output: "",
    };
    this.#actions.set(toolCall.toolCallId, state);
    const events: AdapterEvent[] = [
      ...this.#flush(),
      ...this.#started(toolCall, state),
      {
        type: "permission.requested",
        payload: {
          requestId,
          actionId: toolCall.toolCallId,
          title: toolCall.title ?? "Permission needed",
          input: toolCall.rawInput ?? {},
          options: options.map(({ optionId, name, kind }) => ({ optionId, label: name, kind })),
        },
      },
    ];
    return { events, outgoing: [] };
  }
}
