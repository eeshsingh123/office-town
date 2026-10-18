import type { Audience, UserRequestEvent } from "@office-town/contract";
import { type ReactNode, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { detailOf, useAnswer } from "../requests/answer.ts";
import requests from "../requests/RequestCard.module.css";
import styles from "./Connectors.module.css";
import { signIn } from "./connectors.ts";

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

// The departments of the agent that asked, or the agent itself, for the connect sheet.
function useAsker(sessionId: string): Audience | undefined {
  const agent = useApp((state) => {
    const agentId = state.sessions[sessionId]?.agentId;
    return agentId === undefined ? undefined : state.agents[agentId];
  });
  if (agent === undefined) return undefined;
  return agent.departmentId === undefined
    ? { everyone: false, departmentIds: [], agentIds: [agent.id] }
    : { everyone: false, departmentIds: [agent.departmentId], agentIds: [] };
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
  const asker = useAsker(event.sessionId);
  // A Claude app's own ask names it as Claude Code does, such as "claude.ai Notion".
  const connector = useApp((state) =>
    Object.values(state.connectors).find(
      ({ setup }) => setup.slug === tool?.server || setup.app === tool?.server,
    ),
  );
  const fields =
    input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const mail = text(fields.to) !== undefined && text(fields.subject) !== undefined;
  const detail = detailOf(input);
  const answer = (optionId: string) =>
    run(() => api.command(event.sessionId, { type: "answerPermission", requestId, optionId }));
  const buttonFor = (optionId: string, label: string) => {
    // Signing in and connecting happen in Claude's page and the connect sheet, not here.
    if (optionId === "sign-in") {
      // Not held as sending: the user may close the page and press it again.
      return () =>
        connector === undefined
          ? undefined
          : signIn(connector.id).catch((failure: unknown) => showToast(String(failure)));
    }
    if (optionId === "connect") {
      return () =>
        navigate({
          name: "connectors",
          connect: text(fields.app) ?? label,
          ...(asker === undefined ? {} : { audience: asker }),
        });
    }
    return () => answer(optionId);
  };
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
            onClick={() => void buttonFor(option.optionId, option.label)()}
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
