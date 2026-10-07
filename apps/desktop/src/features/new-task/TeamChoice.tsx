import type { Autonomy, DepartmentRecord, WorkspaceRecord } from "@office-town/contract";
import { Plus } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { taskTitle } from "../../ui/format.ts";
import styles from "./NewTaskView.module.css";

// No department yet: the lead proposes one.
export const PROPOSE = "~propose";
const LEVELS: Autonomy[] = ["supervised", "trusted", "full", "bypass"];

interface TeamChoiceProps {
  departmentId: string;
  onDepartment: (departmentId: string) => void;
  workspaces: WorkspaceRecord[];
  workspaceId: string | undefined;
  onWorkspace: (workspaceId: string) => void;
  onNewWorkspace: () => void;
  autonomy: Autonomy;
  onAutonomy: (autonomy: Autonomy) => void;
}

// A department works on one goal at a time.
function useBusy(): Map<string, string> {
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const busy = new Map<string, string>();
  for (const { task, sessionIds } of Object.values(tasks)) {
    const working = sessionIds.some((id) => {
      const session = sessions[id];
      return session !== undefined && isOpen(session);
    });
    if (task.departmentId !== undefined && working) busy.set(task.departmentId, task.prompt);
  }
  return busy;
}

function DepartmentOption({
  department,
  busyWith,
  members,
  workspace,
}: {
  department: DepartmentRecord;
  busyWith: string | undefined;
  members: number;
  workspace: WorkspaceRecord | undefined;
}) {
  return (
    <span>
      <span className={styles.choiceName}>{department.name}</span>
      <br />
      <span className={styles.hint}>
        {busyWith === undefined
          ? `${members} ${members === 1 ? "member" : "members"} · ${AUTONOMY[department.autonomy].label}${workspace === undefined ? "" : ` · ${workspace.name}`}`
          : `At work on ${taskTitle(busyWith)}`}
      </span>
    </span>
  );
}

export function TeamChoice(props: TeamChoiceProps) {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const busy = useBusy();
  const proposing = props.departmentId === PROPOSE;
  const sorted = Object.values(departments).toSorted((a, b) => a.name.localeCompare(b.name));
  const workspace = props.workspaces.find((known) => known.id === props.workspaceId);

  return (
    <>
      <fieldset className={styles.where}>
        <legend className={styles.heading}>Department</legend>
        <div className={styles.choices}>
          <label className={styles.choice}>
            <input
              type="radio"
              name="department"
              checked={proposing}
              onChange={() => props.onDepartment(PROPOSE)}
            />
            <span>
              <span className={styles.choiceName}>Let the lead propose a team</span>
              <br />
              <span className={styles.hint}>
                The lead reads the goal and the workspace, then proposes roles with a harness and
                model for each. You edit and approve before anyone starts.
              </span>
            </span>
          </label>
          {sorted.map((department) => (
            <label key={department.id} className={styles.choice}>
              <input
                type="radio"
                name="department"
                checked={props.departmentId === department.id}
                disabled={busy.has(department.id)}
                onChange={() => props.onDepartment(department.id)}
              />
              <DepartmentOption
                department={department}
                busyWith={busy.get(department.id)}
                members={
                  Object.values(agents).filter((agent) => agent.departmentId === department.id)
                    .length
                }
                workspace={props.workspaces.find((known) => known.id === department.workspaceId)}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {proposing ? (
        <>
          <div className={styles.where}>
            <h2 className={styles.heading}>Workspace</h2>
            <div className={styles.workspace}>
              {props.workspaces.length > 0 ? (
                <ChoiceMenu
                  label="Workspace"
                  value={workspace?.id ?? ""}
                  choices={props.workspaces.map((known) => ({
                    value: known.id,
                    label: known.name,
                    description: known.folders.join(" · "),
                  }))}
                  onChange={props.onWorkspace}
                />
              ) : (
                <span className={styles.hint}>A team needs a saved workspace to share.</span>
              )}
              <Button variant="ghost" onClick={props.onNewWorkspace}>
                <Plus size={14} aria-hidden />
                New workspace
              </Button>
            </div>
          </div>
          <div className={styles.where}>
            <h2 className={styles.heading}>Autonomy</h2>
            <ToggleGroup.Root
              type="single"
              className={styles.segments}
              value={props.autonomy}
              onValueChange={(next) => {
                const level = LEVELS.find((known) => known === next);
                if (level !== undefined) props.onAutonomy(level);
              }}
              aria-label="Autonomy"
            >
              {LEVELS.map((level) => (
                <ToggleGroup.Item key={level} value={level} className={styles.segment}>
                  {AUTONOMY[level].label}
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
            <p className={styles.hint}>{AUTONOMY[props.autonomy].description}</p>
          </div>
        </>
      ) : null}
    </>
  );
}
