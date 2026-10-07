import {
  type Change,
  changeSchema,
  type SessionEvent,
  sessionEventSchema,
} from "@office-town/contract";

export interface StreamedEvent {
  position?: number;
  event: SessionEvent;
}

// Sent live only, on the stream of every session.
export type StreamFrame = StreamedEvent | { change: Change };

export type StreamStatus = "connecting" | "live" | "offline";

const RETRY_MS = [500, 1000, 2000, 5000];

// One frame this app cannot read must not stall the whole stream behind it.
function readFrame(name: string | undefined, data: string): StreamFrame | undefined {
  try {
    const json = JSON.parse(data);
    return name === "change"
      ? { change: changeSchema.parse(json) }
      : { event: sessionEventSchema.parse(json) };
  } catch (error) {
    console.error("Skipped a frame the app cannot read.", error);
    return undefined;
  }
}

// The text after the last complete frame comes back as `rest`, to read again with the next chunk.
export function parseFrames(text: string): { frames: StreamFrame[]; rest: string } {
  const blocks = text.split("\n\n");
  const rest = blocks.pop() ?? "";
  const frames = blocks.flatMap((block): StreamFrame[] => {
    let position: number | undefined;
    let name: string | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("id: ")) position = Number(line.slice(4));
      else if (line.startsWith("event: ")) name = line.slice(7);
      else if (line.startsWith("data: ")) data.push(line.slice(6));
    }
    const frame = data.length === 0 ? undefined : readFrame(name, data.join("\n"));
    if (frame === undefined) return [];
    return [position === undefined || "change" in frame ? frame : { ...frame, position }];
  });
  return { frames, rest };
}

interface ReadOptions {
  signal?: AbortSignal;
  onOpen?: () => void;
}

async function readStream(
  path: string,
  onFrame: (frame: StreamFrame) => void,
  { signal, onOpen }: ReadOptions = {},
): Promise<void> {
  const response = await fetch(`/api${path}`, signal === undefined ? {} : { signal });
  if (!response.ok || response.body === null) {
    throw new Error(`The event stream answered ${response.status}.`);
  }
  onOpen?.();
  let buffer = "";
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    const { frames, rest } = parseFrames(buffer + chunk);
    buffer = rest;
    for (const frame of frames) onFrame(frame);
  }
}

export async function replaySession(sessionId: string): Promise<StreamedEvent[]> {
  const events: StreamedEvent[] = [];
  await readStream(`/events?session=${encodeURIComponent(sessionId)}&follow=false`, (frame) => {
    if ("event" in frame) events.push(frame);
  });
  return events;
}

export interface FollowOptions {
  after: number;
  onEvent: (streamed: StreamedEvent) => void;
  onChange: (change: Change) => void;
  onStatus: (status: StreamStatus) => void;
}

// Reconnects from the last stored position it saw; changes made meanwhile are read again by the caller.
export function followEvents({ after, onEvent, onChange, onStatus }: FollowOptions): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  let position = after;
  const receive = (frame: StreamFrame) => {
    if ("change" in frame) {
      onChange(frame.change);
      return;
    }
    if (frame.position !== undefined) position = frame.position;
    onEvent(frame);
  };

  const connect = async (): Promise<void> => {
    let attempt = 0;
    while (!signal.aborted) {
      const onOpen = () => {
        attempt = 0;
        onStatus("live");
      };
      try {
        await readStream(`/events?after=${position}`, receive, { signal, onOpen });
      } catch (error) {
        if (signal.aborted) return;
        console.warn("The event stream dropped; reconnecting.", error);
      }
      onStatus("offline");
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS[attempt] ?? 5000));
      attempt += 1;
    }
  };
  onStatus("connecting");
  void connect();
  return () => controller.abort();
}
