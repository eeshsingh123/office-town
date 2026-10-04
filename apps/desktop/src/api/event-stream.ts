import { type SessionEvent, sessionEventSchema } from "@office-town/contract";

// A text fragment is never stored, so it has no position.
export interface StreamedEvent {
  position?: number;
  event: SessionEvent;
}

export type StreamStatus = "connecting" | "live" | "offline";

const RETRY_MS = [500, 1000, 2000, 5000];

// One event this app cannot read must not stall the whole stream behind it.
function readEvent(data: string): SessionEvent | undefined {
  try {
    return sessionEventSchema.parse(JSON.parse(data));
  } catch (error) {
    console.error("Skipped an event the app cannot read.", error);
    return undefined;
  }
}

// Splits server-sent event text into frames. What follows the last complete frame is returned as
// `rest`, to be read again with the next chunk.
export function parseFrames(text: string): { frames: StreamedEvent[]; rest: string } {
  const blocks = text.split("\n\n");
  const rest = blocks.pop() ?? "";
  const frames = blocks.flatMap((block): StreamedEvent[] => {
    let position: number | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("id: ")) position = Number(line.slice(4));
      else if (line.startsWith("data: ")) data.push(line.slice(6));
    }
    const event = data.length === 0 ? undefined : readEvent(data.join("\n"));
    if (event === undefined) return [];
    return [position === undefined ? { event } : { position, event }];
  });
  return { frames, rest };
}

interface ReadOptions {
  signal?: AbortSignal;
  onOpen?: () => void;
}

async function readStream(
  path: string,
  onEvent: (streamed: StreamedEvent) => void,
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
    for (const frame of frames) onEvent(frame);
  }
}

// Every stored event of one session so far; the stream ends once it has caught up.
export async function replaySession(sessionId: string): Promise<StreamedEvent[]> {
  const events: StreamedEvent[] = [];
  await readStream(`/events?session=${encodeURIComponent(sessionId)}&follow=false`, (event) =>
    events.push(event),
  );
  return events;
}

export interface FollowOptions {
  after: number;
  onEvent: (streamed: StreamedEvent) => void;
  onStatus: (status: StreamStatus) => void;
}

// The one live stream of the app (D-32). After a drop it reconnects from the last stored position
// it saw, so nothing is missed or repeated. Returns a function that closes it.
export function followEvents({ after, onEvent, onStatus }: FollowOptions): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  let position = after;
  const receive = (streamed: StreamedEvent) => {
    if (streamed.position !== undefined) position = streamed.position;
    onEvent(streamed);
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
