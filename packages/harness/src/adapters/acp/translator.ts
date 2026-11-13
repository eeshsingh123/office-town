import {
  type ActionKind,
  actionKindSchema,
  type PermissionOption,
  type TokenUsage,
} from "@office-town/contract";
import type { z } from "zod";
import {
  type AdapterEvent,
  type AnsweredQuestion,
  type AttachedToolServer,
  attachedTool,
  type InlineImage,
  type LaunchOptions,
  type Translation,
  type Translator,
} from "../../adapter.ts";
import { type JsonRpcId, JsonRpcPeer, METHOD_NOT_FOUND } from "../../json-rpc.ts";
import { contentOf, questionsOf } from "./forms.ts";
import {
  type ChildSession,
  type ConfigOption,
  childUpdateSchema,
  chunkSchema,
  delegationInputSchema,
  elicitationParamsSchema,
  type FormField,
  initializeResultSchema,
  permissionParamsSchema,
  planSchema,
  promptResultSchema,
  scriptOutputSchema,
  sessionResultSchema,
  setOptionResultSchema,
  steeringResultSchema,
  subagentOutputSchema,
  type ToolCall,
  todoInputSchema,
  toolCallSchema,
  updateParamsSchema,
  usageUpdateSchema,
} from "./messages.ts";

const PROTOCOL_VERSION = 1;
const SESSION_METHODS = new Set(["session/new", "session/resume", "session/load"]);
const SET_OPTION = "session/set_config_option";
// OpenCode 2's way into a running turn, until ACP has its own.
const STEERING = "_session/steering";
// OpenCode 2 reports its sub-agents' steps apart when the client asks for them.
const CHILD_UPDATES = "opencode/child-session-updates";
const CHILD_UPDATE = "opencode/session/child_update";
const CHILD_ENDED = new Set(["completed", "failed", "interrupted"]);
const EFFORT_CATEGORY = "thought_level";
const NOTHING: Translation = { events: [], outgoing: [] };
// A rough count, only for the size during a turn: the app reports the real one as a prompt ends.
const CHARS_PER_TOKEN = 4;

interface TextStream {
  type: "message" | "reasoning";
  messageId: string | undefined;
  text: string;
  parentActionId: string | undefined;
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

const parentOf = (parentActionId: string | undefined) =>
  parentActionId === undefined ? {} : { parentActionId };

const childOf = (meta: ToolCall["_meta"]) => meta?.["opencode/child-session"];

const streamOf = (child: ChildSession | undefined) =>
  child === undefined ? "" : `child:${child.id}`;

// OpenCode 2 titles a sub-agent's tool calls with the sub-agent's title first.
function ownTitle(call: ToolCall, child: ChildSession | undefined): ToolCall {
  const prefix = child?.title === undefined ? undefined : `${child.title}: `;
  if (prefix === undefined || !call.title?.startsWith(prefix)) return call;
  return { ...call, title: call.title.slice(prefix.length) };
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

type ReportedUsage = z.infer<typeof promptResultSchema>["usage"];

function usageOf(usage: ReportedUsage): TokenUsage | undefined {
  if (usage === undefined) return undefined;
  const cached = usage.cachedReadTokens ?? 0;
  const input = (usage.inputTokens ?? 0) + cached + (usage.cachedWriteTokens ?? 0);
  // Thinking is billed as output but reported apart.
  const output = (usage.outputTokens ?? 0) + (usage.thoughtTokens ?? 0);
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    // OpenCode reports only the turn's last model step, which is the conversation's length.
    contextTokens: input + output,
  };
}

function addUsage(earlier: TokenUsage | undefined, next: TokenUsage | undefined) {
  if (earlier === undefined || next === undefined) return next ?? earlier;
  return {
    ...next,
    inputTokens: earlier.inputTokens + next.inputTokens,
    outputTokens: earlier.outputTokens + next.outputTokens,
    cachedInputTokens: (earlier.cachedInputTokens ?? 0) + (next.cachedInputTokens ?? 0),
  };
}

// What an event adds to the conversation the model reads again at its next step.
function charsOf(event: AdapterEvent): number {
  switch (event.type) {
    case "message":
    case "reasoning":
      return event.payload.text.length;
    case "action.started":
      return JSON.stringify(event.payload.input ?? "").length;
    case "action.ended":
      return event.payload.result.length;
    default:
      return 0;
  }
}

export interface PreferredModel {
  model: string;
  effort: string;
}

// What a harness adds to ACP that the session uses (D-98).
export interface AcpExtensions {
  // The agent's questions come as ACP forms, which the user answers in Needs you.
  questions?: boolean;
  // Its sub-agents' steps come apart, and its background ones report when they end.
  subagentSteps?: boolean;
  // The core's servers the harness's own config attaches, so the session does not attach them.
  configuredServers?: readonly string[];
}

// The steps of a Code Mode script, by the index of each call it made.
interface ScriptSteps {
  started: number;
  ended: Set<number>;
}

export class AcpTranslator implements Translator {
  readonly #peer = new JsonRpcPeer();
  readonly #cwd: string;
  readonly #queuedPrompts: object[][] = [];
  readonly #actions = new Map<string, ActionState>();
  readonly #planCalls = new Set<string>();
  readonly #permissions = new Map<string, JsonRpcId>();
  readonly #questions = new Map<string, { id: JsonRpcId; fields: Record<string, FormField> }>();
  readonly #extensions: AcpExtensions;
  // The action that started each sub-agent, by its session, and sub-agent calls not yet matched.
  readonly #childParents = new Map<string, string>();
  // A background sub-agent's call stays open until the sub-agent ends, as on Claude.
  readonly #working = new Map<string, string>();
  readonly #endedChildren = new Set<string>();
  #delegations: Array<{ actionId: string; description: string }> = [];
  // Steps inside a sub-agent or a script, which are not the conversation's own.
  readonly #nested = new Set<string>();
  readonly #scripts = new Map<string, ScriptSteps>();
  #nativeSteering = false;
  #model: string | undefined;
  #effort: string | undefined;
  readonly #preferred: PreferredModel | undefined;
  readonly #resumeSessionId: string | undefined;
  readonly #toolServers: AttachedToolServer[];
  readonly #toolPrefixes: (server: string) => string[];
  // The provider's own apps this session may use, whose calls the core decides (D-96).
  readonly #vendorApps: readonly { name: string }[];
  readonly #allowOwnToolAsks: boolean;
  #sessionId: string | undefined;
  // The setting the harness is applying: the model first, then its effort.
  #configuring: "model" | "effort" | undefined;
  #options: ConfigOption[] = [];
  // While session/load replays the conversation, whose turns the trace already has.
  #loading = false;
  #turnActive = false;
  // A waiting message on its way into the turn: by a cancel, then sent once it is answered, or
  // by native steering, carrying the message.
  #steering: "cancel" | "native" | undefined;
  #steeringPrompt: object[] = [];
  // What the cancelled part of a turn used, counted when the turn ends.
  #carriedUsage: TokenUsage | undefined;
  // The conversation's size as the app last reported it, and the text seen since, so its size
  // during a turn can be estimated. A resumed one starts from the size the core last stored.
  #reportedContext: number | undefined;
  #charsSince = 0;
  #contextWindow: number | undefined;
  // Text in progress, by the session it comes from: the conversation's own, or a sub-agent's.
  readonly #streams = new Map<string, TextStream>();

  constructor(
    options: Pick<
      LaunchOptions,
      | "workspacePath"
      | "model"
      | "effort"
      | "resumeSessionId"
      | "resumedContextTokens"
      | "toolServers"
      | "vendorApps"
    >,
    toolPrefixes: (server: string) => string[],
    allowOwnToolAsks: boolean,
    preferred?: PreferredModel,
    extensions: AcpExtensions = {},
  ) {
    this.#extensions = extensions;
    this.#preferred = preferred;
    this.#cwd = options.workspacePath;
    this.#model = options.model;
    this.#effort = options.effort;
    this.#resumeSessionId = options.resumeSessionId;
    this.#reportedContext =
      options.resumeSessionId === undefined ? 0 : options.resumedContextTokens;
    this.#toolServers = options.toolServers;
    this.#vendorApps = (options.vendorApps ?? []).map((name) => ({ name }));
    this.#toolPrefixes = toolPrefixes;
    this.#allowOwnToolAsks = allowOwnToolAsks;
  }

  open(): string[] {
    const clientCapabilities = {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      ...(this.#extensions.questions === true ? { elicitation: { form: {} } } : {}),
      ...(this.#extensions.subagentSteps === true ? { _meta: { [CHILD_UPDATES]: true } } : {}),
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
        if (this.#loading) return NOTHING;
        if (incoming.method === "session/update") {
          return this.#updated(this.#update(incoming.params));
        }
        if (incoming.method === CHILD_UPDATE && this.#extensions.subagentSteps === true) {
          return this.#updated(this.#childUpdate(incoming.params));
        }
        return NOTHING;
      case "request":
        if (incoming.method === "session/request_permission") {
          return this.#permissionRequest(incoming.id, incoming.params);
        }
        if (incoming.method === "elicitation/create" && this.#extensions.questions === true) {
          return this.#questionRequest(incoming.id, incoming.params);
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
    return {
      events: [...events, ...this.#measured(events)],
      outgoing: this.#steer(events),
      partial,
    };
  }

  // At each tool end, the size so far: what the app last reported plus the text seen since.
  #measured(events: AdapterEvent[]): AdapterEvent[] {
    const own = events.filter((event) => !this.#isNested(event));
    for (const event of own) this.#charsSince += charsOf(event);
    const toolEnded = own.some((event) => event.type === "action.ended");
    if (!toolEnded || !this.#turnActive || this.#reportedContext === undefined) return [];
    const contextTokens = this.#reportedContext + Math.round(this.#charsSince / CHARS_PER_TOKEN);
    const window = this.#contextWindow;
    return [
      {
        type: "context.measured",
        payload: { contextTokens, ...(window === undefined ? {} : { contextWindow: window }) },
      },
    ];
  }

  #reported(contextTokens: number | undefined): void {
    if (contextTokens === undefined) return;
    this.#reportedContext = contextTokens;
    this.#charsSince = 0;
  }

  // A sub-agent's or a script's step is not part of the conversation the model reads again.
  #isNested(event: AdapterEvent): boolean {
    if (event.type === "action.ended") return this.#nested.has(event.payload.actionId);
    return "payload" in event && "parentActionId" in event.payload;
  }

  // A waiting message goes in at a tool end, never mid-tool (D-77). OpenCode 2 takes it into the
  // running turn. ACP itself has no way in, and OpenCode 1 never answers a second prompt sent
  // during one, so there it cancels the turn once no tool is at work and goes out at once.
  #steer(events: AdapterEvent[]): string[] {
    const toolEnded = events.some(
      (event) => event.type === "action.ended" && !this.#nested.has(event.payload.actionId),
    );
    if (!toolEnded || this.#steering !== undefined || !this.#turnActive) return [];
    if (this.#queuedPrompts.length === 0) return [];
    if (this.#nativeSteering) {
      this.#steering = "native";
      this.#steeringPrompt = this.#queuedPrompts.splice(0).flat();
      const params = { sessionId: this.#sessionId, prompt: this.#steeringPrompt };
      return [this.#peer.request(STEERING, params)];
    }
    if (this.#actions.size > 0) return [];
    this.#steering = "cancel";
    return [this.#peer.notify("session/cancel", { sessionId: this.#sessionId })];
  }

  // Taken into the turn, it counts as taken; otherwise it waits for the turn to end. A turn that
  // ended meanwhile may not have read it, so it goes out again rather than be lost.
  #steeringAnswered(injected: boolean): Translation {
    const prompt = this.#steeringPrompt;
    this.#steering = undefined;
    this.#steeringPrompt = [];
    if (injected && this.#turnActive) {
      return { events: [...this.#flush(), { type: "turn.started" }], outgoing: [] };
    }
    this.#queuedPrompts.unshift(prompt);
    return this.#nextPrompt();
  }

  // To the rest of the app the turn goes on; a new start means the message counts as taken.
  #steered(): Translation {
    this.#steering = undefined;
    const cut: AdapterEvent[] = [...this.#actions]
      .filter(([, action]) => action.started)
      .map(([actionId]) => ({
        type: "action.ended",
        payload: { actionId, outcome: "failed", result: "Cancelled to deliver a message." },
      }));
    this.#actions.clear();
    const params = { sessionId: this.#sessionId, prompt: this.#queuedPrompts.splice(0).flat() };
    return {
      events: [...this.#flush(), ...cut, { type: "turn.started" }],
      outgoing: [this.#peer.request("session/prompt", params)],
    };
  }

  // Later prompts wait for the turn in progress to end, or for the next tool to end.
  prompt(text: string, images: InlineImage[]): Translation {
    this.#charsSince += text.length;
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

  answerQuestion(requestId: string, answered: AnsweredQuestion[]): Translation {
    const question = this.#questions.get(requestId);
    if (question === undefined) throw new Error(`Unknown question "${requestId}".`);
    this.#questions.delete(requestId);
    const content = contentOf(question.fields, answered);
    return {
      events: [],
      outgoing: [this.#peer.respond(question.id, { action: "accept", content })],
    };
  }

  interrupt(): Translation {
    if (!this.#turnActive) return NOTHING;
    if (this.#steering === "cancel") this.#steering = undefined;
    const events: AdapterEvent[] = [];
    const outgoing = [this.#peer.notify("session/cancel", { sessionId: this.#sessionId })];
    // The protocol requires every pending permission request to be answered as cancelled.
    for (const [requestId, id] of this.#permissions) {
      outgoing.push(this.#peer.respond(id, { outcome: { outcome: "cancelled" } }));
      events.push({ type: "permission.resolved", payload: { requestId, outcome: "cancelled" } });
    }
    this.#permissions.clear();
    for (const [requestId, { id }] of this.#questions) {
      outgoing.push(this.#peer.respond(id, { action: "cancel" }));
      events.push({ type: "question.resolved", payload: { requestId, outcome: "cancelled" } });
    }
    this.#questions.clear();
    return { events, outgoing };
  }

  #result(method: string, result: unknown): Translation {
    if (method === "initialize") return this.#openSession(result);
    if (SESSION_METHODS.has(method)) return this.#sessionCreated(result);
    if (method === SET_OPTION) return this.#optionSet(result);
    if (method === "session/prompt") return this.#turnEnded(result);
    if (method === STEERING) {
      return this.#steeringAnswered(steeringResultSchema.parse(result).outcome === "injected");
    }
    return NOTHING;
  }

  #failure(method: string, message: string): Translation {
    if (method === STEERING) return this.#steeringAnswered(false);
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
    if (this.#steering === "cancel") return this.#steered();
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
    const initialized = initializeResultSchema.parse(result);
    this.#nativeSteering = initialized._meta?.steering?.supported === true;
    const configured = new Set(this.#extensions.configuredServers ?? []);
    const attached = this.#toolServers.filter((server) => !configured.has(server.name));
    const location = { cwd: this.#cwd, mcpServers: attached.map(mcpServerOf) };
    if (this.#resumeSessionId === undefined) {
      return { events: [], outgoing: [this.#peer.request("session/new", location)] };
    }
    const capabilities = initialized.agentCapabilities;
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
    this.#usePreferred();
    const current = modelOption(this.#options)?.currentValue;
    const refused = this.#refusesModel();
    const model = refused ? current : (this.#model ?? current);
    const started: AdapterEvent = {
      type: "session.started",
      payload: {
        harnessSessionId: sessionId,
        ...(typeof model === "string" ? { model } : {}),
      },
    };
    if (!refused) return this.#configure([started], "model");
    const message = `This provider does not offer "${this.#model}", so it runs on its default model.`;
    return this.#configure(
      [started, { type: "error", payload: { message, fatal: false } }],
      "model",
    );
  }

  // A resumed session stays on the model it ran on.
  #usePreferred(): void {
    const preferred = this.#preferred;
    if (preferred === undefined) return;
    if (this.#model !== undefined || this.#resumeSessionId !== undefined) return;
    const offered = modelOption(this.#options)?.options ?? [];
    if (!offered.some((option) => option.value === preferred.model)) return;
    this.#model = preferred.model;
    this.#effort ??= preferred.effort;
  }

  // The model was picked, and the harness lists its models without it.
  #refusesModel(): boolean {
    const setting = modelOption(this.#options);
    if (this.#model === undefined || setting === undefined) return false;
    if (setting.currentValue === this.#model) return false;
    return !(setting.options ?? []).some((option) => option.value === this.#model);
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
    if (this.#model === undefined || setting === undefined) return undefined;
    if (setting.currentValue === this.#model || this.#refusesModel()) return undefined;
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
    const part = usageOf(usage);
    this.#reported(part?.contextTokens);
    const used = addUsage(this.#carriedUsage, part);
    if (this.#steering === "cancel" && stopReason === "cancelled") {
      this.#carriedUsage = used;
      return this.#steered();
    }
    if (this.#steering === "cancel") this.#steering = undefined;
    this.#carriedUsage = undefined;
    this.#turnActive = false;
    const events = this.#flush();
    const failed = stopReason !== "end_turn" && stopReason !== "cancelled";
    if (failed) {
      const message = `The turn stopped early (${stopReason}).`;
      events.push({ type: "error", payload: { message, fatal: false } });
    }
    events.push({
      type: "turn.ended",
      payload: {
        outcome: stopReason === "cancelled" ? "interrupted" : failed ? "failed" : "completed",
        ...(used === undefined ? {} : { usage: used }),
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
    // OpenCode 2 wakes a lead by itself once its background sub-agent reports, with no end to that
    // run; what it said is complete once the next turn starts.
    return {
      events: [...this.#flush(), { type: "turn.started" }],
      outgoing: [this.#peer.request("session/prompt", params)],
    };
  }

  #update(params: unknown): AdapterEvent[] {
    const { update } = updateParamsSchema.parse(params);
    return this.#sessionUpdate(update, childOf(update._meta));
  }

  #childUpdate(params: unknown): AdapterEvent[] {
    const report = childUpdateSchema.parse(params);
    const child = { id: report.childSessionId, title: report.title };
    if (report.type === "update" && report.update !== undefined) {
      return this.#sessionUpdate(report.update, child);
    }
    if (report.type !== "status" || !CHILD_ENDED.has(report.status ?? "")) return [];
    const events = this.#flush(streamOf(child));
    const actionId = this.#working.get(child.id);
    if (actionId === undefined) {
      this.#endedChildren.add(child.id);
      return events;
    }
    this.#working.delete(child.id);
    const outcome = report.status === "completed" ? "completed" : "failed";
    const result = `The sub-agent ${report.status}.`;
    return [...events, { type: "action.ended", payload: { actionId, outcome, result } }];
  }

  #sessionUpdate(
    update: z.infer<typeof updateParamsSchema>["update"],
    child: ChildSession | undefined,
  ): AdapterEvent[] {
    const stream = streamOf(child);
    const parent = child === undefined ? undefined : this.#parentOf(child);
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        return this.#chunk("message", update, stream, parent);
      case "agent_thought_chunk":
        return this.#chunk("reasoning", update, stream, parent);
      case "tool_call":
      case "tool_call_update": {
        const call = ownTitle(toolCallSchema.parse(update), child);
        return [...this.#flush(stream), ...this.#toolCall(call, parent)];
      }
      // A sub-agent's plan and size are its own, not the conversation's.
      case "plan": {
        if (child !== undefined) return [];
        const steps = stepsOf(planSchema.parse(update).entries);
        return [...this.#flush(stream), { type: "plan.updated", payload: { steps } }];
      }
      case "usage_update": {
        if (child !== undefined) return [];
        const { used, size } = usageUpdateSchema.parse(update);
        this.#reported(used);
        this.#contextWindow = size ?? this.#contextWindow;
        return [];
      }
      default:
        return [];
    }
  }

  // The action that started a sub-agent: the call whose output named its session, else the
  // sub-agent call it is titled after, else the latest one not yet matched.
  #parentOf(child: ChildSession): string | undefined {
    const known = this.#childParents.get(child.id);
    if (known !== undefined) return known;
    const titled = this.#delegations.find(({ description }) => description === child.title);
    const match = titled ?? this.#delegations.at(-1);
    if (match === undefined) return undefined;
    this.#link(child.id, match.actionId);
    return match.actionId;
  }

  #link(childSessionId: string, actionId: string): void {
    this.#childParents.set(childSessionId, actionId);
    this.#delegations = this.#delegations.filter((entry) => entry.actionId !== actionId);
  }

  // Text arrives in fragments; a message is complete once something else from its session
  // follows it.
  #chunk(
    type: TextStream["type"],
    update: unknown,
    stream: string,
    parentActionId: string | undefined,
  ): AdapterEvent[] {
    const { messageId, content } = chunkSchema.parse(update);
    const text = content.text ?? "";
    const delta: AdapterEvent[] =
      text === ""
        ? []
        : [{ type: `${type}.delta`, payload: { text, ...parentOf(parentActionId) } }];
    const current = this.#streams.get(stream);
    if (current?.type === type && current.messageId === messageId) {
      current.text += text;
      return delta;
    }
    const events = this.#flush(stream);
    this.#streams.set(stream, { type, messageId, text, parentActionId });
    return [...events, ...delta];
  }

  // One session's text, or every session's when none is named.
  #flush(stream?: string): AdapterEvent[] {
    const keys = stream === undefined ? [...this.#streams.keys()] : [stream];
    return keys.flatMap((key): AdapterEvent[] => {
      const flushed = this.#streams.get(key);
      this.#streams.delete(key);
      if (flushed === undefined || flushed.text === "") return [];
      const parent = parentOf(flushed.parentActionId);
      return flushed.type === "message"
        ? [{ type: "message", payload: { role: "assistant", text: flushed.text, ...parent } }]
        : [{ type: "reasoning", payload: { text: flushed.text, ...parent } }];
    });
  }

  #toolCall(call: ToolCall, parentActionId: string | undefined): AdapterEvent[] {
    if (this.#planCalls.has(call.toolCallId)) return [];
    const subagent = subagentOutputSchema.safeParse(call.rawOutput);
    if (subagent.success) this.#link(subagent.data.metadata.sessionID, call.toolCallId);
    // OpenCode reports its todo list as a tool call rather than as a plan update; a sub-agent's
    // list stays one of its steps.
    const todos = todoInputSchema.safeParse(call.rawInput);
    if (todos.success && parentActionId === undefined) {
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

    const events = [...this.#started(call, state, parentActionId), ...this.#scriptSteps(call)];
    const output = outputOf(call);
    if (state.status === "completed" || state.status === "failed") {
      this.#actions.delete(call.toolCallId);
      const child = subagent.success ? subagent.data.metadata : undefined;
      if (
        this.#extensions.subagentSteps === true &&
        state.status === "completed" &&
        child?.status === "running" &&
        !this.#endedChildren.delete(child.sessionID)
      ) {
        this.#working.set(child.sessionID, call.toolCallId);
        return events;
      }
      const outcome = state.status;
      events.push(...this.#scriptEnded(call.toolCallId), {
        type: "action.ended",
        payload: { actionId: call.toolCallId, outcome, result: output },
      });
    } else if (output !== "" && output !== state.output) {
      state.output = output;
      events.push({ type: "action.updated", payload: { actionId: call.toolCallId, output } });
    }
    return events;
  }

  #started(call: ToolCall, state: ActionState, parentActionId: string | undefined): AdapterEvent[] {
    if (state.started) return [];
    state.started = true;
    const title = call.title ?? "Tool call";
    const tool = attachedTool(title, this.#toolServers, this.#toolPrefixes);
    const delegation = delegationInputSchema.safeParse(call.rawInput);
    const description = delegation.success ? delegation.data.description : undefined;
    if (typeof description === "string") {
      this.#delegations.push({ actionId: call.toolCallId, description });
    }
    if (parentActionId !== undefined) this.#nested.add(call.toolCallId);
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
          ...parentOf(parentActionId),
        },
      },
    ];
  }

  // OpenCode 2's Code Mode runs a script that calls tools; each call is a step of the script, as
  // the script reports them (D-98).
  #scriptSteps(call: ToolCall): AdapterEvent[] {
    const script = scriptOutputSchema.safeParse(call.rawOutput);
    if (!script.success) return [];
    const steps = this.#scripts.get(call.toolCallId) ?? { started: 0, ended: new Set<number>() };
    this.#scripts.set(call.toolCallId, steps);
    return script.data.metadata.toolCalls.flatMap((row, index): AdapterEvent[] => {
      const actionId = `${call.toolCallId}/${index + 1}`;
      const events: AdapterEvent[] = [];
      if (index >= steps.started) {
        steps.started = index + 1;
        this.#nested.add(actionId);
        const tool = attachedTool(row.tool, this.#toolServers, (server) => `${server}.`);
        events.push({
          type: "action.started",
          payload: {
            actionId,
            kind: "other",
            title: row.tool,
            input: row.input ?? {},
            parentActionId: call.toolCallId,
            ...(tool === undefined ? {} : { tool }),
          },
        });
      }
      if (row.status !== "running" && !steps.ended.has(index)) {
        steps.ended.add(index);
        const outcome = row.status === "completed" ? "completed" : "failed";
        events.push({ type: "action.ended", payload: { actionId, outcome, result: "" } });
      }
      return events;
    });
  }

  // Steps still running when their script ended stopped with it.
  #scriptEnded(scriptId: string): AdapterEvent[] {
    const steps = this.#scripts.get(scriptId);
    if (steps === undefined) return [];
    this.#scripts.delete(scriptId);
    return Array.from({ length: steps.started }, (_, index) => index)
      .filter((index) => !steps.ended.has(index))
      .map(
        (index): AdapterEvent => ({
          type: "action.ended",
          payload: {
            actionId: `${scriptId}/${index + 1}`,
            outcome: "failed",
            result: "Stopped with its script.",
          },
        }),
      );
  }

  // A form from the agent's question tool, which the user answers in Needs you (D-98).
  #questionRequest(id: JsonRpcId, params: unknown): Translation {
    const { mode, toolCallId, requestedSchema } = elicitationParamsSchema.parse(params);
    const fields = requestedSchema?.properties ?? {};
    const questions = mode === undefined || mode === "form" ? questionsOf(fields) : [];
    if (questions.length === 0) {
      return { events: [], outgoing: [this.#peer.respond(id, { action: "decline" })] };
    }
    const requestId = `question-${id}`;
    this.#questions.set(requestId, { id, fields });
    const asking = toolCallId !== undefined && this.#actions.get(toolCallId)?.started === true;
    return {
      events: [
        ...this.#flush(),
        {
          type: "question.requested",
          payload: { requestId, ...(asking ? { actionId: toolCallId } : {}), questions },
        },
      ],
      outgoing: [],
    };
  }

  // The core's own tools never ask: what they lead to is guarded where it happens. A title can be
  // a shell command or a path, so only a tool call of kind "other" counts as one of them.
  #permissionRequest(id: JsonRpcId, params: unknown): Translation {
    const parsed = permissionParamsSchema.parse(params);
    const { options } = parsed;
    const child = childOf(parsed.toolCall._meta);
    const toolCall = ownTitle(parsed.toolCall, child);
    const parentActionId = child === undefined ? undefined : this.#parentOf(child);
    const allow = options.find((option) => option.kind === "allow_once");
    const own =
      this.#allowOwnToolAsks &&
      toolCall.kind === "other" &&
      attachedTool(toolCall.title ?? "", this.#toolServers, this.#toolPrefixes) !== undefined;
    if (own && allow !== undefined) {
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
    const app = attachedTool(toolCall.title ?? "", this.#vendorApps, this.#toolPrefixes);
    const events: AdapterEvent[] = [
      ...this.#flush(streamOf(child)),
      ...this.#started(toolCall, state, parentActionId),
      {
        type: "permission.requested",
        payload: {
          requestId,
          actionId: toolCall.toolCallId,
          title: toolCall.title ?? "Permission needed",
          input: toolCall.rawInput ?? {},
          options: options.map(({ optionId, name, kind }) => ({ optionId, label: name, kind })),
          ...(app === undefined ? {} : { tool: app }),
        },
      },
    ];
    return { events, outgoing: [] };
  }
}
