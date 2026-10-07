import type { SessionRecord, UserRequestEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { nextWaiting, waitingOrder } from "../src/features/office/next-waiting.ts";
import type { WaitingRequest } from "../src/store/records.ts";

const session = (id: string, agentId: string) =>
  ({ id, agentId, taskId: "t1", status: "running" }) as SessionRecord;

const request = (sessionId: string, position: number): WaitingRequest => ({
  position,
  event: { sessionId, payload: { requestId: `r${position}` } } as UserRequestEvent,
});

describe("next waiting", () => {
  it("goes through the waiting agents oldest request first, and starts over after the last", () => {
    const sessions = {
      s1: session("s1", "kai"),
      s2: session("s2", "ben"),
      s3: session("s3", "gus"),
    };
    const waiting = {
      a: request("s2", 7),
      b: request("s1", 9),
      c: request("s3", 3),
      d: request("s2", 12),
    };
    const order = waitingOrder(waiting, sessions);
    expect(order).toEqual(["gus", "ben", "kai"]);
    expect(nextWaiting(order, undefined)).toBe("gus");
    expect(nextWaiting(order, "ben")).toBe("kai");
    expect(nextWaiting(order, "kai")).toBe("gus");
    expect(nextWaiting(order, "answered-already")).toBe("gus");
  });
});
