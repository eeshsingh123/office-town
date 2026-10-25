import { randomBytes } from "node:crypto";
import type { ActionKind, PermissionOption, TokenUsage, UsageLimit } from "@office-town/contract";
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
import {
  type Approval,
  approvalResolvedSchema,
  approvalSchema,
  deltaSchema,
  type Item,
  itemNoticeSchema,
  type Subscription,
  sessionNoticeSchema,
  sessionResultSchema,
  subscriptionSchema,
  todoSchema,
  tokenUsageSchema,
  turnCompletedSchema,
  turnResultSchema,
  userInputSchema,
} from "./messages.ts";

const NOTHING: Translation = { events: [], outgoing: [] };
export const CLIENT_INFO = { name: "office_town", title: "Office Town", version: "0.1.0" };

// Every command carries a fresh UUIDv7, which Muse keeps to make a retried command harmless.
export function commandId(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Ask: anything no rule allows waits for an answer. Bypass: everything runs.
const APPROVAL_MODES = { ask: "promptUnmatched", bypass: "allowAll" } as const;

// Muse's decisions as the options the user picks from; its persistent rules are left out, since
// "allow always" lasts one session here (D-24).
const DECISIONS: Record<string, PermissionOption["kind"]> = {
  approved: "allow_once",
  approvedForSession: "allow_always",
  denied: "reject_once",
};

// Muse names an MCP tool by its server in one of these forms.
const toolPrefixes = (server: string) => [
  `mcp__${server}__`,
  `${server}__`,
  `${server}.`,
  `${server}/`,
];

function kindOf(tool: string): ActionKind {
  const name = tool.toLowerCase();
  if (/(read|view|cat|open)/.test(name)) return "read";
  if (/(write|edit|patch|apply)/.test(name)) return "edit";
  if (/(grep|glob|search|find|list)/.test(name)) return "search";
  if (/(shell|bash|exec|command|run)/.test(name)) return "execute";
  if (/(fetch|web|http)/.test(name)) return "fetch";
  return "other";
}

function argsOf(raw: string | undefined): unknown {
  if (raw === undefined) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { args: raw };
  }
}

// MCP servers as session/start takes them: HTTP headers and stdio variables go over stdin, never
// on the command line.
function mcpServersOf(servers: AttachedToolServer[]) {
  return Object.fromEntries(
    servers.map((server) => [
      server.name,
      server.transport === "http"
        ? { transport: "streamableHttp", url: server.url, headers: server.headers }
        : { transport: "stdio", command: server.command, args: server.args, env: server.env },
    ]),
  );
}

export function limitsOf({ window, weekly }: Subscription): UsageLimit[] {
  const minutes = window.windowDurationMins;
  return [
    {
      ...(minutes === 300
        ? { id: "five_hour", label: "5 hours" }
        : { id: `${minutes}_minutes`, label: `${minutes} minutes` }),
      usedFraction: Math.max(0, window.usedPercent) / 100,
      resetsAt: new Date(window.resetsAtMs).toISOString(),
    },
    {
      id: "seven_day",
      label: "week",
      usedFraction: Math.max(0, weekly.usedPercent) / 100,
      resetsAt: new Date(weekly.resetsAtMs).toISOString(),
    },
  ];
}

const TODO_STATUS = {
  pending: "pending",
  inProgress: "in_progress",
  completed: "completed",
} as const;

export class MuseTranslator implements Translator {
  readonly #peer = new JsonRpcPeer();
  readonly #options: LaunchOptions;
  readonly #queuedPrompts: object[][] = [];
  readonly #kinds = new Map<string, string>();
  readonly #started = new Set<string>();
  readonly #permissions = new Map<string, Approval>();
  readonly #questions = new Map<string, string>();
  #sessionId: string | undefined;
  #turnId: string | undefined;
  #turnActive = false;
  // Settings sent to a resumed session, which the first prompt waits for.
  #settingsPending = 0;
  #requests = 0;
  #used: TokenUsage | undefined;

  constructor(options: LaunchOptions) {
    this.#options = options;
  }

  open(): string[] {
    return [this.#peer.request("initialize", { clientInfo: CLIENT_INFO })];
  }

  receive(line: string): Translation {
    const incoming = this.#peer.parse(line);
    switch (incoming.kind) {
      case "result":
        return this.#result(incoming.method, incoming.result);
      case "error":
        return this.#failure(incoming.method, incoming.message);
      case "notification":
        return this.#notification(incoming.method, incoming.params);
      case "request":
        return this.#request(incoming.id, incoming.method, incoming.params);
    }
  }

  // A prompt during a turn would steer it, so prompts wait for the turn to end instead.
  prompt(text: string, images: InlineImage[]): Translation {
    this.#queuedPrompts.push([
      ...images.map(({ mimeType, data }) => ({
        type: "image",
        mediaType: mimeType,
        base64Data: data,
      })),
      { type: "text", text },
    ]);
    return this.#nextPrompt();
  }

  answerPermission(requestId: string, option: PermissionOption): Translation {
    const approval = this.#permissions.get(requestId);
    if (approval === undefined) throw new Error(`Unknown permission request "${requestId}".`);
    this.#permissions.delete(requestId);
    return { events: [], outgoing: [this.#decide(approval, option.optionId)] };
  }

  // An answer that is not one of the options is the user's own words.
  answerQuestion(requestId: string, answers: AnsweredQuestion[]): Translation {
    const userInputId = this.#questions.get(requestId);
    if (userInputId === undefined) throw new Error(`Unknown question "${requestId}".`);
    this.#questions.delete(requestId);
    const answered = answers.map(({ question, selected }) => {
      const labels = selected.filter((value) => question.options.some((o) => o.label === value));
      const own = selected.filter((value) => !labels.includes(value)).join("\n");
      return {
        questionId: question.questionId,
        ...(question.multiSelect
          ? { selectedLabels: labels }
          : labels[0]
            ? { selectedLabel: labels[0] }
            : {}),
        ...(own === "" ? {} : { freeText: own }),
      };
    });
    const params = {
      commandId: commandId(),
      sessionId: this.#sessionId,
      userInputId,
      answers: answered,
    };
    return { events: [], outgoing: [this.#peer.request("userInput/answer", params)] };
  }

  interrupt(): Translation {
    if (!this.#turnActive) return NOTHING;
    const params = {
      commandId: commandId(),
      sessionId: this.#sessionId,
      ...(this.#turnId === undefined ? {} : { turnId: this.#turnId }),
    };
    const events: AdapterEvent[] = [...this.#permissions.keys()].map((requestId) => ({
      type: "permission.resolved",
      payload: { requestId, outcome: "cancelled" },
    }));
    this.#permissions.clear();
    return { events, outgoing: [this.#peer.request("turn/interrupt", params)] };
  }

  #decide(approval: Approval, choiceId: string): string {
    return this.#peer.request("approval/decide", {
      commandId: commandId(),
      sessionId: this.#sessionId,
      approvalId: approval.approvalId,
      choiceId,
      requirementId: approval.currentRequirementId,
    });
  }

  #result(method: string, result: unknown): Translation {
    switch (method) {
      case "initialize":
        return {
          events: [],
          outgoing: [this.#peer.notify("initialized", {}), this.#openSession()],
        };
      case "session/start":
      case "session/resume":
        return this.#sessionOpened(result);
      case "session/setApprovalMode":
      case "session/setModel":
        return this.#settingApplied();
      case "turn/start":
        this.#turnId = turnResultSchema.parse(result).turnId;
        return NOTHING;
      default:
        return NOTHING;
    }
  }

  #openSession(): string {
    const { workspacePath, additionalPaths = [], model, permissionMode } = this.#options;
    const config = { mcpServers: mcpServersOf(this.#options.toolServers) };
    const resumed = this.#options.resumeSessionId;
    if (resumed !== undefined) {
      return this.#peer.request("session/resume", {
        commandId: commandId(),
        sessionId: resumed,
        config,
        excludeItems: true,
      });
    }
    return this.#peer.request("session/start", {
      commandId: commandId(),
      workspaceRoot: workspacePath,
      ...(additionalPaths.length > 0
        ? { workspaceRoots: [workspacePath, ...additionalPaths] }
        : {}),
      approvalMode: APPROVAL_MODES[permissionMode],
      ...(model === undefined ? {} : { modelId: model }),
      config,
    });
  }

  #sessionOpened(result: unknown): Translation {
    const { session } = sessionResultSchema.parse(result);
    this.#sessionId = session.sessionId;
    const model = this.#options.model ?? session.modelId ?? undefined;
    const started: AdapterEvent = {
      type: "session.started",
      payload: { harnessSessionId: session.sessionId, ...(model ? { model } : {}) },
    };
    if (this.#options.resumeSessionId !== undefined) {
      return { events: [started], outgoing: this.#reapplySettings() };
    }
    const next = this.#nextPrompt();
    return { events: [started, ...next.events], outgoing: next.outgoing };
  }

  // A resumed session keeps the approval mode and model it started with, so the ones chosen now
  // are set again before it runs anything.
  #reapplySettings(): string[] {
    const { permissionMode, model } = this.#options;
    const session = { commandId: commandId(), sessionId: this.#sessionId };
    const outgoing = [
      this.#peer.request("session/setApprovalMode", {
        ...session,
        mode: APPROVAL_MODES[permissionMode],
      }),
      ...(model === undefined
        ? []
        : [
            this.#peer.request("session/setModel", {
              ...session,
              commandId: commandId(),
              model: { modelId: model },
            }),
          ]),
    ];
    this.#settingsPending = outgoing.length;
    return outgoing;
  }

  #settingApplied(): Translation {
    this.#settingsPending -= 1;
    return this.#nextPrompt();
  }

  #failure(method: string, message: string): Translation {
    if (method === "turn/interrupt" || method === "userInput/answer") return NOTHING;
    // A model it cannot switch to is reported; an approval mode it cannot set ends the session
    // below, since it could otherwise run unasked.
    if (method === "session/setModel") {
      const error = `Muse kept its earlier model: ${message}`;
      const next = this.#settingApplied();
      return {
        events: [{ type: "error", payload: { message: error, fatal: false } }, ...next.events],
        outgoing: next.outgoing,
      };
    }
    if (method === "approval/decide") {
      const error = `Muse did not take the answer: ${message}`;
      return {
        events: [{ type: "error", payload: { message: error, fatal: false } }],
        outgoing: [],
      };
    }
    if (method !== "turn/start") {
      const error = `Muse rejected "${method}": ${message}`;
      return {
        events: [{ type: "error", payload: { message: error, fatal: true } }],
        outgoing: [],
      };
    }
    this.#turnActive = false;
    const next = this.#nextPrompt();
    return {
      events: [
        { type: "error", payload: { message, fatal: false } },
        { type: "turn.ended", payload: { outcome: "failed" } },
        ...next.events,
      ],
      outgoing: next.outgoing,
    };
  }

  #nextPrompt(): Translation {
    if (this.#sessionId === undefined || this.#turnActive || this.#settingsPending > 0) {
      return NOTHING;
    }
    const input = this.#queuedPrompts.shift();
    if (input === undefined) return NOTHING;
    this.#turnActive = true;
    this.#turnId = undefined;
    this.#used = undefined;
    const { effort } = this.#options;
    const params = {
      commandId: commandId(),
      sessionId: this.#sessionId,
      input,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
    };
    return {
      events: [{ type: "turn.started" }],
      outgoing: [this.#peer.request("turn/start", params)],
    };
  }

  #notification(method: string, params: unknown): Translation {
    if (method === "usage/changed") {
      const usage = subscriptionSchema.safeParse(params);
      if (!usage.success) return NOTHING;
      return {
        events: [{ type: "limits.updated", payload: { limits: limitsOf(usage.data) } }],
        outgoing: [],
      };
    }
    const { sessionId } = sessionNoticeSchema.parse(params);
    if (sessionId !== undefined && sessionId !== this.#sessionId) return NOTHING;
    switch (method) {
      case "item/started":
      case "item/updated":
        return this.#itemChanged(itemNoticeSchema.parse(params).item);
      case "item/delta":
        return this.#delta(params);
      case "item/completed":
        return this.#itemCompleted(itemNoticeSchema.parse(params).item);
      case "session/todoListChanged": {
        const steps = todoSchema
          .parse(params)
          .items.flatMap(({ text, status }) => {
            const known = TODO_STATUS[status as keyof typeof TODO_STATUS];
            return known === undefined ? [] : [{ title: text, status: known }];
          })
          .map((step, index) => ({ id: String(index + 1), ...step }));
        return { events: [{ type: "plan.updated", payload: { steps } }], outgoing: [] };
      }
      case "session/tokenUsage": {
        const { usage, promptTokens, totalTokens } = tokenUsageSchema.parse(params);
        this.#used = add(this.#used, {
          inputTokens: promptTokens,
          outputTokens: totalTokens - promptTokens,
          cachedInputTokens: usage.cachedTokens,
          contextTokens: totalTokens,
        });
        return NOTHING;
      }
      case "approval/resolved":
        return this.#approvalResolved(params);
      case "turn/completed":
        return this.#turnCompleted(params);
      default:
        return NOTHING;
    }
  }

  #itemChanged(item: Item): Translation {
    this.#kinds.set(item.itemId, item.kind);
    if (item.kind !== "toolCall" && item.kind !== "subagent") return NOTHING;
    const events = this.#startAction(item);
    if (item.visibleOutput && this.#started.has(item.itemId)) {
      events.push({
        type: "action.updated",
        payload: { actionId: item.itemId, output: item.visibleOutput },
      });
    }
    return { events, outgoing: [] };
  }

  #startAction(item: Item): AdapterEvent[] {
    if (this.#started.has(item.itemId)) return [];
    this.#started.add(item.itemId);
    const delegate = item.kind === "subagent";
    const tool = attachedTool(item.tool ?? "", this.#options.toolServers, toolPrefixes);
    const title = delegate
      ? (item.objective ?? item.role ?? "Sub-agent")
      : (item.displayLabel?.neutral ?? item.tool ?? "Tool call");
    return [
      {
        type: "action.started",
        payload: {
          actionId: item.itemId,
          kind: delegate ? "delegate" : kindOf(item.tool ?? ""),
          title,
          input: argsOf(item.args),
          ...(tool === undefined ? {} : { tool }),
        },
      },
    ];
  }

  // Only a reply's text is streamed; reasoning comes whole once it ends.
  #delta(params: unknown): Translation {
    const { itemId, field, delta } = deltaSchema.parse(params);
    if (this.#kinds.get(itemId) !== "agentMessage" || (field ?? "text") !== "text") return NOTHING;
    if (delta === "") return NOTHING;
    return {
      events: [{ type: "message.delta", payload: { text: delta } }],
      outgoing: [],
      partial: true,
    };
  }

  #itemCompleted(item: Item): Translation {
    this.#kinds.delete(item.itemId);
    if (item.kind === "agentMessage") {
      if (!item.text) return NOTHING;
      return {
        events: [{ type: "message", payload: { role: "assistant", text: item.text } }],
        outgoing: [],
      };
    }
    if (item.kind === "reasoning") {
      const text = item.text || (item.summary ?? []).join("\n\n");
      return text === ""
        ? NOTHING
        : { events: [{ type: "reasoning", payload: { text } }], outgoing: [] };
    }
    if (item.kind !== "toolCall" && item.kind !== "subagent") return NOTHING;
    const events = this.#startAction(item);
    this.#started.delete(item.itemId);
    events.push({
      type: "action.ended",
      payload: {
        actionId: item.itemId,
        outcome: item.status === "completed" ? "completed" : "failed",
        result: item.visibleOutput ?? item.failureReason ?? "",
      },
    });
    return { events, outgoing: [] };
  }

  #turnCompleted(params: unknown): Translation {
    const { terminal, error } = turnCompletedSchema.parse(params);
    this.#turnActive = false;
    const events: AdapterEvent[] = [];
    const outcome =
      terminal === "completed" ? "completed" : terminal === "cancelled" ? "interrupted" : "failed";
    if (outcome === "failed" && error) {
      events.push({ type: "error", payload: { message: error.message, fatal: false } });
    }
    const usage = this.#used;
    events.push({
      type: "turn.ended",
      payload: { outcome, ...(usage === undefined ? {} : { usage }) },
    });
    const next = this.#nextPrompt();
    return { events: [...events, ...next.events], outgoing: next.outgoing };
  }

  // Each request is acknowledged at once: the answer itself goes as a command later.
  #request(id: JsonRpcId, method: string, params: unknown): Translation {
    if (method === "approval/request") return this.#approval(id, params);
    if (method === "userInput/request") return this.#question(id, params);
    return { events: [], outgoing: [this.#peer.reject(id, METHOD_NOT_FOUND, "Not supported")] };
  }

  #approval(id: JsonRpcId, params: unknown): Translation {
    const approval = approvalSchema.parse(params);
    const receipt = this.#peer.respond(id, {});
    // Asked again, as after a reconnect, while the user has not answered yet.
    const pending = [...this.#permissions.entries()].find(
      ([, one]) => one.approvalId === approval.approvalId,
    );
    if (pending !== undefined) {
      this.#permissions.set(pending[0], approval);
      return { events: [], outgoing: [receipt] };
    }
    const options = approval.availableChoices.flatMap(({ choiceId, decision, label }) => {
      const kind = DECISIONS[decision];
      return kind === undefined ? [] : [{ optionId: choiceId, label, kind }];
    });
    // The core's own tools never ask: what they lead to is guarded where it happens.
    const own = attachedTool(approval.toolName, this.#options.toolServers, toolPrefixes);
    const allow = options.find((option) => option.kind === "allow_once");
    if (own !== undefined && allow !== undefined) {
      return { events: [], outgoing: [receipt, this.#decide(approval, allow.optionId)] };
    }
    this.#requests += 1;
    const requestId = `permission-${this.#requests}`;
    this.#permissions.set(requestId, approval);
    const { subject } = approval;
    const target = subject.command ?? subject.path ?? subject.target;
    const events: AdapterEvent[] = [
      {
        type: "permission.requested",
        payload: {
          requestId,
          actionId: approval.itemId,
          title: target === undefined ? approval.toolName : `${approval.toolName}: ${target}`,
          input: argsOf(approval.rawArgs),
          options,
          kind: kindOf(approval.toolName),
          ...(subject.path === undefined ? {} : { locations: [subject.path] }),
        },
      },
    ];
    return { events, outgoing: [receipt] };
  }

  // Answered elsewhere, such as by a rule or a timeout, before the user did.
  #approvalResolved(params: unknown): Translation {
    const { approvalId, decision } = approvalResolvedSchema.parse(params);
    const pending = [...this.#permissions.entries()].find(
      ([, one]) => one.approvalId === approvalId,
    );
    if (pending === undefined) return NOTHING;
    this.#permissions.delete(pending[0]);
    const outcome = decision.startsWith("approved") ? "allowed" : "denied";
    return {
      events: [{ type: "permission.resolved", payload: { requestId: pending[0], outcome } }],
      outgoing: [],
    };
  }

  #question(id: JsonRpcId, params: unknown): Translation {
    const { userInputId, itemId, questions } = userInputSchema.parse(params);
    const requestId = `question-${userInputId}`;
    this.#questions.set(requestId, userInputId);
    return {
      events: [
        {
          type: "question.requested",
          payload: {
            requestId,
            actionId: itemId,
            questions: questions.map((question) => ({
              questionId: question.id,
              text: question.question,
              ...(question.header ? { header: question.header } : {}),
              options: question.options.map(({ label, description }) => ({
                label,
                ...(description ? { description } : {}),
              })),
              multiSelect: question.selection.mode === "multiple",
            })),
          },
        },
      ],
      outgoing: [this.#peer.respond(id, {})],
    };
  }
}

// Each model call reports its own use; the conversation's length is the last call's.
function add(total: TokenUsage | undefined, call: TokenUsage): TokenUsage {
  if (total === undefined) return call;
  return {
    inputTokens: total.inputTokens + call.inputTokens,
    outputTokens: total.outputTokens + call.outputTokens,
    cachedInputTokens: (total.cachedInputTokens ?? 0) + (call.cachedInputTokens ?? 0),
    ...(call.contextTokens === undefined ? {} : { contextTokens: call.contextTokens }),
  };
}
