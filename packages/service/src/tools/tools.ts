import type { z } from "zod";

// The agent that called a tool, known from the token its session was given.
export interface Caller {
  sessionId: string;
  agentId: string;
  taskId: string;
}

// A tool on the core's MCP server. It returns at once: an outcome that waits on a person or
// another agent reaches the caller later, as a message from the core (D-39).
export interface Tool<Input = unknown> {
  name: string;
  description: string;
  input: z.ZodType<Input>;
  // Which agents see it: every team tool belongs to some role.
  offeredTo(caller: Caller): boolean;
  // The text the agent reads back.
  call(input: Input, caller: Caller): string | Promise<string>;
}

// A refusal the agent can act on, such as a worker that does not exist; it reads the message.
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function defineTool<Input>(tool: Tool<Input>): Tool {
  return tool as Tool;
}
