import type { Team, TeamRole, UserRequestEvent } from "@office-town/contract";
import { CircleUser, Lock, Plus, Users, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type ReactNode, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { useSessionAgent } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { refreshTeams } from "../../store/live.ts";
import { requestKey } from "../../trace/trace.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { profileSummary } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import { useLoaded } from "../../ui/use-loaded.ts";
import { type ChipSettings, SettingsChips } from "../profiles/SettingsChips.tsx";
import styles from "./ProposalCard.module.css";
import card from "./RequestCard.module.css";

type ProposalEvent = Extract<UserRequestEvent, { type: "proposal.requested" }>;

interface Row extends TeamRole {
  key: number;
}

function useMinutesSince(timestamp: string): number {
  const [now] = useState(Date.now);
  return Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60_000));
}

// A row's own fields, without the key the list keeps it by.
function roleOf({ key: _, ...role }: Row): TeamRole {
  return role;
}

// The lead's team for the user to edit: a row per worker, each with a harness, a model and an
// effort; a worker the team already has keeps its name. The lead's own row cannot change.
export function ProposalCard({ event, context }: { event: ProposalEvent; context?: ReactNode }) {
  const { requestId, team, reason, place, departmentId } = event.payload;
  const lead = useSessionAgent(event.sessionId);
  const agents = useApp((state) => state.agents);
  const harnesses = useApp((state) => state.harnesses);
  const profiles = useLoaded("profiles", api.listProfiles);
  const minutes = useMinutesSince(event.timestamp);
  const [name, setName] = useState(team.name);
  const [rows, setRows] = useState<Row[]>(() =>
    team.roles.map((role, index) => ({ ...role, key: index })),
  );
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const changing = departmentId !== undefined;
  const leadSettings = lead?.latest.options;

  const leaving = useMemo(() => {
    const kept = new Set(rows.flatMap((row) => row.agentId ?? []));
    return Object.values(agents).filter(
      (agent) =>
        agent.departmentId === departmentId &&
        departmentId !== undefined &&
        agent.id !== lead?.id &&
        !kept.has(agent.id),
    );
  }, [agents, rows, departmentId, lead?.id]);

  const update = (key: number, change: Partial<TeamRole>) =>
    setRows(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const nextKey = () => Math.max(-1, ...rows.map((row) => row.key)) + 1;
  const addRole = () => {
    const settings: ChipSettings = {
      harness: leadSettings?.harness ?? harnesses[0]?.harness ?? "claude",
      environment: leadSettings?.environment ?? { kind: "native" },
    };
    setRows([...rows, { key: nextKey(), role: "", purpose: "", settings }]);
  };
  const answer = async (decision: Parameters<typeof api.command>[1]) => {
    setSending(true);
    setError(undefined);
    try {
      await api.command(event.sessionId, decision);
      await refreshTeams();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSending(false);
    }
  };
  const approved: Team = { name: name.trim(), roles: rows.map(roleOf) };
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

        <ul className={styles.roles} aria-label="Team">
          {lead === undefined ? null : (
            <li className={styles.role}>
              <div className={styles.who}>
                <Avatar name={lead.name} colour={lead.colour} size={26} />
                <span>
                  <strong>Lead</strong>
                  <span className={styles.hint}>{lead.name}</span>
                </span>
              </div>
              <span className={styles.hint}>Plans, hands out the work, and puts it together</span>
              <span className={styles.locked}>
                {leadSettings === undefined
                  ? null
                  : profileSummary({ settings: leadSettings }, harnesses)}
                <Lock size={13} aria-label="The lead is fixed" />
              </span>
            </li>
          )}
          {rows.map((row) => {
            const member = row.agentId === undefined ? undefined : agents[row.agentId];
            const profile = profiles.value?.find((known) => known.id === row.profileId);
            return (
              <li key={row.key} className={styles.role}>
                <div className={styles.texts}>
                  <input
                    className={styles.input}
                    aria-label="Role"
                    placeholder="Role"
                    value={row.role}
                    onChange={(change) => update(row.key, { role: change.target.value })}
                  />
                  <input
                    className={styles.input}
                    aria-label="What it does"
                    placeholder="What it does"
                    value={row.purpose}
                    onChange={(change) => update(row.key, { purpose: change.target.value })}
                  />
                  {member === undefined ? null : (
                    <span className={styles.hint}>Keeps {member.name}</span>
                  )}
                </div>
                <div className={styles.chips}>
                  {row.settings === undefined ? (
                    <span className={styles.hint}>
                      From the profile {profile?.name ?? ""}
                      {profile === undefined ? "" : ` · ${profileSummary(profile, harnesses)}`}
                    </span>
                  ) : (
                    <SettingsChips
                      value={row.settings}
                      onChange={(settings) => update(row.key, { settings })}
                    />
                  )}
                </div>
                <Button
                  variant="ghost"
                  icon
                  aria-label={`Remove ${row.role || "this role"}`}
                  onClick={() => setRows(rows.filter((other) => other.key !== row.key))}
                >
                  <X size={14} aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
        {leaving.length === 0 ? null : (
          <p className={styles.hint}>
            Leaves the team: {leaving.map((agent) => agent.name).join(", ")}
          </p>
        )}
        <div className={styles.add}>
          <Button onClick={addRole}>
            <Plus size={14} aria-hidden />
            Add a role
          </Button>
          {(profiles.value ?? []).length === 0 ? null : (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button>
                  <CircleUser size={14} aria-hidden />
                  Add from a profile
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className={menu.surface} align="start" sideOffset={4}>
                  {(profiles.value ?? []).map((profile) => (
                    <DropdownMenu.Item
                      key={profile.id}
                      className={menu.item}
                      onSelect={() =>
                        setRows([
                          ...rows,
                          {
                            key: nextKey(),
                            role: profile.name,
                            purpose: profile.role,
                            profileId: profile.id,
                          },
                        ])
                      }
                    >
                      <span className={menu.itemText}>
                        {profile.name}
                        <span className={menu.itemDescription}>
                          {profileSummary(profile, harnesses)}
                        </span>
                      </span>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          <span className={styles.hint}>
            Models come from the harnesses installed on this computer.
          </span>
        </div>

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
              onClick={() => void api.stop(event.sessionId)}
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
