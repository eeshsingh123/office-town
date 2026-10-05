import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleMinus,
  FileText,
  Globe,
  Lightbulb,
  LoaderCircle,
  type LucideIcon,
  MoveRight,
  Pencil,
  Search,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { describeActions } from "../../trace/blocks.ts";
import type { TraceAction, TraceItem, TraceMessage, TraceRequest } from "../../trace/trace.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { byteSize, elapsed } from "../../ui/format.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { RequestCard } from "../requests/RequestCard.tsx";
import { requestSummary } from "../requests/summary.ts";
import { useMemberLinks } from "./members.ts";
import styles from "./Trace.module.css";

const KIND_ICONS: Record<TraceAction["actionKind"], LucideIcon> = {
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  move: MoveRight,
  search: Search,
  execute: SquareTerminal,
  fetch: Globe,
  think: Lightbulb,
  delegate: Bot,
  other: Wrench,
};
const INPUT_PREVIEW = 2000;

// Where in the trace an item sits: its session, and whether that session can still act.
export interface Place {
  sessionId: string;
  // An action left running in a session that is no longer open was interrupted.
  live: boolean;
}

function useItem(sessionId: string, id: string): TraceItem | undefined {
  return useApp((state) => state.traces[sessionId]?.items.get(id));
}

function useStreaming(sessionId: string, key: string): string | undefined {
  return useApp((state) => state.traces[sessionId]?.streaming[key]);
}

export function Streaming({ place, parent = "" }: { place: Place; parent?: string }) {
  const text = useStreaming(place.sessionId, parent);
  if (text === undefined) return null;
  return (
    <div className={styles.text} aria-live="polite">
      <Markdown text={text} />
      <span className={styles.caret} aria-hidden />
    </div>
  );
}

function ActionStatus({ action, live }: { action: TraceAction; live: boolean }) {
  if (action.status === "completed")
    return <Check size={14} className={styles.ok} aria-label="Done" />;
  if (action.status === "failed") return <X size={14} className={styles.bad} aria-label="Failed" />;
  if (!live) return <CircleMinus size={14} className={styles.quiet} aria-label="Interrupted" />;
  return <LoaderCircle size={14} className={`${styles.running} spin`} aria-label="Running" />;
}

function preview(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  const text = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  if (text === "{}" || text === "") return undefined;
  return text.length > INPUT_PREVIEW ? `${text.slice(0, INPUT_PREVIEW)}…` : text;
}

// A long output keeps only its end while it grows; a long result keeps a preview here, and the
// rest is read from the core on request (D-30).
function OverflowNote({ action, onReadFull }: { action: TraceAction; onReadFull: () => void }) {
  const { overflow } = action;
  if (overflow === undefined) return null;
  const size = byteSize(overflow.bytes);
  if (action.resultSequence === undefined) {
    return <span className={styles.meta}>Showing the end of {size} of output.</span>;
  }
  return (
    <button type="button" className={styles.link} onClick={onReadFull}>
      {overflow.truncated
        ? `Show the part of ${size} that was kept`
        : `Show the full result (${size})`}
    </button>
  );
}

function ActionDetail({ action, sessionId }: { action: TraceAction; sessionId: string }) {
  const [full, setFull] = useState<string>();
  const [error, setError] = useState<string>();
  const input = preview(action.input);
  const shown = full ?? action.result ?? action.output;
  const { resultSequence } = action;
  const readFull = async () => {
    if (resultSequence === undefined) return;
    try {
      setFull(await api.readResult(sessionId, resultSequence));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <div className={styles.detail}>
      {input === undefined ? null : (
        <>
          <span className={styles.detailLabel}>Input</span>
          <pre className={styles.code}>{input}</pre>
        </>
      )}
      {shown === undefined || shown === "" ? null : (
        <>
          <span className={styles.detailLabel}>
            {action.result === undefined ? "Output so far" : "Result"}
          </span>
          <pre className={styles.code}>{shown}</pre>
        </>
      )}
      {full === undefined ? <OverflowNote action={action} onReadFull={readFull} /> : null}
      {error === undefined ? null : <span className={styles.error}>{error}</span>}
    </div>
  );
}

const ActionRow = memo(function ActionRow({
  action,
  place,
}: {
  action: TraceAction;
  place: Place;
}) {
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICONS[action.actionKind];
  return (
    <div>
      <button
        type="button"
        className={styles.row}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon size={14} aria-hidden />
        <span className={styles.rowTitle}>{action.title}</span>
        {action.endedAt === undefined ? null : (
          <span className={styles.meta}>{elapsed(action.startedAt, action.endedAt)}</span>
        )}
        <ActionStatus action={action} live={place.live} />
      </button>
      {action.actionKind === "delegate" ? (
        <div className={styles.under}>
          <WorkerLink input={action.input} />
        </div>
      ) : null}
      {open ? <ActionDetail action={action} sessionId={place.sessionId} /> : null}
      {action.children.length === 0 && action.requestIds.length === 0 ? null : (
        <div className={styles.nest}>
          {action.children.map((id) => (
            <ItemView key={id} id={id} place={place} />
          ))}
          <Streaming place={place} parent={action.id} />
          {action.requestIds.map((id) => (
            <ItemView key={id} id={id} place={place} />
          ))}
        </div>
      )}
    </div>
  );
});

function resolutionText(request: TraceRequest): string | undefined {
  const { resolution, event } = request;
  if (resolution === undefined) return undefined;
  if (event.type === "proposal.requested") {
    if (!("outcome" in resolution)) return undefined;
    return PROPOSAL_OUTCOMES[resolution.outcome as keyof typeof PROPOSAL_OUTCOMES] ?? "Answered";
  }
  if (event.type === "permission.requested") {
    const option = event.payload.options.find(
      (candidate) => "optionId" in resolution && candidate.optionId === resolution.optionId,
    );
    if (resolution.outcome === "allowed") {
      const by = "answeredBy" in resolution ? resolution.answeredBy : undefined;
      if (typeof by === "object") return `Allowed by autonomy · ${AUTONOMY[by.autonomy].label}`;
      return `Allowed by you${option ? ` · ${option.label}` : ""}`;
    }
    return resolution.outcome === "denied" ? "Denied" : "Cancelled";
  }
  if (resolution.outcome !== "answered" || !("answers" in resolution)) return "Not answered";
  return `Answered: ${(resolution.answers ?? []).flatMap((answer) => answer.selected).join(", ")}`;
}

const PROPOSAL_OUTCOMES = {
  approved: "Approved",
  revised: "Sent back with a note",
  declined: "Declined",
  cancelled: "Not answered",
};

// A request still waiting is the card to answer it; once answered it shrinks to one line.
function RequestLine({ request, live }: { request: TraceRequest; live: boolean }) {
  const resolved = resolutionText(request);
  if (resolved === undefined && live) return <RequestCard event={request.event} />;
  return (
    <div className={styles.request} id={request.id}>
      <span className={styles.rowTitle}>{requestSummary(request.event)}</span>
      <span>{resolved ?? "Not answered"}</span>
    </div>
  );
}

// A delegation opens the worker's trace, in a team's view.
function WorkerLink({ input }: { input: unknown }) {
  const show = useMemberLinks();
  const name = (input as { agent?: unknown } | null)?.agent;
  const worker = useApp((state) =>
    Object.values(state.agents).find((agent) => agent.name === name),
  );
  if (show === undefined || worker === undefined) return null;
  return (
    <button type="button" className={styles.link} onClick={() => show(worker.id)}>
      Open {worker.name}'s trace
    </button>
  );
}

// A worker's brief opens its lead's trace, in a team's view.
function LeadLink({ agentId }: { agentId: string }) {
  const show = useMemberLinks();
  const lead = useApp((state) => state.agents[agentId]);
  if (show === undefined || lead === undefined) return null;
  return (
    <button type="button" className={styles.link} onClick={() => show(lead.id)}>
      Open {lead.name}'s trace
    </button>
  );
}

// A worker's result, as the lead got it from Office Town.
function Result({ item }: { item: TraceMessage }) {
  const show = useMemberLinks();
  const origin = item.origin?.kind === "result" ? item.origin : undefined;
  const worker = useApp((state) =>
    origin === undefined ? undefined : state.agents[origin.agentId],
  );
  if (origin === undefined) return null;
  const how =
    origin.outcome === "done"
      ? "finished"
      : origin.outcome === "stopped"
        ? "was stopped"
        : "could not finish";
  return (
    <div className={styles.fromOffice}>
      {worker === undefined ? null : <Avatar name={worker.name} colour={worker.colour} size={22} />}
      <div className={styles.fromOfficeBody}>
        <div className={styles.fromOfficeHead}>
          {show === undefined || worker === undefined ? (
            <strong>{worker?.name ?? "A worker"}</strong>
          ) : (
            <button type="button" className={styles.link} onClick={() => show(worker.id)}>
              {worker.name}
            </button>
          )}{" "}
          {how}
          <span className={styles.meta}> · sent to the lead by Office Town</span>
        </div>
        {/* The head already says who finished; the text's first line says so for the lead. */}
        <Markdown text={origin.outcome === "done" ? item.text.replace(/^.*\n/, "") : item.text} />
      </div>
    </div>
  );
}

// What Office Town told the agent, such as its brief: one line, opened on request.
function FromOffice({ summary, text }: { summary: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.group}>
      <button
        type="button"
        className={styles.row}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span className={`${styles.rowTitle} ${styles.summary}`}>{summary}</span>
        <span className={styles.meta}>from Office Town</span>
      </button>
      {open ? (
        <div className={styles.text}>
          <Markdown text={text} />
        </div>
      ) : null}
    </div>
  );
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.group}>
      <button
        type="button"
        className={styles.row}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Lightbulb size={14} aria-hidden />
        <span className={`${styles.rowTitle} ${styles.summary}`}>Thought</span>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
      </button>
      {open ? (
        <div className={styles.text}>
          <Markdown text={text} />
        </div>
      ) : null}
    </div>
  );
}

export const ItemView = memo(function ItemView({ id, place }: { id: string; place: Place }) {
  const item = useItem(place.sessionId, id);
  switch (item?.kind) {
    case undefined:
      return null;
    case "action":
      return <ActionRow action={item} place={place} />;
    case "request":
      return <RequestLine request={item} live={place.live} />;
    case "reasoning":
      return <Reasoning text={item.text} />;
    case "notice":
      return (
        <div className={`${styles.notice} ${item.tone === "error" ? styles.error : ""}`}>
          <CircleAlert size={14} aria-hidden />
          <span>
            {item.text}
            {item.detail === undefined ? null : ` · ${item.detail}`}
          </span>
        </div>
      );
    case "message":
      if (item.origin?.kind === "brief") {
        const { from, summary } = item.origin;
        return (
          <>
            <FromOffice summary={`Brief · ${summary}`} text={item.text} />
            {from === undefined ? null : <LeadLink agentId={from} />}
          </>
        );
      }
      if (item.origin?.kind === "result") return <Result item={item} />;
      if (item.origin?.kind === "notice") {
        return <FromOffice summary={item.origin.summary} text={item.text} />;
      }
      if (item.origin?.kind === "answer") {
        return <FromOffice summary="Your answer, passed on to the agent" text={item.text} />;
      }
      if (item.role === "user") {
        return (
          <div className={styles.user}>
            <span className={styles.you} aria-hidden>
              Y
            </span>
            <div className={styles.userBubble}>{item.text}</div>
          </div>
        );
      }
      return (
        <div className={styles.text}>
          <Markdown text={item.text} />
        </div>
      );
  }
});

interface ActionGroupProps {
  ids: string[];
  place: Place;
}

// A run of actions folds into one line once it is done; while it runs, every action shows.
export function ActionGroup({ ids, place }: ActionGroupProps) {
  const actions = useApp(
    useShallow((state) =>
      ids.flatMap((id) => {
        const item = state.traces[place.sessionId]?.items.get(id);
        return item?.kind === "action" ? [item] : [];
      }),
    ),
  );
  const done = actions.every((action) => action.status !== "running");
  const [open, setOpen] = useState<boolean>();
  if (actions.length === 1) {
    const [only] = actions;
    return (
      <div className={styles.group}>{only ? <ActionRow action={only} place={place} /> : null}</div>
    );
  }
  const expanded = open ?? !done;
  const first = actions[0];
  const last = actions.at(-1);
  return (
    <div className={styles.group}>
      <button
        type="button"
        className={styles.row}
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
      >
        {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span className={`${styles.rowTitle} ${styles.summary}`}>{describeActions(actions)}</span>
        {done && first !== undefined && last?.endedAt !== undefined ? (
          <span className={styles.meta}>{elapsed(first.startedAt, last.endedAt)}</span>
        ) : null}
      </button>
      {expanded ? (
        <div className={styles.nest}>
          {actions.map((action) => (
            <ActionRow key={action.id} action={action} place={place} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
