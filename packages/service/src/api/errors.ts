import type { ApiError } from "@office-town/contract";
import {
  BinaryNotFoundError,
  CatalogError,
  SessionStateError,
  UnknownHarnessError,
} from "@office-town/harness";
import { ZodError, z } from "zod";
import { NoChiefError } from "../chief/chief.ts";
import {
  AnswerError,
  SessionNotResumableError,
  SessionNotRunningError,
} from "../registry/session-registry.ts";
import {
  InUseError,
  NameTakenError,
  RecordNotFoundError,
  TaskActiveError,
} from "../store/store.ts";
import { FolderNotFoundError, OutputFolderMissingError } from "../task-folders.ts";
import { DepartmentBusyError, TeamError } from "../team/members.ts";

type ErrorCode = ApiError["error"];

export class RequestError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
  }
}

const knownErrors: [new (...args: never[]) => Error, number, ErrorCode][] = [
  [RecordNotFoundError, 404, "not_found"],
  [SessionNotRunningError, 409, "conflict"],
  [SessionNotResumableError, 409, "conflict"],
  [SessionStateError, 409, "conflict"],
  [AnswerError, 409, "conflict"],
  [TaskActiveError, 409, "conflict"],
  [NameTakenError, 409, "conflict"],
  [InUseError, 409, "conflict"],
  [DepartmentBusyError, 409, "conflict"],
  [NoChiefError, 409, "conflict"],
  [TeamError, 400, "invalid_request"],
  [UnknownHarnessError, 400, "invalid_request"],
  [FolderNotFoundError, 400, "invalid_request"],
  [OutputFolderMissingError, 400, "invalid_request"],
  // A malformed percent-encoding in the path.
  [URIError, 400, "invalid_request"],
  [BinaryNotFoundError, 502, "harness_failed"],
  [CatalogError, 502, "harness_failed"],
];

export interface ErrorReply {
  status: number;
  body: ApiError;
}

// Anything not listed is a bug in the core, so it is logged here, where it is last seen.
export function toErrorReply(error: unknown): ErrorReply {
  if (error instanceof RequestError) {
    return { status: error.status, body: { error: error.code, message: error.message } };
  }
  if (error instanceof ZodError) {
    return { status: 400, body: { error: "invalid_request", message: z.prettifyError(error) } };
  }
  const known = knownErrors.find(([type]) => error instanceof type);
  if (known !== undefined && error instanceof Error) {
    const [, status, code] = known;
    return { status, body: { error: code, message: error.message } };
  }
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, body: { error: "internal", message } };
}
