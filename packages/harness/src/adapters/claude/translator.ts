import type { ActionKind, PermissionOption, PlanStep } from "@office-town/contract";
import type { AdapterEvent, Translation, Translator } from "../../adapter.ts";
import {
  assistantSchema,
  controlCancelSchema,
  controlRequestSchema,
  headerSchema,
  initSchema,
  permissionRequestSchema,
  resultSchema,
  type TaskUpdateInput,
  type ToolResult,
  type ToolResultContent,
  type ToolUse,
  taskCreateInputSchema,
  taskNotificationSchema,
  taskStartedSchema,
  taskUpdateInputSchema,
  textBlockSchema,
  thinkingBlockSchema,
  toolResultSchema,
  toolUseSchema,
  userSchema,
} from "./messages.ts";

interface PendingPermission {
  input: Record<string, unknown>;
  suggestions: unknown[];
}

const ACTION_KINDS: Record<string, ActionKind> = {
  Read: "read",
  Write: "edit",
  Edit: "edit",
  NotebookEdit: "edit",
  Glob: "search",
  Grep: "search",
  ToolSearch: "search",
  Bash: "execute",
  PowerShell: "execute",
  WebFetch: "fetch",
  WebSearch: "fetch",
  Agent: "delegate",
  Task: "delegate",
};

const PLAN_TOOLS = new Set(["TaskCreate", "TaskUpdate"]);
const TITLE_FIELDS = ["description", "file_path", "pattern", "command", "url", "query"];
const STEP_STATUSES = new Set<string>(["pending", "in_progress", "completed"]);

const PERMISSION_OPTIONS = {
  allow: { optionId: "allow", label: "Allow once", kind: "allow_once" },
  allowAlways: {
    optionId: "allow_always",
    label: "Allow, and stop asking for similar actions",
    kind: "allow_always",
  },
  deny: { optionId: "deny", label: "Deny", kind: "reject_once" },
} satisfies Record<string, PermissionOption>;

function titleOf(name: string, input: Record<string, unknown>): string {
  const detail = TITLE_FIELDS.map((field) => input[field]).find((v) => typeof v === "string");
  return detail === undefined ? name : `${name}: ${detail}`;
}

function textOf(content: ToolResultContent | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content.map((part) => part.text ?? `[${part.type}]`).join("\n");
}

function parentOf(parentToolUseId: string | null | undefined): { parentActionId?: string } {
  return typeof parentToolUseId === "string" ? { parentActionId: parentToolUseId } : {};
}

function translated(events: AdapterEvent[], outgoing: string[] = []): Translation {
  return { events, outgoing };
}

export class ClaudeTranslator implements Translator {
  #sessionStarted = false;
  #interrupts = 0;
  #steps: PlanStep[] = [];
  readonly #planCalls = new Map<string, ToolUse>();
  readonly #backgroundActions = new Set<string>();
  readonly #pendingPermissions = new Map<string, PendingPermission>();

  readonly #handlers: Record<string, (message: unknown) => Translation> = {
    "system/init": (message) => this.#init(message),
    "system/task_started": (message) => this.#taskStarted(message),
    "system/task_notification": (message) => this.#taskNotification(message),
    assistant: (message) => this.#assistant(message),
    user: (message) => this.#user(message),
    control_request: (message) => this.#controlRequest(message),
    control_cancel_request: (message) => this.#controlCancel(message),
    result: (message) => this.#result(message),
  };

  open(): string[] {
    return [];
  }

  receive(line: string): Translation {
    const message: unknown = JSON.parse(line);
    const { type, subtype } = headerSchema.parse(message);
    const handler = this.#handlers[`${type}/${subtype}`] ?? this.#handlers[type];
    return handler === undefined ? translated([]) : handler(message);
  }

  prompt(text: string): Translation {
    return translated(
      [],
      [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: text },
          parent_tool_use_id: null,
          session_id: "",
        }),
      ],
    );
  }

  answerPermission(requestId: string, option: PermissionOption): Translation {
    const pending = this.#pendingPermissions.get(requestId);
    if (pending === undefined) throw new Error(`Unknown permission request "${requestId}".`);
    this.#pendingPermissions.delete(requestId);
    const allow = { behavior: "allow", updatedInput: pending.input };
    const decisions: Record<PermissionOption["kind"], object> = {
      allow_once: allow,
      allow_always: { ...allow, updatedPermissions: pending.suggestions },
      reject_once: { behavior: "deny", message: "The user denied this action." },
      reject_always: { behavior: "deny", message: "The user denied this action." },
    };
    return translated(
      [],
      [
        JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: decisions[option.kind],
          },
        }),
      ],
    );
  }

  interrupt(): Translation {
    this.#interrupts += 1;
    return translated(
      [],
      [
        JSON.stringify({
          type: "control_request",
          request_id: `interrupt-${this.#interrupts}`,
          request: { subtype: "interrupt" },
        }),
      ],
    );
  }

  // The CLI reports init at the start of every turn, not only the first.
  #init(message: unknown): Translation {
    const init = initSchema.parse(message);
    const events: AdapterEvent[] = [];
    if (!this.#sessionStarted) {
      this.#sessionStarted = true;
      events.push({
        type: "session.started",
        payload: {
          harnessSessionId: init.session_id,
          ...(init.model === undefined ? {} : { model: init.model }),
        },
      });
    }
    events.push({ type: "turn.started" });
    return translated(events);
  }

  #assistant(message: unknown): Translation {
    const { message: body, parent_tool_use_id } = assistantSchema.parse(message);
    const parent = parentOf(parent_tool_use_id);
    const events: AdapterEvent[] = [];
    for (const block of body.content) {
      if (block.type === "text") {
        const { text } = textBlockSchema.parse(block);
        events.push({ type: "message", payload: { role: "assistant", text, ...parent } });
      } else if (block.type === "thinking") {
        const { thinking } = thinkingBlockSchema.parse(block);
        if (thinking !== "")
          events.push({ type: "reasoning", payload: { text: thinking, ...parent } });
      } else if (block.type === "tool_use") {
        events.push(...this.#toolUse(toolUseSchema.parse(block), parent));
      }
    }
    return translated(events);
  }

  #toolUse(block: ToolUse, parent: { parentActionId?: string }): AdapterEvent[] {
    if (PLAN_TOOLS.has(block.name)) {
      this.#planCalls.set(block.id, block);
      return [];
    }
    return [
      {
        type: "action.started",
        payload: {
          actionId: block.id,
          kind: ACTION_KINDS[block.name] ?? "other",
          title: titleOf(block.name, block.input),
          input: block.input,
          ...parent,
        },
      },
    ];
  }

  #user(message: unknown): Translation {
    const { message: body } = userSchema.parse(message);
    if (typeof body.content === "string") return translated([]);
    const events: AdapterEvent[] = [];
    for (const block of body.content) {
      if (block.type === "tool_result") {
        events.push(...this.#toolResult(toolResultSchema.parse(block)));
      }
    }
    return translated(events);
  }

  #toolResult(block: ToolResult): AdapterEvent[] {
    const planCall = this.#planCalls.get(block.tool_use_id);
    if (planCall !== undefined) {
      this.#planCalls.delete(block.tool_use_id);
      return block.is_error ? [] : this.#applyPlanCall(planCall, textOf(block.content));
    }
    // A background sub-agent's tool result only confirms the launch; it ends on its notification.
    if (this.#backgroundActions.has(block.tool_use_id)) return [];
    return [
      {
        type: "action.ended",
        payload: {
          actionId: block.tool_use_id,
          outcome: block.is_error ? "failed" : "completed",
          result: textOf(block.content),
        },
      },
    ];
  }

  #applyPlanCall(call: ToolUse, result: string): AdapterEvent[] {
    if (call.name === "TaskCreate") {
      const { subject } = taskCreateInputSchema.parse(call.input);
      const id = /#(\d+)/.exec(result)?.[1] ?? String(this.#steps.length + 1);
      this.#steps = [...this.#steps, { id, title: subject, status: "pending" }];
    } else {
      const update = taskUpdateInputSchema.parse(call.input);
      this.#steps = this.#steps
        .filter((step) => !(step.id === update.taskId && update.status === "deleted"))
        .map((step) => (step.id === update.taskId ? this.#updatedStep(step, update) : step));
    }
    return [{ type: "plan.updated", payload: { steps: this.#steps } }];
  }

  #updatedStep(step: PlanStep, update: TaskUpdateInput): PlanStep {
    const status = STEP_STATUSES.has(update.status ?? "") ? update.status : step.status;
    return { ...step, title: update.subject ?? step.title, status: status as PlanStep["status"] };
  }

  #taskStarted(message: unknown): Translation {
    const task = taskStartedSchema.parse(message);
    if (task.is_backgrounded && task.tool_use_id !== undefined) {
      this.#backgroundActions.add(task.tool_use_id);
    }
    return translated([]);
  }

  #taskNotification(message: unknown): Translation {
    const task = taskNotificationSchema.parse(message);
    if (task.tool_use_id === undefined || !this.#backgroundActions.delete(task.tool_use_id)) {
      return translated([]);
    }
    return translated([
      {
        type: "action.ended",
        payload: {
          actionId: task.tool_use_id,
          outcome: task.status === "completed" ? "completed" : "failed",
          result: task.summary ?? task.status,
        },
      },
    ]);
  }

  #controlRequest(message: unknown): Translation {
    const { request_id, request } = controlRequestSchema.parse(message);
    if (request.subtype !== "can_use_tool") {
      const error = `Unsupported control request "${request.subtype}".`;
      const response = { subtype: "error", request_id, error };
      return translated([], [JSON.stringify({ type: "control_response", response })]);
    }
    const permission = permissionRequestSchema.parse(request);
    const suggestions = permission.permission_suggestions ?? [];
    this.#pendingPermissions.set(request_id, { input: permission.input, suggestions });
    const name = permission.display_name ?? permission.tool_name;
    return translated([
      {
        type: "permission.requested",
        payload: {
          requestId: request_id,
          ...(permission.tool_use_id === undefined ? {} : { actionId: permission.tool_use_id }),
          title: permission.description ? `${name}: ${permission.description}` : name,
          input: permission.input,
          options: [
            PERMISSION_OPTIONS.allow,
            ...(suggestions.length > 0 ? [PERMISSION_OPTIONS.allowAlways] : []),
            PERMISSION_OPTIONS.deny,
          ],
        },
      },
    ]);
  }

  #controlCancel(message: unknown): Translation {
    const { request_id } = controlCancelSchema.parse(message);
    if (!this.#pendingPermissions.delete(request_id)) return translated([]);
    return translated([
      { type: "permission.resolved", payload: { requestId: request_id, outcome: "cancelled" } },
    ]);
  }

  #result(message: unknown): Translation {
    const result = resultSchema.parse(message);
    const interrupted = result.terminal_reason?.startsWith("aborted") ?? false;
    const failed = result.is_error && !interrupted;
    const events: AdapterEvent[] = [];
    if (failed) {
      const text = result.result ?? `The turn ended with "${result.subtype}".`;
      events.push({ type: "error", payload: { message: text, fatal: false } });
    }
    const { usage } = result;
    const cached = usage?.cache_read_input_tokens ?? 0;
    events.push({
      type: "turn.ended",
      payload: {
        outcome: interrupted ? "interrupted" : failed ? "failed" : "completed",
        ...(usage === undefined
          ? {}
          : {
              usage: {
                inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + cached,
                outputTokens: usage.output_tokens,
                cachedInputTokens: cached,
              },
            }),
      },
    });
    return translated(events);
  }
}
