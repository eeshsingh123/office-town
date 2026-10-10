import { FolderOpen, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { shell } from "../../shell.ts";
import { agentsInTask, stateOf, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { useWorkspaces, useWorkspaceUsage } from "../../store/workspaces.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import { ago, taskTitle } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import { KIND_LABEL, WorkspaceIcon } from "./WorkspaceParts.tsx";
import { WorkspaceSheet } from "./WorkspaceSheet.tsx";
import styles from "./Workspaces.module.css";
import { WorkspaceMenu } from "./WorkspacesView.tsx";

const TASK_STATE: Record<string, string> = {
  queued: "Waiting its turn",
  working: "In progress",
  waiting: "Needs you",
  idle: "Paused",
  ended: "Done",
};

// Agents with an open session in one of this workspace's tasks, read from the live records.
function useWorkingHere(workspaceId: string) {
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const traces = useApp((state) => state.traces);
  const asking = useWaitingSessions();
  return useMemo(() => {
    return Object.values(tasks)
      .filter((entry) => entry.task.workspaceId === workspaceId)
      .flatMap((entry) => agentsInTask({ agents, tasks, sessions }, entry.task.id))
      .filter((agent) => isOpen(agent.latest))
      .map((agent) => ({ agent, state: stateOf(agent, traces, asking.has(agent.latest.id)) }));
  }, [agents, tasks, sessions, traces, asking, workspaceId]);
}

export function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const workspaces = useWorkspaces();
  const usage = useWorkspaceUsage()?.[workspaceId];
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const working = useWorkingHere(workspaceId);
  const [editing, setEditing] = useState(false);
  const workspace = workspaces?.find((known) => known.id === workspaceId);
  if (workspace === undefined) {
    return (
      <section className={page.page}>
        <p className={form.hint}>
          {workspaces === undefined ? "Loading…" : "This workspace is no longer on the list."}
        </p>
      </section>
    );
  }
  const used = (usage?.departmentIds ?? []).flatMap((id) => departments[id] ?? []);
  const main = workspace.folders[0]?.path ?? "";
  const missing = new Set(usage?.missingFolders ?? []);

  return (
    <section className={page.page} aria-labelledby="workspace-title">
      <div className={styles.page}>
        <button
          type="button"
          className={page.back}
          onClick={() => navigate({ name: "workspaces" })}
        >
          Workspaces / {workspace.name}
        </button>
        <header className={styles.head}>
          <div className={page.header}>
            <h1 id="workspace-title" className={`${page.title} ${styles.titleRow}`}>
              <WorkspaceIcon kind={workspace.kind} />
              {workspace.name}
            </h1>
            <p className={styles.facts}>
              <span>{KIND_LABEL[workspace.kind]}</span>
              {usage?.branch === undefined ? null : (
                <span>
                  Git branch <b>{usage.branch}</b>
                </span>
              )}
              <span>
                <b>{usage?.taskCount ?? 0}</b> task{usage?.taskCount === 1 ? "" : "s"}
              </span>
              <span>Last used {ago(workspace.usedAt)}</span>
            </p>
          </div>
          <span className={styles.actions}>
            {shell === undefined ? null : (
              <Button onClick={() => void shell?.openFolder(main)}>
                <FolderOpen size={14} aria-hidden />
                Open folder
              </Button>
            )}
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <WorkspaceMenu workspace={workspace} usage={usage} onEdit={() => setEditing(true)} />
          </span>
        </header>

        {used.length > 1 ? (
          <p className={styles.banner}>
            <TriangleAlert size={16} aria-hidden />
            <span>
              <b>{used.map((department) => department.name).join(" and ")}</b> all edit this
              workspace. Their agents can change the same files at the same time. Give one of them
              its own workspace if that is a problem.
            </span>
          </p>
        ) : null}

        <div className={styles.cols}>
          <div className={styles.col}>
            <section className={styles.block}>
              <h2 className={page.eyebrow}>Working here now</h2>
              {working.length === 0 ? (
                <p className={form.hint}>No one is working here now.</p>
              ) : (
                <ul className={styles.list}>
                  {working.map(({ agent, state }) => (
                    <li key={`${agent.taskId}/${agent.id}`}>
                      <button
                        type="button"
                        className={styles.row}
                        onClick={() => navigate({ name: "task", taskId: agent.taskId })}
                      >
                        <Avatar name={agent.name} colour={agent.colour} size={26} />
                        <span className={styles.optionText}>
                          <strong>
                            {agent.name}
                            {agent.record.role === undefined ? "" : ` · ${agent.record.role}`}
                          </strong>
                          <span className={styles.path}>{taskTitle(agent.task.prompt)}</span>
                        </span>
                        <span className={styles.state}>
                          <StatusIcon state={state} />
                          {STATE_LABELS[state]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.block}>
              <h2 className={page.eyebrow}>Recent tasks</h2>
              {(usage?.recentTasks.length ?? 0) === 0 ? (
                <p className={form.hint}>No tasks here yet.</p>
              ) : (
                <ul className={styles.list}>
                  {usage?.recentTasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        className={styles.row}
                        onClick={() => navigate({ name: "task", taskId: task.id })}
                      >
                        <span className={styles.optionText}>
                          <strong>{taskTitle(task.prompt)}</strong>
                          <span className={form.hint}>
                            {[
                              task.departmentId === undefined
                                ? "One assistant"
                                : departments[task.departmentId]?.name,
                              ago(task.createdAt),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className={styles.pill}>
                          {task.state === "ended" && task.reviewedAt === undefined
                            ? "To review"
                            : TASK_STATE[task.state]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className={styles.col}>
            <section className={styles.block}>
              <h2 className={page.eyebrow}>Folders</h2>
              <ul className={styles.list}>
                {workspace.folders.map((folder, index) => (
                  <li key={folder.path} className={styles.row}>
                    <span className={styles.optionText}>
                      <span className={styles.path} title={folder.path}>
                        {folder.path}
                      </span>
                      <span className={form.hint}>
                        {index > 0
                          ? "Extra folder"
                          : workspace.kind === "scratch"
                            ? "Each task gets a new folder in here"
                            : "Main folder · agents start here"}
                        {missing.has(folder.path) ? " · not found" : ""}
                      </span>
                    </span>
                    <span className={folder.access === "edit" ? styles.pillEdit : styles.pill}>
                      {folder.access === "edit" ? "Can edit" : "Read only"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.block}>
              <h2 className={page.eyebrow}>Used by</h2>
              {used.length === 0 ? (
                <p className={form.hint}>
                  No department. {workspace.kind === "scratch" ? "Solo tasks start here." : ""}
                </p>
              ) : (
                <ul className={styles.list}>
                  {used.map((department) => (
                    <li key={department.id}>
                      <button
                        type="button"
                        className={styles.row}
                        onClick={() =>
                          navigate({ name: "department", departmentId: department.id })
                        }
                      >
                        <strong>{department.name}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {(usage?.worktrees.length ?? 0) === 0 ? null : (
              <section className={styles.block}>
                <h2 className={page.eyebrow}>Agents' own copies</h2>
                <ul className={styles.list}>
                  {usage?.worktrees.map((copy) => (
                    <li key={`${copy.taskId}/${copy.agentId}`} className={styles.row}>
                      <span className={styles.optionText}>
                        <span className={styles.path}>{copy.branch ?? "Own copy"}</span>
                        <span className={form.hint}>
                          {agents[copy.agentId]?.name ?? "A worker"} · merged by its lead
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
      {editing ? <WorkspaceSheet workspace={workspace} open onOpenChange={setEditing} /> : null}
    </section>
  );
}
