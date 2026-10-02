import type { Readable, Writable } from "node:stream";

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
}
