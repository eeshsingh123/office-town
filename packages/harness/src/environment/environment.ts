import type { Readable, Writable } from "node:stream";
import type { AttachedToolServer, ToolServer } from "../adapter.ts";

export interface LaunchRequest {
  binary: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface LaunchedProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  exited: Promise<ProcessExit>;
  killTree(): Promise<void>;
}

export interface Environment {
  launch(request: LaunchRequest): Promise<LaunchedProcess>;
  toEnvironmentPath(hostPath: string): string;
  toHostPath(environmentPath: string): string;
  // How a harness running here reaches a server listening on this machine's 127.0.0.1.
  reach(server: ToolServer): AttachedToolServer;
}
