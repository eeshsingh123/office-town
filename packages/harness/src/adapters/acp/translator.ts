import { type ActionKind, actionKindSchema, type PermissionOption } from "@office-town/contract";
import type { AdapterEvent, Translation, Translator } from "../../adapter.ts";
import { type JsonRpcId, JsonRpcPeer, METHOD_NOT_FOUND } from "../../json-rpc.ts";
import {
  chunkSchema,
  delegationInputSchema,
  newSessionResultSchema,
  permissionParamsSchema,
  planSchema,
  promptResultSchema,
  type ToolCall,
  todoInputSchema,
  toolCallSchema,
  updateParamsSchema,
} from "./messages.ts";

const PROTOCOL_VERSION = 1;
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
  readonly #queuedPrompts: string[] = [];
  readonly #actions = new Map<string, ActionState>();
  readonly #planCalls = new Set<string>();
  readonly #permissions = new Map<string, JsonRpcId>();
  #sessionId: string | undefined;
  #turnActive = false;
  #stream: TextStream | undefined;

  constructor(cwd: string) {
    this.#cwd = cwd;
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
        if (incoming.method !== "session/update") return NOTHING;
        return { events: this.#update(incoming.params), outgoing: [] };
      case "request":
        if (incoming.method === "session/request_permission") {
          return { events: this.#permissionRequest(incoming.id, incoming.params), outgoing: [] };
        }
        return {
          events: [],
          outgoing: [this.#peer.reject(incoming.id, METHOD_NOT_FOUND, "Method not found")],
        };
    }
  }

  // ACP allows one prompt at a time, so later prompts wait for the turn in progress to end.
  prompt(text: string): Translation {
    this.#queuedPrompts.push(text);
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
    if (method === "initialize") {
      const request = this.#peer.request("session/new", { cwd: this.#cwd, mcpServers: [] });
      return { events: [], outgoing: [request] };
    }
    if (method === "session/new") return this.#sessionCreated(result);
    if (method === "session/prompt") return this.#turnEnded(result);
    return NOTHING;
  }

  #failure(method: string, message: string): Translation {
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

  #sessionCreated(result: unknown): Translation {
    const session = newSessionResultSchema.parse(result);
    this.#sessionId = session.sessionId;
    const model = session.configOptions?.find((option) => option.id === "model")?.currentValue;
    const started: AdapterEvent = {
      type: "session.started",
      payload: {
        harnessSessionId: session.sessionId,
        ...(typeof model === "string" ? { model } : {}),
      },
    };
    const next = this.#nextPrompt();
    return { events: [started, ...next.events], outgoing: next.outgoing };
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
    events.push({
      type: "turn.ended",
      payload: {
        outcome: stopReason === "cancelled" ? "interrupted" : failed ? "failed" : "completed",
        ...(usage === undefined
          ? {}
          : {
              usage: {
                inputTokens: (usage.inputTokens ?? 0) + cached,
                outputTokens: usage.outputTokens ?? 0,
                cachedInputTokens: cached,
              },
            }),
      },
    });
    const next = this.#nextPrompt();
    return { events: [...events, ...next.events], outgoing: next.outgoing };
  }

  #nextPrompt(): Translation {
    if (this.#sessionId === undefined || this.#turnActive) return NOTHING;
    const text = this.#queuedPrompts.shift();
    if (text === undefined) return NOTHING;
    this.#turnActive = true;
    const params = { sessionId: this.#sessionId, prompt: [{ type: "text", text }] };
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
    if (this.#stream?.type === type && this.#stream.messageId === messageId) {
      this.#stream.text += text;
      return [];
    }
    const events = this.#flush();
    this.#stream = { type, messageId, text };
    return events;
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
    return [
      {
        type: "action.started",
        payload: {
          actionId: call.toolCallId,
          kind: kindOf(call),
          title: call.title ?? "Tool call",
          input: call.rawInput ?? {},
          ...(call.locations?.length ? { locations: call.locations.map((l) => l.path) } : {}),
        },
      },
    ];
  }

  #permissionRequest(id: JsonRpcId, params: unknown): AdapterEvent[] {
    const { toolCall, options } = permissionParamsSchema.parse(params);
    const requestId = `permission-${id}`;
    this.#permissions.set(requestId, id);
    const state = this.#actions.get(toolCall.toolCallId) ?? {
      status: "pending",
      started: false,
      output: "",
    };
    this.#actions.set(toolCall.toolCallId, state);
    return [
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
  }
}
