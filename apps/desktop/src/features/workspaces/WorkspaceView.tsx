import { ChevronRight, FolderOpen, GitBranch, TriangleAlert } from "lucide-react";
import { Tabs } from "radix-ui";
import { type ReactNode, useState } from "react";
import { shell } from "../../shell.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { useWorkingNow, useWorkspaces, useWorkspaceUsage } from "../../store/workspaces.ts";
import { liveStateOf } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { Crumbs } from "../../ui/Crumbs.tsx";
import form from "../../ui/Form.module.css";
import { ago, taskName } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import tabs from "../../ui/PageTabs.module.css";
import { StateTag } from "../../ui/StatusIcon.tsx";
import { peopleLine } from "../departments/team-line.ts";
import { LibraryTab } from "../library/LibraryTab.tsx";
import { useLibrary } from "../library/library.ts";
import { TaskStatusOf } from "../tasks/TaskStatusIcon.tsx";
import { showWorkspaceTasks } from "../tasks/TasksView.tsx";
import { KIND_LABEL, WorkspaceIcon, WrappingPath } from "./WorkspaceParts.tsx";
import { WorkspaceSheet } from "./WorkspaceSheet.tsx";
import styles from "./Workspaces.module.css";
import { WorkspaceMenu } from "./WorkspacesView.tsx";

// One part of the overview: a title with its count, then one bordered list.
function Block({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.block} aria-label={title}>
      <div className={styles.blockHead}>
        <h2 className={styles.blockTitle}>
          {title}
          <span className={styles.blockCount}>{count}</span>
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function WorkspaceView({
  workspaceId,
  tab = "overview",
}: {
  workspaceId: string;
  tab?: "overview" | "library";
}) {
  const workspaces = useWorkspaces();
  const libraryCount = useLibrary(workspaceId).length;
  const usage = useWorkspaceUsage()?.[workspaceId];
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const working = useWorkingNow()[workspaceId] ?? [];
  const [editing, setEditing] = useState(false);
  const workspace = workspaces?.find((known) => known.id === workspaceId);
  if (workspace === undefined) {
    return (
      <section className={page.page}>
        <p className={form.hint}>
          {workspaces === undefined ? "" : "This workspace is no longer on the list."}
        </p>
      </section>
    );
  }
  const used = (usage?.departmentIds ?? []).flatMap((id) => departments[id] ?? []);
  const main = workspace.folders[0]?.path ?? "";
  const missing = new Set(usage?.missingFolders ?? []);
  const peopleIn = (departmentId: string) =>
    Object.values(agents).filter((agent) => agent.departmentId === departmentId).length;

  return (
    <section className={page.page} aria-labelledby="workspace-title">
      <div className={styles.page}>
        <Crumbs
          items={[{ label: "Workspaces", view: { name: "workspaces" } }, { label: workspace.name }]}
        />
        <header className={styles.head}>
          <div className={styles.identity}>
            <WorkspaceIcon kind={workspace.kind} />
            <div className={styles.identityText}>
              <h1 id="workspace-title" className={page.title}>
                {workspace.name}
              </h1>
              <dl className={styles.facts}>
                <div>
                  <dt>Kind</dt>
                  <dd>{KIND_LABEL[workspace.kind]}</dd>
                </div>
                {usage?.branch === undefined ? null : (
                  <div>
                    <dt>Git branch</dt>
                    <dd className={styles.branch}>
                      <GitBranch size={13} aria-hidden />
                      <span className={styles.branchName}>{usage.branch}</span>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Tasks</dt>
                  <dd>{usage?.taskCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Last used</dt>
                  <dd>{ago(workspace.usedAt)}</dd>
                </div>
              </dl>
            </div>
          </div>
          <span className={styles.actions}>
            {shell === undefined ? null : (
              <Button onClick={() => void shell?.openFolder(main)}>
                <FolderOpen size={14} aria-hidden />
                Open folder
              </Button>
            )}
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <WorkspaceMenu workspace={workspace} usage={usage} />
          </span>
        </header>

        <Tabs.Root
          value={tab}
          onValueChange={(next) =>
            navigate({
              name: "workspace",
              workspaceId,
              ...(next === "library" ? { tab: "library" as const } : {}),
            })
          }
        >
          <Tabs.List className={tabs.tabs} aria-label="Show">
            <Tabs.Trigger value="overview" className={tabs.tab}>
              Overview
            </Tabs.Trigger>
            <Tabs.Trigger value="library" className={tabs.tab}>
              Library
              {libraryCount > 0 ? <span className={tabs.count}>{libraryCount}</span> : null}
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="library" className={tabs.panel}>
            <LibraryTab workspaceId={workspaceId} />
          </Tabs.Content>
          <Tabs.Content value="overview" className={tabs.panel}>
            {used.length > 1 ? (
              <p className={styles.banner}>
                <TriangleAlert size={16} aria-hidden />
                <span>
                  <b>{used.map((department) => department.name).join(" and ")}</b>{" "}
                  {used.length === 2 ? "both" : "all"} edit this workspace.
                </span>
              </p>
            ) : null}

            <div className={styles.cols}>
              <div className={styles.col}>
                <Block title="Working here now" count={working.length}>
                  {working.length === 0 ? (
                    <p className={styles.emptyRow}>No one is working here.</p>
                  ) : (
                    <ul className={styles.list}>
                      {working.map(({ agent, state }) => (
                        <li key={`${agent.taskId}/${agent.id}`}>
                          <button
                            type="button"
                            className={styles.row}
                            onClick={() => navigate({ name: "task", taskId: agent.taskId })}
                          >
                            <Avatar name={agent.name} colour={agent.colour} size={28} />
                            <span className={styles.optionText}>
                              <strong className={styles.clip}>
                                {agent.record.role ?? agent.name}
                              </strong>
                              <span className={styles.sub}>{taskName(agent.task)}</span>
                            </span>
                            <StateTag state={liveStateOf(state)} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Block>

                <Block
                  title="Recent tasks"
                  count={usage?.taskCount ?? 0}
                  action={
                    (usage?.taskCount ?? 0) > (usage?.recentTasks.length ?? 0) ? (
                      <button
                        type="button"
                        className={styles.blockLink}
                        onClick={() => showWorkspaceTasks(workspaceId)}
                      >
                        All {usage?.taskCount} tasks
                      </button>
                    ) : undefined
                  }
                >
                  {(usage?.recentTasks.length ?? 0) === 0 ? (
                    <p className={styles.emptyRow}>No tasks here yet.</p>
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
                              <strong className={styles.clip}>{taskName(task)}</strong>
                              <span className={styles.sub}>
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
                            <TaskStatusOf taskId={task.id} task={task} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Block>
              </div>

              <div className={styles.col}>
                <Block title="Folders" count={workspace.folders.length}>
                  <ul className={styles.list}>
                    {workspace.folders.map((folder, index) => (
                      <li key={folder.path} className={`${styles.row} ${styles.rowTop}`}>
                        <span className={styles.optionText}>
                          <WrappingPath path={folder.path} className={styles.fullPath} />
                          <span className={missing.has(folder.path) ? styles.warnText : styles.sub}>
                            {index > 0
                              ? "Extra folder"
                              : workspace.kind === "scratch"
                                ? "New task folders go here"
                                : "Main folder"}
                            {missing.has(folder.path) ? " · not found" : ""}
                          </span>
                        </span>
                        <span className={folder.access === "edit" ? styles.pillEdit : styles.pill}>
                          {folder.access === "edit" ? "Can edit" : "Read only"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Block>

                <Block title="Used by" count={used.length}>
                  {used.length === 0 ? (
                    <p className={styles.emptyRow}>
                      {workspace.kind === "scratch" ? "Solo tasks start here." : "No department."}
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
                            <Avatar
                              name={department.name}
                              colour={agents[department.leadAgentId]?.colour ?? "#4F5D75"}
                              size={28}
                            />
                            <span className={styles.optionText}>
                              <strong className={styles.clip}>{department.name}</strong>
                              <span className={styles.sub}>
                                {peopleLine(peopleIn(department.id))}
                              </span>
                            </span>
                            <ChevronRight size={16} aria-hidden className={styles.rowEnd} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Block>

                {(usage?.worktrees.length ?? 0) === 0 ? null : (
                  <Block title="Branches" count={usage?.worktrees.length ?? 0}>
                    <ul className={styles.list}>
                      {usage?.worktrees.map((copy) => (
                        <li key={`${copy.taskId}/${copy.agentId}`} className={styles.row}>
                          <span className={styles.optionText}>
                            <span className={styles.fullPath}>{copy.branch ?? "Own copy"}</span>
                            <span className={styles.sub}>
                              {agents[copy.agentId]?.name ?? "A worker"}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Block>
                )}
              </div>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>
      {editing ? <WorkspaceSheet workspace={workspace} open onOpenChange={setEditing} /> : null}
    </section>
  );
}
