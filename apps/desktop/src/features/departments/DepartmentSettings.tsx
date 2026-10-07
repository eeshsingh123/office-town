import {
  type AgentRecord,
  type Autonomy,
  autonomySchema,
  type DepartmentRecord,
  type TeamRole,
} from "@office-town/contract";
import { ArrowLeft } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import { profileSummary } from "../../ui/format.ts";
import { useLoaded } from "../../ui/use-loaded.ts";
import styles from "./DepartmentSettings.module.css";
import { type TeamRow, TeamRows, toRoles, toRows } from "./TeamRows.tsx";

// Kept by its agent, with its profile or its own settings.
function roleOf(agent: AgentRecord): TeamRole {
  const { harness, environment, model, effort } = agent.settings;
  return {
    role: agent.role ?? "Worker",
    purpose: agent.purpose ?? "",
    agentId: agent.id,
    ...(agent.profileId === undefined
      ? {
          settings: {
            harness,
            environment,
            ...(model === undefined ? {} : { model }),
            ...(effort === undefined ? {} : { effort }),
          },
        }
      : { profileId: agent.profileId }),
  };
}

function Settings({ department }: { department: DepartmentRecord }) {
  const agents = useApp((state) => state.agents);
  const harnesses = useApp((state) => state.harnesses);
  const workspaces = useLoaded("workspaces", api.listWorkspaces);
  const workspace = workspaces.value?.find((known) => known.id === department.workspaceId);
  const lead = agents[department.leadAgentId];
  const [name, setName] = useState(department.name);
  const [autonomy, setAutonomy] = useState<Autonomy>(department.autonomy);
  const [branchPerWorker, setBranchPerWorker] = useState(department.branchPerWorker);
  const [codeFlow, setCodeFlow] = useState(department.codeFlow);
  const [rows, setRows] = useState<TeamRow[]>(() =>
    toRows(
      Object.values(agents)
        .filter((agent) => agent.departmentId === department.id && agent.id !== lead?.id)
        .map(roleOf),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string }>();
  const gate = useBypassGate(autonomy, setAutonomy, department.name);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    try {
      const settings = { name: name.trim(), autonomy, branchPerWorker, codeFlow };
      await api.updateDepartment(department.id, settings);
      await api.changeTeam(department.id, { name: settings.name, roles: toRoles(rows) });
      setMessage({
        error: false,
        text: "Saved. A level changed while agents work applies to their next request.",
      });
    } catch (failure) {
      setMessage({
        error: true,
        text: failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={save}>
      <div className={styles.pair}>
        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input
            className={styles.input}
            value={name}
            onChange={(change) => setName(change.target.value)}
          />
        </label>
        <div className={styles.field}>
          <span className={styles.label}>
            Workspace{workspace === undefined ? "" : ` · ${workspace.name}`}
          </span>
          <span className={styles.path}>{workspace?.folders.join(" · ") ?? ""}</span>
        </div>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>Autonomy</legend>
        {autonomySchema.options.map((level) => (
          <label key={level} className={styles.choice}>
            <input
              type="radio"
              name="autonomy"
              checked={autonomy === level}
              onChange={() => gate.choose(level)}
            />
            <span>
              <strong>{AUTONOMY[level].label}</strong>
              <br />
              <span className={styles.hint}>{AUTONOMY[level].description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>Code</legend>
        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={branchPerWorker}
            onChange={(change) => setBranchPerWorker(change.target.checked)}
          />
          <span>
            <strong>One branch per worker</strong>
            <br />
            <span className={styles.hint}>
              When the workspace is a git repository, each worker gets its own worktree and branch;
              the lead merges them.
            </span>
          </span>
        </label>
        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={codeFlow}
            onChange={(change) => setCodeFlow(change.target.checked)}
          />
          <span>
            <strong>Commit, push and open pull requests</strong>
            <br />
            <span className={styles.hint}>
              Uses your own git and GitHub CLI logins. Pushing and pull requests follow the autonomy
              level.
            </span>
          </span>
        </label>
      </fieldset>

      <div className={styles.field}>
        <span className={styles.label}>Team</span>
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
                  summary: profileSummary(lead, harnesses),
                }
          }
          departmentId={department.id}
          defaults={{ harness: harnesses[0]?.harness ?? "claude", environment: { kind: "native" } }}
        />
        <span className={styles.hint}>The lead hears of each change while it is at work.</span>
      </div>

      {message === undefined ? null : (
        <p
          className={message.error ? styles.error : styles.hint}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          disabled={saving || name.trim() === "" || rows.some((row) => row.role.trim() === "")}
        >
          Save
        </Button>
      </div>
      {gate.confirm}
    </form>
  );
}

export function DepartmentSettings({ departmentId }: { departmentId: string }) {
  const department = useApp((state) => state.departments[departmentId]);
  return (
    <section className={styles.page} aria-labelledby="department-title">
      <div className={styles.column}>
        <Button variant="ghost" onClick={() => navigate({ name: "office", room: departmentId })}>
          <ArrowLeft size={14} aria-hidden />
          Office
        </Button>
        <h1 id="department-title" className={styles.title}>
          {department === undefined ? "Department" : `${department.name} · Settings`}
        </h1>
        {department === undefined ? (
          <p className={styles.hint}>This department no longer exists.</p>
        ) : (
          <Settings key={department.id} department={department} />
        )}
      </div>
    </section>
  );
}
