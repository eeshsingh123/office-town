import {
  type Autonomy,
  autonomySchema,
  type NewAgent,
  type WorkspaceRecord,
} from "@office-town/contract";
import { ArrowLeft, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { profileSummary } from "../../ui/format.ts";
import { useLoaded } from "../../ui/use-loaded.ts";
import { WorkspaceDialog } from "../new-task/WorkspaceDialog.tsx";
import { selectRoom } from "../office/office-state.ts";
import { type ChipSettings, SettingsChips } from "../profiles/SettingsChips.tsx";
import styles from "./DepartmentSettings.module.css";
import { type TeamRow, TeamRows, toRoles } from "./TeamRows.tsx";

// No profile id can take this, since an id starts with a letter or digit.
const OWN_SETTINGS = "~own";

// A department built by hand, the same record a lead's approved proposal makes.
export function NewDepartmentView() {
  const harnesses = useApp((state) => state.harnesses);
  const listed = useLoaded("workspaces", api.listWorkspaces);
  const profiles = useLoaded("profiles", api.listProfiles);
  const [created, setCreated] = useState<WorkspaceRecord[]>([]);
  const workspaces = [...created, ...(listed.value ?? [])];
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [autonomy, setAutonomy] = useState<Autonomy>("supervised");
  const [leadProfile, setLeadProfile] = useState(OWN_SETTINGS);
  const defaults: ChipSettings = {
    harness: harnesses[0]?.harness ?? "claude",
    environment: { kind: "native" },
  };
  const [leadSettings, setLeadSettings] = useState<ChipSettings>();
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const gate = useBypassGate(autonomy, setAutonomy, name.trim() || "the department");

  const workspace = workspaces.find((known) => known.id === (workspaceId ?? workspaces[0]?.id));
  const ready =
    name.trim() !== "" && workspace !== undefined && rows.every((row) => row.role.trim() !== "");

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError(undefined);
    const lead: NewAgent =
      leadProfile === OWN_SETTINGS
        ? { settings: leadSettings ?? defaults }
        : { profileId: leadProfile };
    try {
      const department = await api.createDepartment({
        team: { name: name.trim(), roles: toRoles(rows) },
        workspaceId: workspace.id,
        autonomy,
        lead,
      });
      selectRoom(department.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  return (
    <section className={styles.page} aria-labelledby="new-department-title">
      <div className={styles.column}>
        <Button variant="ghost" onClick={() => navigate({ name: "home" })}>
          <ArrowLeft size={14} aria-hidden />
          Home
        </Button>
        <h1 id="new-department-title" className={styles.title}>
          New department
        </h1>
        <form className={styles.form} onSubmit={create}>
          <div className={styles.pair}>
            <label className={styles.field}>
              <span className={styles.label}>Name</span>
              <input
                className={styles.input}
                value={name}
                onChange={(change) => setName(change.target.value)}
                placeholder="For example: Backend"
                // biome-ignore lint/a11y/noAutofocus: the view exists to take this text
                autoFocus
              />
            </label>
            <div className={styles.field}>
              <span className={styles.label}>Workspace · where the team works</span>
              <div className={styles.row}>
                {workspaces.length > 0 ? (
                  <ChoiceMenu
                    label="Workspace"
                    value={workspace?.id ?? ""}
                    choices={workspaces.map((known) => ({
                      value: known.id,
                      label: known.name,
                      description: known.folders.join(" · "),
                    }))}
                    onChange={setWorkspaceId}
                  />
                ) : null}
                <Button variant="ghost" onClick={() => setCreatingWorkspace(true)}>
                  <Plus size={14} aria-hidden />
                  New workspace
                </Button>
              </div>
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Lead · takes each goal and hands out the work</span>
            <div className={styles.row}>
              {(profiles.value ?? []).length === 0 ? null : (
                <ChoiceMenu
                  label="Lead"
                  value={leadProfile}
                  choices={[
                    { value: OWN_SETTINGS, label: "Choose a harness and model" },
                    ...(profiles.value ?? []).map((known) => ({
                      value: known.id,
                      label: known.name,
                      description: profileSummary(known, harnesses),
                    })),
                  ]}
                  onChange={setLeadProfile}
                />
              )}
              {leadProfile === OWN_SETTINGS ? (
                <SettingsChips value={leadSettings ?? defaults} onChange={setLeadSettings} />
              ) : null}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Workers · optional, the lead can work alone</span>
            <TeamRows
              rows={rows}
              onChange={setRows}
              lead={undefined}
              departmentId={undefined}
              defaults={defaults}
            />
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

          {error === undefined ? null : (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={!ready || saving}>
              {saving ? "Creating…" : "Create department"}
            </Button>
            <span className={styles.hint}>
              It opens on the office floor, ready for a goal from Home or New task.
            </span>
          </div>
        </form>
      </div>
      {gate.confirm}
      <WorkspaceDialog
        open={creatingWorkspace}
        onOpenChange={setCreatingWorkspace}
        onCreated={(added) => {
          setCreated([added, ...created]);
          setWorkspaceId(added.id);
        }}
      />
    </section>
  );
}
