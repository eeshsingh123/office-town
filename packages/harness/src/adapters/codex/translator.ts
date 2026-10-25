import type { ActionKind, PermissionOption, UsageLimit } from "@office-town/contract";
import type {
  AdapterEvent,
  AnsweredQuestion,
  InlineImage,
  LaunchOptions,
  Translation,
  Translator,
} from "../../adapter.ts";
import { type JsonRpcId, JsonRpcPeer, METHOD_NOT_FOUND } from "../../json-rpc.ts";
import {
  approvalParamsSchema,
  type Breakdown,
  deltaSchema,
  errorNoticeSchema,
  type Item,
  itemNoticeSchema,
  planSchema,
  type RateLimits,
  rateLimitsNoticeSchema,
  threadNoticeSchema,
  threadResultSchema,
  tokenUsageSchema,
  turnCompletedSchema,
  turnResultSchema,
  userInputParamsSchema,
} from "./messages.ts";

const NOTHING: Translation = { events: [], outgoing: [] };
const APPROVALS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);
const CLIENT_INFO = { name: "office_town", title: "Office Town", version: "0.1.0" };

// Codex's own answers to an approval, as the options the user picks from.
const APPROVAL_OPTIONS: PermissionOption[] = [
  { optionId: "accept", label: "Allow", kind: "allow_once" },
  { optionId: "acceptForSession", label: "Allow for this session", kind: "allow_always" },
  { optionId: "decline", label: "Deny", kind: "reject_once" },
];

// Ask: Codex asks before anything it does not trust, inside a sandbox that writes only the
// workspace. Bypass: it asks nothing and the sandbox is off.
export const PERMISSIONS = {
  ask: { approvalPolicy: "untrusted", sandbox: "workspace-write" },
  bypass: { approvalPolicy: "never", sandbox: "danger-full-access" },
} as const;

const KINDS: Record<string, ActionKind> = {
  commandExecution: "execute",
  fileChange: "edit",
  mcpToolCall: "other",
  dynamicToolCall: "other",
  webSearch: "fetch",
  imageView: "read",
  collabAgentToolCall: "delegate",
};

function titleOf(item: Item): string {
  switch (item.type) {
    case "commandExecution":
      return item.command ?? "Run a command";
    case "fileChange":
      return `Edit ${(item.changes ?? []).map((change) => change.path).join(", ")}`;
    case "mcpToolCall":
    case "dynamicToolCall":
      return item.server === undefined ? (item.tool ?? "Tool call") : `${item.server} ${item.tool}`;
    case "webSearch":
      return `Search the web for ${item.query ?? ""}`.trim();
    case "imageView":
      return `View ${item.path ?? "an image"}`;
    default:
      return item.prompt ?? "Sub-agent";
  }
}

function inputOf(item: Item): unknown {
  switch (item.type) {
    case "commandExecution":
      return { command: item.command, cwd: item.cwd };
    case "fileChange":
      return { changes: item.changes };
    case "webSearch":
      return { query: item.query };
    default:
      return item.arguments ?? (item.prompt ? { prompt: item.prompt } : {});
  }
}

function resultOf(item: Item): string {
  if (item.error) return item.error.message;
  if (item.result) return item.result.content.map((part) => part.text ?? "").join("");
  return item.aggregatedOutput ?? "";
}

const failed = (status: string | undefined) =>
  status === "failed" || status === "declined" || status === "error";

// Window lengths in minutes, named as the Usage page knows them.
const WINDOW_IDS: Record<number, { id: string; label: string }> = {
  300: { id: "five_hour", label: "5 hours" },
  10080: { id: "seven_day", label: "week" },
};

export function limitsOf(limits: RateLimits): UsageLimit[] {
  return [limits.primary, limits.secondary].flatMap((window) => {
    if (!window) return [];
    const minutes = window.windowDurationMins ?? 0;
    const named = WINDOW_IDS[minutes] ?? { id: `${minutes}_minutes`, label: `${minutes} minutes` };
    return [
      {
        ...named,
        usedFraction: Math.max(0, window.usedPercent) / 100,
        ...(window.resetsAt ? { resetsAt: new Date(window.resetsAt * 1000).toISOString() } : {}),
      },
    ];
  });
}

const minus = (a: Breakdown, b: Breakdown | undefined): Breakdown => ({
  inputTokens: a.inputTokens - (b?.inputTokens ?? 0),
  cachedInputTokens: a.cachedInputTokens - (b?.cachedInputTokens ?? 0),
  outputTokens: a.outputTokens - (b?.outputTokens ?? 0),
});

export class CodexTranslator implements Translator {
  readonly #peer = new JsonRpcPeer();
  readonly #options: LaunchOptions;
  readonly #queuedPrompts: object[][] = [];
  readonly #started = new Set<string>();
  readonly #outputs = new Map<string, string>();
  readonly #permissions = new Map<string, JsonRpcId>();
  readonly #questions = new Map<string, JsonRpcId>();
  #threadId: string | undefined;
  #turnId: string | undefined;
  #turnActive = false;
  // Codex reports the thread's running total; a turn's own use is the difference.
  #total: Breakdown | undefined;
  #turnStartTotal: Breakdown | undefined;
  #last: Breakdown | undefined;

  constructor(options: LaunchOptions) {
    this.#options = options;
  }

  open(): string[] {
    return [this.#peer.request("initialize", { clientInfo: CLIENT_INFO, capabilities: null })];
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

  // Codex takes a prompt during a turn as a steer, so prompts wait for the turn to end instead.
  prompt(text: string, images: InlineImage[]): Translation {
    this.#queuedPrompts.push([
      { type: "text", text, text_elements: [] },
      ...images.map(({ mimeType, data }) => ({
        type: "image",
        url: `data:${mimeType};base64,${data}`,
      })),
    ]);
    return this.#nextPrompt();
  }

  answerPermission(requestId: string, option: PermissionOption): Translation {
    const id = this.#permissions.get(requestId);
    if (id === undefined) throw new Error(`Unknown permission request "${requestId}".`);
    this.#permissions.delete(requestId);
    return { events: [], outgoing: [this.#peer.respond(id, { decision: option.optionId })] };
  }

  answerQuestion(requestId: string, answers: AnsweredQuestion[]): Translation {
    const id = this.#questions.get(requestId);
    if (id === undefined) throw new Error(`Unknown question "${requestId}".`);
    this.#questions.delete(requestId);
    const answered = Object.fromEntries(
      answers.map(({ question, selected }) => [question.questionId, { answers: selected }]),
    );
    return { events: [], outgoing: [this.#peer.respond(id, { answers: answered })] };
  }

  interrupt(): Translation {
    if (!this.#turnActive || this.#turnId === undefined) return NOTHING;
    const params = { threadId: this.#threadId, turnId: this.#turnId };
    const outgoing = [this.#peer.request("turn/interrupt", params)];
    const events: AdapterEvent[] = [];
    for (const [requestId, id] of this.#permissions) {
      outgoing.push(this.#peer.respond(id, { decision: "cancel" }));
      events.push({ type: "permission.resolved", payload: { requestId, outcome: "cancelled" } });
    }
    this.#permissions.clear();
    return { events, outgoing };
  }

  #result(method: string, result: unknown): Translation {
    switch (method) {
      case "initialize":
        return { events: [], outgoing: [this.#peer.notify("initialized", {}), this.#openThread()] };
      case "thread/start":
      case "thread/resume":
        return this.#threadOpened(result);
      case "turn/start":
        this.#turnId = turnResultSchema.parse(result).turn.id;
        return NOTHING;
      default:
        return NOTHING;
    }
  }

  #openThread(): string {
    const { workspacePath, model, permissionMode, resumeSessionId } = this.#options;
    const params = {
      cwd: workspacePath,
      ...PERMISSIONS[permissionMode],
      ...(model === undefined ? {} : { model }),
    };
    return resumeSessionId === undefined
      ? this.#peer.request("thread/start", params)
      : this.#peer.request("thread/resume", { threadId: resumeSessionId, ...params });
  }

  #threadOpened(result: unknown): Translation {
    const { thread, model } = threadResultSchema.parse(result);
    this.#threadId = thread.id;
    const started: AdapterEvent = {
      type: "session.started",
      payload: { harnessSessionId: thread.id, ...(model === undefined ? {} : { model }) },
    };
    const next = this.#nextPrompt();
    return { events: [started, ...next.events], outgoing: next.outgoing };
  }

  #failure(method: string, message: string): Translation {
    if (method === "turn/interrupt") return NOTHING;
    if (method !== "turn/start") {
      const error = `Codex rejected "${method}": ${message}`;
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
    if (this.#threadId === undefined || this.#turnActive) return NOTHING;
    const input = this.#queuedPrompts.shift();
    if (input === undefined) return NOTHING;
    this.#turnActive = true;
    this.#turnId = undefined;
    this.#turnStartTotal = this.#total;
    const { effort } = this.#options;
    const params = { threadId: this.#threadId, input, ...(effort === undefined ? {} : { effort }) };
    return {
      events: [{ type: "turn.started" }],
      outgoing: [this.#peer.request("turn/start", params)],
    };
  }

  // Sub-agents run in threads of their own, which show here as the action that started them.
  #ours(params: unknown): boolean {
    const { threadId } = threadNoticeSchema.parse(params);
    return threadId === undefined || threadId === this.#threadId;
  }

  #notification(method: string, params: unknown): Translation {
    if (method === "account/rateLimits/updated") {
      const limits = limitsOf(rateLimitsNoticeSchema.parse(params).rateLimits);
      if (limits.length === 0) return NOTHING;
      return { events: [{ type: "limits.updated", payload: { limits } }], outgoing: [] };
    }
    if (!this.#ours(params)) return NOTHING;
    switch (method) {
      case "item/agentMessage/delta":
        return this.#delta("message.delta", params);
      case "item/commandExecution/outputDelta":
        return this.#output(params);
      case "item/started":
        return this.#itemStarted(itemNoticeSchema.parse(params).item);
      case "item/completed":
        return this.#itemCompleted(itemNoticeSchema.parse(params).item);
      case "turn/plan/updated": {
        const steps = planSchema
          .parse(params)
          .plan.map(({ step, status }, index) => ({ id: String(index + 1), title: step, status }));
        return { events: [{ type: "plan.updated", payload: { steps } }], outgoing: [] };
      }
      case "thread/tokenUsage/updated": {
        const { total, last } = tokenUsageSchema.parse(params).tokenUsage;
        this.#total = total;
        this.#last = last;
        return NOTHING;
      }
      case "error": {
        const notice = errorNoticeSchema.parse(params);
        if (notice.willRetry) return NOTHING;
        const message = notice.error.message;
        return { events: [{ type: "error", payload: { message, fatal: false } }], outgoing: [] };
      }
      case "turn/completed":
        return this.#turnCompleted(params);
      default:
        return NOTHING;
    }
  }

  #delta(type: "message.delta", params: unknown): Translation {
    const { delta } = deltaSchema.parse(params);
    if (delta === "") return NOTHING;
    return { events: [{ type, payload: { text: delta } }], outgoing: [], partial: true };
  }

  #output(params: unknown): Translation {
    const { itemId, delta } = deltaSchema.parse(params);
    if (!this.#started.has(itemId)) return NOTHING;
    const output = (this.#outputs.get(itemId) ?? "") + delta;
    this.#outputs.set(itemId, output);
    return {
      events: [{ type: "action.updated", payload: { actionId: itemId, output } }],
      outgoing: [],
    };
  }

  #itemStarted(item: Item): Translation {
    return { events: this.#startAction(item), outgoing: [] };
  }

  #startAction(item: Item): AdapterEvent[] {
    const kind = KINDS[item.type];
    if (kind === undefined || this.#started.has(item.id)) return [];
    this.#started.add(item.id);
    const own = this.#options.toolServers.some((server) => server.name === item.server);
    const locations = (item.changes ?? []).map((change) => change.path);
    return [
      {
        type: "action.started",
        payload: {
          actionId: item.id,
          kind,
          title: titleOf(item),
          input: inputOf(item),
          ...(locations.length > 0 ? { locations } : {}),
          ...(own && item.server && item.tool
            ? { tool: { server: item.server, name: item.tool } }
            : {}),
        },
      },
    ];
  }

  #itemCompleted(item: Item): Translation {
    if (item.type === "agentMessage") {
      if (!item.text) return NOTHING;
      const message: AdapterEvent = {
        type: "message",
        payload: { role: "assistant", text: item.text },
      };
      return { events: [message], outgoing: [] };
    }
    if (item.type === "reasoning") {
      const text = (item.summary?.length ? item.summary : (item.content ?? [])).join("\n\n");
      if (text === "") return NOTHING;
      return { events: [{ type: "reasoning", payload: { text } }], outgoing: [] };
    }
    const events = this.#startAction(item);
    if (!this.#started.delete(item.id)) return { events, outgoing: [] };
    this.#outputs.delete(item.id);
    events.push({
      type: "action.ended",
      payload: {
        actionId: item.id,
        outcome: failed(item.status) || item.error ? "failed" : "completed",
        result: resultOf(item),
      },
    });
    return { events, outgoing: [] };
  }

  #turnCompleted(params: unknown): Translation {
    const { turn } = turnCompletedSchema.parse(params);
    this.#turnActive = false;
    const events: AdapterEvent[] = [];
    const outcome =
      turn.status === "interrupted"
        ? "interrupted"
        : turn.status === "failed"
          ? "failed"
          : "completed";
    if (outcome === "failed" && turn.error) {
      events.push({ type: "error", payload: { message: turn.error.message, fatal: false } });
    }
    const used = this.#total === undefined ? undefined : minus(this.#total, this.#turnStartTotal);
    const last = this.#last;
    events.push({
      type: "turn.ended",
      payload: {
        outcome,
        // OpenAI counts cached input inside the input, as the contract does.
        ...(used === undefined
          ? {}
          : {
              usage: {
                inputTokens: used.inputTokens,
                outputTokens: used.outputTokens,
                cachedInputTokens: used.cachedInputTokens,
                ...(last === undefined
                  ? {}
                  : { contextTokens: last.inputTokens + last.outputTokens }),
              },
            }),
      },
    });
    const next = this.#nextPrompt();
    return { events: [...events, ...next.events], outgoing: next.outgoing };
  }

  #request(id: JsonRpcId, method: string, params: unknown): Translation {
    if (APPROVALS.has(method)) return this.#approval(id, method, params);
    if (method === "item/tool/requestUserInput") return this.#question(id, params);
    // Anything else Codex asks, such as an MCP server's form, is turned down.
    return { events: [], outgoing: [this.#peer.reject(id, METHOD_NOT_FOUND, "Not supported")] };
  }

  #approval(id: JsonRpcId, method: string, params: unknown): Translation {
    const approval = approvalParamsSchema.parse(params);
    const requestId = `permission-${id}`;
    this.#permissions.set(requestId, id);
    const command = method === "item/commandExecution/requestApproval";
    const title = command ? (approval.command ?? "Run a command") : "Edit files";
    const events: AdapterEvent[] = [
      {
        type: "permission.requested",
        payload: {
          requestId,
          actionId: approval.itemId,
          title,
          input: { command: approval.command, cwd: approval.cwd, reason: approval.reason },
          options: APPROVAL_OPTIONS,
          kind: command ? "execute" : "edit",
        },
      },
    ];
    return { events, outgoing: [] };
  }

  #question(id: JsonRpcId, params: unknown): Translation {
    const { questions, itemId } = userInputParamsSchema.parse(params);
    const requestId = `question-${id}`;
    this.#questions.set(requestId, id);
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
              options: (question.options ?? []).map(({ label, description }) => ({
                label,
                ...(description ? { description } : {}),
              })),
              multiSelect: false,
            })),
          },
        },
      ],
      outgoing: [],
    };
  }
}
