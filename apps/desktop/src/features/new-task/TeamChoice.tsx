import type { Autonomy, WorkspaceRecord } from "@office-town/contract";
import { Plus } from "lucide-react";
import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { AutonomyChoice } from "../../ui/AutonomyChoice.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { OptionRows } from "../../ui/Choice.tsx";
import { taskTitle } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { ProjectPicker } from "./PlaceChoice.tsx";

// No department yet: the lead proposes one.
export const PROPOSE = "~propose";

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

export function teamLine(members: number): string {
  if (members <= 0) return "A lead working alone";
  return `A lead and ${members} ${members === 1 ? "person" : "people"}`;
}

export function TeamChoice(props: TeamChoiceProps) {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const busy = useBusy();
  const proposing = props.departmentId === PROPOSE;
  const sorted = Object.values(departments).toSorted((a, b) => a.name.localeCompare(b.name));
  // The lead is one of the department's agents.
  const workers = (departmentId: string) =>
    Object.values(agents).filter((agent) => agent.departmentId === departmentId).length - 1;

  return (
    <>
      <section className={page.section}>
        <div className={page.sectionHead}>
          <h2 className={page.sectionTitle}>Which department?</h2>
          <Button variant="ghost" onClick={() => navigate({ name: "new-department" })}>
            <Plus size={14} aria-hidden />
            Build a department
          </Button>
        </div>
        <OptionRows
          name="department"
          label="Which department"
          value={props.departmentId}
          options={[
            ...sorted.map((department) => {
              const busyWith = busy.get(department.id);
              const workspace = props.workspaces.find(
                (known) => known.id === department.workspaceId,
              );
              return {
                value: department.id,
                title: department.name,
                disabled: busyWith !== undefined,
                description:
                  busyWith === undefined
                    ? [
                        teamLine(workers(department.id)),
                        workspace?.name,
                        AUTONOMY[department.autonomy].label,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : `Busy with "${taskTitle(busyWith)}". It takes one goal at a time.`,
              };
            }),
            {
              value: PROPOSE,
              title: "A new team for this goal",
              description:
                "A lead reads the goal and suggests who to bring in. You approve the team before anyone starts.",
            },
          ]}
          onChange={props.onDepartment}
        />
      </section>

      {proposing ? (
        <>
          <section className={page.section}>
            <h2 className={page.sectionTitle}>Which project does the team work in?</h2>
            <ProjectPicker
              workspaces={props.workspaces}
              workspaceId={props.workspaceId}
              onWorkspace={props.onWorkspace}
              onNewWorkspace={props.onNewWorkspace}
            />
          </section>
          <section className={page.section}>
            <h2 className={page.sectionTitle}>How much can the team do without asking you?</h2>
            <AutonomyChoice name="team-level" value={props.autonomy} onChoose={props.onAutonomy} />
          </section>
        </>
      ) : null}
    </>
  );
}
