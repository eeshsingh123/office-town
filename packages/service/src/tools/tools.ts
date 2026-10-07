import type { z } from "zod";

// Known from the token its session was given.
export interface Caller {
  sessionId: string;
  agentId: string;
  taskId: string;
}

// Returns at once; an outcome that waits on someone reaches the caller later as a message (D-39).
export interface Tool<Input = unknown> {
  name: string;
  description: string;
  input: z.ZodType<Input>;
  offeredTo(caller: Caller): boolean;
  call(input: Input, caller: Caller): string | Promise<string>;
}

// A refusal the agent can act on; it reads the message.
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function defineTool<Input>(tool: Tool<Input>): Tool {
  return tool as Tool;
}
