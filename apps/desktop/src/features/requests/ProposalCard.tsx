import type { Team, UserRequestEvent } from "@office-town/contract";
import { Users } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "../../api/client.ts";
import { useSessionAgent } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { requestKey } from "../../trace/trace.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { profileSummary } from "../../ui/format.ts";
import { type TeamRow, TeamRows, toRoles, toRows } from "../departments/TeamRows.tsx";
import styles from "./ProposalCard.module.css";
import card from "./RequestCard.module.css";
import { useMinutesSince } from "./RequestCard.tsx";

type ProposalEvent = Extract<UserRequestEvent, { type: "proposal.requested" }>;

// A worker the team already has keeps its name. The lead's own row cannot change.
export function ProposalCard({ event, context }: { event: ProposalEvent; context?: ReactNode }) {
  const { requestId, team, reason, place, departmentId } = event.payload;
  const lead = useSessionAgent(event.sessionId);
  const harnesses = useApp((state) => state.harnesses);
  const minutes = useMinutesSince(event.timestamp);
  const [name, setName] = useState(team.name);
  const [rows, setRows] = useState<TeamRow[]>(() => toRows(team.roles));
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const changing = departmentId !== undefined;

  // The approved department, its members and the task joining it arrive as changes.
  const run = async (action: () => Promise<void>) => {
    setSending(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSending(false);
    }
  };
  const answer = (decision: Parameters<typeof api.command>[1]) =>
    run(() => api.command(event.sessionId, decision));
  const approved: Team = { name: name.trim(), roles: toRoles(rows) };
  const complete = approved.name !== "" && rows.every((row) => row.role.trim() !== "");

  return (
    <article id={requestKey(requestId)} className={card.card} aria-label="Team proposal">
      <div className={card.head}>
        <Users size={16} aria-hidden />
        {changing ? "The lead wants to change the team" : "Team proposal"}
        <span className={card.since}>{minutes === 0 ? "just now" : `waiting ${minutes} min`}</span>
      </div>
      <div className={card.body}>
        {context}
        {reason === undefined ? null : <p className={styles.reason}>"{reason}"</p>}
        <div className={styles.place}>
          <label className={styles.field}>
            <span className={styles.label}>Department name</span>
            <input
              className={styles.input}
              value={name}
              onChange={(change) => setName(change.target.value)}
            />
          </label>
          <div className={styles.field}>
            <span className={styles.label}>Workspace · {place.workspaceName}</span>
            <span className={styles.path}>{place.folders.join(" · ")}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Autonomy</span>
            <span>{AUTONOMY[place.autonomy].label}</span>
          </div>
        </div>

        <TeamRows
          rows={rows}
          onChange={setRows}
          lead={
            lead === undefined
              ? undefined
              : {
                  id: lead.id,
                  name: lead.name,
                  colour: lead.colour,
                  summary: profileSummary({ settings: lead.latest.options }, harnesses),
                }
          }
          departmentId={departmentId}
          defaults={{
            harness: lead?.latest.options.harness ?? harnesses[0]?.harness ?? "claude",
            environment: lead?.latest.options.environment ?? { kind: "native" },
          }}
        />

        <label className={styles.field}>
          <span className={styles.label}>Note for the lead (optional)</span>
          <textarea
            className={styles.input}
            rows={2}
            value={note}
            placeholder="For example: one worker for layout and copy is enough, it is a small site"
            onChange={(change) => setNote(change.target.value)}
          />
        </label>
        <div className={card.buttons}>
          <Button
            variant="primary"
            disabled={!complete || sending}
            onClick={() =>
              answer({
                type: "answerProposal",
                requestId,
                answer: { outcome: "approved", team: approved },
              })
            }
          >
            {changing ? "Approve the change" : "Approve team"}
          </Button>
          <Button
            disabled={note.trim() === "" || sending}
            onClick={() =>
              answer({
                type: "answerProposal",
                requestId,
                answer: { outcome: "revised", note: note.trim() },
              })
            }
          >
            Send back with my note
          </Button>
          {changing ? (
            <Button
              variant="ghost"
              disabled={sending}
              onClick={() =>
                answer({
                  type: "answerProposal",
                  requestId,
                  answer: {
                    outcome: "declined",
                    ...(note.trim() === "" ? {} : { note: note.trim() }),
                  },
                })
              }
            >
              Decline
            </Button>
          ) : (
            <Button
              variant="ghost"
              disabled={sending}
              onClick={() => void run(() => api.stop(event.sessionId))}
            >
              Stop the task
            </Button>
          )}
        </div>
        {error === undefined ? null : (
          <p className={card.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
