import type { Autonomy } from "@office-town/contract";
import { api } from "../../api/client.ts";
import { type Agent, useLevel } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { settingsOf } from "../departments/team-form.ts";
import { AskChip } from "../new-task/AskChip.tsx";

// The one place a task shows its level. It is saved on the department, or on an agent with none,
// and the core reads it at each request, so agents at work take it at once.
export function PermissionChip({ agent }: { agent: Agent }) {
  const { record, latest } = agent;
  const department = useApp((state) =>
    record.departmentId === undefined ? undefined : state.departments[record.departmentId],
  );
  const level = useLevel(record);
  const saved = department?.autonomy ?? record.autonomy ?? "supervised";
  const save = (autonomy: Autonomy) => {
    const saving =
      department === undefined
        ? api.updateAgent(record.id, {
            colour: record.colour,
            purpose: record.purpose ?? "",
            settings: record.settings,
            autonomy,
          })
        : api.updateDepartment(department.id, { ...settingsOf(department), autonomy });
    saving.catch((failure: unknown) => {
      showToast(failure instanceof Error ? failure.message : String(failure));
    });
  };
  const gate = useBypassGate(level, save, department?.name ?? "this agent");
  // A harness is started with or without its checks, so that one change waits for a new start.
  const waitsForStart =
    isOpen(latest) && (latest.options.permissionMode === "bypass") !== (level === "bypass");
  const note = [
    `Applies to ${department === undefined ? agent.name : `everyone in ${department.name}`}.`,
    level === saved ? "" : `${agent.name}'s profile keeps it at ${AUTONOMY[level].label}.`,
    waitsForStart ? "Agents at work change at their next start." : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <AskChip value={level} onChoose={gate.choose} align="end" note={note} />
      {gate.confirm}
    </>
  );
}
