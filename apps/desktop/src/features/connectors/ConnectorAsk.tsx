import { type AppAudience, appAskSchema, type UserRequestEvent } from "@office-town/contract";
import { type ReactNode, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { detailOf, useAnswer } from "../requests/answer.ts";
import requests from "../requests/RequestCard.module.css";
import styles from "./Connectors.module.css";
import { refreshApps, setUpThrough } from "./connectors.ts";
import { ProviderTags } from "./ProviderTags.tsx";

type PermissionEvent = Extract<UserRequestEvent, { type: "permission.requested" }>;

// Set on the asks the core makes for connectors (D-67).
export const appAskOf = (event: UserRequestEvent) =>
  event.type === "permission.requested" ? event.payload.tool : undefined;

export function appAskLabel(tool: { name: string }): string {
  if (tool.name === "request") return "Wants an app";
  return "Asks your approval";
}

const text = (value: unknown) =>
  typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : undefined;

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

// A mail-like call shows who it goes to and its subject; its body only when asked for.
function Mail({ input }: { input: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const body = text(input.body) ?? text(input.text) ?? text(input.content);
  return (
    <>
      <dl className={styles.mail}>
        <dt>To</dt>
        <dd>{text(input.to)}</dd>
        <dt>Subject</dt>
        <dd>{text(input.subject)}</dd>
      </dl>
      {open && body !== undefined ? <pre className={requests.code}>{body}</pre> : null}
      {body === undefined ? null : (
        <Button variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide email" : "Show email"}
        </Button>
      )}
    </>
  );
}

// An agent's ask for an app: who gets it (its department by default), and the one action that
// sets it up, never a terminal (D-96).
function AppAskBody({ event, context }: { event: PermissionEvent; context: ReactNode }) {
  const { sending, error, run } = useAnswer();
  const { requestId, title, options } = event.payload;
  const ask = appAskSchema.parse(event.payload.input);
  const agent = useApp((state) => {
    const agentId = state.sessions[event.sessionId]?.agentId;
    return agentId === undefined ? undefined : state.agents[agentId];
  });
  const department = useApp((state) =>
    ask.departmentId === undefined ? undefined : state.departments[ask.departmentId],
  );
  const [audience, setAudience] = useState<AppAudience>(ask.suggested ?? "department");
  const [waiting, setWaiting] = useState(false);
  const choices: { value: AppAudience; label: string }[] = [
    ...(department === undefined
      ? []
      : [{ value: "department" as const, label: `${department.name} (department)` }]),
    { value: "agent", label: `Just ${agent?.name ?? "this agent"}` },
    { value: "everyone", label: "Everyone" },
  ];
  const answer = (optionId: string) =>
    run(() => api.command(event.sessionId, { type: "answerPermission", requestId, optionId }));
  const give = options.some(({ optionId }) => optionId.startsWith("give:"));
  const connect = options.find(({ optionId }) => optionId === "connect");
  const setUp = () => {
    const { provider } = ask;
    if (provider === undefined) {
      navigate({
        name: "connectors",
        connect: ask.app,
        audience: {
          everyone: audience === "everyone",
          departmentIds:
            audience === "department" && ask.departmentId !== undefined ? [ask.departmentId] : [],
          agentIds: audience === "agent" && agent !== undefined ? [agent.id] : [],
        },
      });
      return;
    }
    // Not held as sending: the user may close the page and press it again.
    setWaiting(true);
    setUpThrough(provider, ask.app, { requestId, audience }).catch((failure: unknown) => {
      setWaiting(false);
      showToast(errorText(failure));
    });
  };
  return (
    <div className={requests.body}>
      {context}
      <strong>{title}</strong>
      {ask.provider === undefined ? null : <ProviderTags tags={[ask.provider]} named />}
      <label className={styles.giveTo}>
        Give it to
        <select
          value={audience}
          onChange={(change) => setAudience(change.target.value as AppAudience)}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        {/* Without a department, Just the agent is the default, not a suggestion. */}
        {ask.suggested !== undefined &&
        ask.suggested !== "department" &&
        !(ask.suggested === "agent" && ask.departmentId === undefined) &&
        ask.suggested === audience
          ? ` · ${agent?.name ?? "The agent"} suggested this`
          : null}
      </label>
      {waiting ? <p className={styles.hint}>Waiting for the sign-in in your browser…</p> : null}
      <div className={requests.buttons}>
        {give ? (
          <Button
            variant="primary"
            disabled={sending}
            onClick={() => void answer(`give:${audience}`)}
          >
            Give access
          </Button>
        ) : null}
        {connect === undefined ? null : waiting ? (
          <Button variant="primary" onClick={refreshApps}>
            Check again
          </Button>
        ) : (
          <Button variant="primary" disabled={sending} onClick={setUp}>
            {connect.label}
          </Button>
        )}
        <Button variant="ghost" disabled={sending} onClick={() => void answer("decline")}>
          Decline
        </Button>
      </div>
      {error === undefined ? null : (
        <p className={requests.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ConnectorAskBody({
  event,
  context,
}: {
  event: PermissionEvent;
  context: ReactNode;
}) {
  const { sending, error, run } = useAnswer();
  const { requestId, title, input, options, tool } = event.payload;
  if (tool?.name === "request" && appAskSchema.safeParse(input).data?.suggested !== undefined) {
    return <AppAskBody event={event} context={context} />;
  }
  const fields =
    input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const mail = text(fields.to) !== undefined && text(fields.subject) !== undefined;
  const detail = detailOf(input);
  const answer = (optionId: string) =>
    run(() => api.command(event.sessionId, { type: "answerPermission", requestId, optionId }));
  return (
    <div className={requests.body}>
      {context}
      <strong>{title}</strong>
      {tool?.name === "request" ? null : mail ? (
        <Mail input={fields} />
      ) : detail === undefined || detail === "{}" ? null : (
        <pre className={requests.code}>{detail}</pre>
      )}
      <div className={requests.buttons}>
        {options.map((option) => (
          <Button
            key={option.optionId}
            variant={option.kind.startsWith("allow") ? "primary" : "ghost"}
            disabled={sending}
            onClick={() => void answer(option.optionId)}
          >
            {mail && option.optionId === "approve" ? "Send" : option.label}
          </Button>
        ))}
      </div>
      {error === undefined ? null : (
        <p className={requests.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
