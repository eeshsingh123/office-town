import type {
  AnswerPermissionsRequest,
  AnswerPermissionsResult,
  PermissionOption,
} from "@office-town/contract";
import type { Store } from "../store/store.ts";
import { AnswerError, SessionNotRunningError, type SessionRegistry } from "./session-registry.ts";

const PREFERRED: Record<AnswerPermissionsRequest["decision"], PermissionOption["kind"][]> = {
  allow: ["allow_once", "allow_always"],
  reject: ["reject_once", "reject_always"],
};

// One answer per waiting approval, in order; what cannot be answered any more is counted, not thrown.
export async function answerPermissions(
  registry: SessionRegistry,
  store: Store,
  { decision, requests }: AnswerPermissionsRequest,
): Promise<AnswerPermissionsResult> {
  const waiting = new Map(
    store
      .listPendingRequests()
      .requests.flatMap(({ event }) =>
        event.type === "permission.requested"
          ? [[`${event.sessionId}:${event.payload.requestId}`, event.payload.options] as const]
          : [],
      ),
  );
  let answered = 0;
  for (const { sessionId, requestId } of requests) {
    const options = waiting.get(`${sessionId}:${requestId}`) ?? [];
    const option = PREFERRED[decision]
      .map((kind) => options.find((each) => each.kind === kind))
      .find((each) => each !== undefined);
    if (option === undefined) continue;
    try {
      await registry.send(sessionId, {
        type: "answerPermission",
        requestId,
        optionId: option.optionId,
      });
      answered += 1;
    } catch (error) {
      if (!(error instanceof SessionNotRunningError || error instanceof AnswerError)) throw error;
    }
  }
  return { answered, skipped: requests.length - answered };
}
