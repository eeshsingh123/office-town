import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import type { Agent } from "../../store/agents.ts";
import { navigate, useApp, useHarnessName } from "../../store/app-store.ts";
import { useDraft } from "../../store/drafts.ts";
import { track } from "../../store/live.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import { WorkspacePicker } from "../workspaces/WorkspacePicker.tsx";
import { isBusy } from "./AgentCard.tsx";
import styles from "./GroupTaskDialog.module.css";

interface PickProps {
  agent: Agent;
  lead: boolean;
  busy: boolean;
  onPick: () => void;
}

function Pick({ agent, lead, busy, onPick }: PickProps) {
  const harness = useHarnessName(agent.record.settings.harness);
  const role = busy ? "Busy" : lead ? "Lead" : undefined;
  return (
    <button
      type="button"
      className={`${styles.pick} ${lead ? styles.lead : ""}`}
      aria-pressed={lead}
      disabled={busy}
      onClick={onPick}
    >
      <Avatar name={agent.name} colour={agent.colour} size={24} />
      <span className={styles.pickText}>
        <strong>{agent.name}</strong>
        <span>{role === undefined ? harness : `${role} · ${harness}`}</span>
      </span>
    </button>
  );
}

interface GroupTaskDialogProps {
  // The chief and reviewers are left out by the caller.
  members: Agent[];
  onOpenChange: (open: boolean) => void;
}

// One task for agents picked on the floor: one leads, the free others work under it (D-63).
export function GroupTaskDialog({ members, onOpenChange }: GroupTaskDialogProps) {
  const departments = useApp((state) => state.departments);
  const free = members.filter((agent) => !isBusy(agent));
  const [leadId, setLeadId] = useState(free[0]?.id);
  const lead = free.find((agent) => agent.id === leadId);
  const workers = free.filter((agent) => agent.id !== leadId);
  // Where the lead works already: its department's workspace, or its last task's.
  const leadWorkspace = (agent: Agent | undefined) =>
    (agent?.record.departmentId === undefined
      ? undefined
      : departments[agent.record.departmentId]?.workspaceId) ?? agent?.task.workspaceId;
  const [workspaceId, setWorkspaceId] = useState(() => leadWorkspace(lead));
  const [goal, setGoal] = useDraft("group-task", "");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const ready =
    lead !== undefined && workers.length > 0 && workspaceId !== undefined && goal.trim() !== "";

  const pickLead = (agent: Agent) => {
    setLeadId(agent.id);
    setWorkspaceId((current) => leadWorkspace(agent) ?? current);
  };
  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (lead === undefined || workspaceId === undefined || !ready || starting) return;
    setStarting(true);
    setError(undefined);
    try {
      const session = await api.startTeamTask({
        goal: goal.trim(),
        team: {
          leadAgentId: lead.id,
          workerAgentIds: workers.map((agent) => agent.id),
          workspaceId,
        },
      });
      await track(session.taskId);
      setGoal("");
      onOpenChange(false);
      navigate({ name: "task", taskId: session.taskId });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStarting(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={`${dialog.content} ${styles.dialog}`}>
          <form className={dialog.form} onSubmit={start}>
            <Dialog.Title className={dialog.title}>New task for {free.length} agents</Dialog.Title>
            <Dialog.Description className={dialog.description}>
              Pick who leads. The lead plans and hands parts to the others.
            </Dialog.Description>
            <div className={styles.picks}>
              {members.map((agent) => (
                <Pick
                  key={agent.id}
                  agent={agent}
                  lead={agent.id === leadId}
                  busy={isBusy(agent)}
                  onPick={() => pickLead(agent)}
                />
              ))}
            </div>
            {workers.length === 0 ? (
              <p className={dialog.error}>Pick at least two agents that are free.</p>
            ) : null}
            <label className={dialog.label}>
              Task
              <textarea
                className={styles.goal}
                value={goal}
                placeholder="Describe the task"
                onChange={(event) => setGoal(event.target.value)}
              />
            </label>
            <WorkspacePicker value={workspaceId} onChange={setWorkspaceId} />
            {error === undefined ? null : (
              <p className={dialog.error} role="alert">
                {error}
              </p>
            )}
            <div className={dialog.actions}>
              <Dialog.Close asChild>
                <Button variant="ghost" onClick={() => setGoal("")}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={!ready || starting}>
                {starting ? "Starting…" : "Start task"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
