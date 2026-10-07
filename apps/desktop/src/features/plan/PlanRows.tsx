import { autonomySchema, type WorkspaceRecord } from "@office-town/contract";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { DropdownMenu, ToggleGroup } from "radix-ui";
import { useApp } from "../../store/app-store.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import menu from "../../ui/Menu.module.css";
import { SettingsChips } from "../profiles/SettingsChips.tsx";
import styles from "./PlanCard.module.css";
import type { DraftDepartment, KeptPiece, PlanRow } from "./plan-edit.ts";
import { wouldCycle } from "./plan-edit.ts";

// A value no department id can take, since an id starts with a letter or digit.
const NEW_DEPARTMENT = "~new";

interface PlanRowsProps {
  rows: PlanRow[];
  onChange: (rows: PlanRow[]) => void;
  kept: KeptPiece[];
  workspaces: WorkspaceRecord[];
  onNewWorkspace: (onCreated: (workspaceId: string) => void) => void;
  // What a new department's lead starts with.
  defaultLead: DraftDepartment["lead"];
}

function NewDepartmentFields({
  draft,
  onChange,
  workspaces,
  onNewWorkspace,
}: {
  draft: DraftDepartment;
  onChange: (draft: DraftDepartment) => void;
  workspaces: WorkspaceRecord[];
  onNewWorkspace: PlanRowsProps["onNewWorkspace"];
}) {
  const gate = useBypassGate(
    draft.autonomy,
    (autonomy) => onChange({ ...draft, autonomy }),
    draft.name.trim() || "this department",
  );
  return (
    <div className={styles.newDepartment}>
      <p className={styles.hint}>
        A new department: its lead proposes the workers once the plan is approved.
      </p>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Name</span>
        <input
          className={styles.input}
          value={draft.name}
          onChange={(change) => onChange({ ...draft, name: change.target.value })}
        />
      </label>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Lead harness and model</span>
        <div className={styles.chips}>
          <SettingsChips value={draft.lead} onChange={(lead) => onChange({ ...draft, lead })} />
        </div>
      </div>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Workspace · required</span>
        <div className={styles.chips}>
          {workspaces.length === 0 ? null : (
            <ChoiceMenu
              label="Workspace"
              value={draft.workspaceId ?? ""}
              choices={workspaces.map((known) => ({
                value: known.id,
                label: known.name,
                description: known.folders.join(" · "),
              }))}
              onChange={(workspaceId) => onChange({ ...draft, workspaceId })}
            />
          )}
          <Button
            variant="ghost"
            onClick={() => onNewWorkspace((workspaceId) => onChange({ ...draft, workspaceId }))}
          >
            <Plus size={14} aria-hidden />
            New workspace
          </Button>
        </div>
      </div>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Autonomy</span>
        <ToggleGroup.Root
          type="single"
          className={styles.segments}
          value={draft.autonomy}
          onValueChange={(next) => {
            const level = autonomySchema.options.find((known) => known === next);
            if (level !== undefined) gate.choose(level);
          }}
          aria-label="Autonomy"
        >
          {autonomySchema.options.map((level) => (
            <ToggleGroup.Item key={level} value={level} className={styles.segment}>
              {AUTONOMY[level].label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>
      {gate.confirm}
    </div>
  );
}

function WaitsOn({
  row,
  rows,
  kept,
  onChange,
}: {
  row: PlanRow;
  rows: PlanRow[];
  kept: KeptPiece[];
  onChange: (waitsOn: string[]) => void;
}) {
  const titled = [...kept, ...rows];
  const titleOf = (key: string) => titled.find((piece) => piece.key === key)?.title ?? key;
  const offered = titled.filter(
    (piece) =>
      piece.key !== row.key &&
      !row.waitsOn.includes(piece.key) &&
      !wouldCycle(rows, row.key, piece.key),
  );
  return (
    <div className={styles.waits}>
      <span className={styles.fieldLabel}>Waits on</span>
      {row.waitsOn.length === 0 ? <span className={styles.hint}>Nothing</span> : null}
      {row.waitsOn.map((key) => (
        <span key={key} className={styles.chip}>
          {titleOf(key)}
          <button
            type="button"
            className={styles.chipRemove}
            aria-label={`No longer wait on ${titleOf(key)}`}
            onClick={() => onChange(row.waitsOn.filter((one) => one !== key))}
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      {offered.length === 0 ? null : (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className={styles.add}>
            <Plus size={12} aria-hidden />
            Add
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={menu.surface} align="start" sideOffset={4}>
              {offered.map((piece) => (
                <DropdownMenu.Item
                  key={piece.key}
                  className={menu.item}
                  onSelect={() => onChange([...row.waitsOn, piece.key])}
                >
                  {piece.title}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}

function nextKey(rows: readonly PlanRow[]): string {
  let number = rows.length + 1;
  while (rows.some((row) => row.key === `piece-${number}`)) number += 1;
  return `piece-${number}`;
}

// The plan's pieces to edit: a department, a title and brief, and what each waits on (D-49).
export function PlanRows({
  rows,
  onChange,
  kept,
  workspaces,
  onNewWorkspace,
  defaultLead,
}: PlanRowsProps) {
  const departments = useApp((state) => state.departments);
  const saved = Object.values(departments).toSorted((a, b) => a.name.localeCompare(b.name));
  const update = (key: string, change: Partial<PlanRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const move = (index: number, by: number) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    if (row !== undefined) next.splice(index + by, 0, row);
    onChange(next);
  };
  const remove = (key: string) =>
    onChange(
      rows
        .filter((row) => row.key !== key)
        .map((row) => ({ ...row, waitsOn: row.waitsOn.filter((one) => one !== key) })),
    );
  const newDraft = (): DraftDepartment => ({
    name: "",
    purpose: "",
    lead: defaultLead,
    autonomy: "supervised",
  });
  const chooseDepartment = (row: PlanRow, value: string) => {
    if (value !== NEW_DEPARTMENT) {
      update(row.key, { department: { departmentId: value } });
      return;
    }
    if ("newDepartment" in row.department) return;
    update(row.key, { department: { newDepartment: newDraft() } });
  };

  return (
    <>
      <ol className={styles.rows} aria-label="Pieces">
        {rows.map((row, index) => (
          <li key={row.key} className={styles.row}>
            <div className={styles.rowHead}>
              <span className={styles.number}>{index + 1}</span>
              <ChoiceMenu
                label="Department"
                value={
                  "departmentId" in row.department ? row.department.departmentId : NEW_DEPARTMENT
                }
                choices={[
                  ...saved.map((department) => ({ value: department.id, label: department.name })),
                  { value: NEW_DEPARTMENT, label: "New department" },
                ]}
                onChange={(value) => chooseDepartment(row, value)}
              />
              <span className={styles.spacer} />
              <Button
                variant="ghost"
                icon
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={14} aria-hidden />
              </Button>
              <Button
                variant="ghost"
                icon
                aria-label="Move down"
                disabled={index === rows.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={14} aria-hidden />
              </Button>
              <Button
                variant="ghost"
                icon
                aria-label={`Remove ${row.title || "this piece"}`}
                onClick={() => remove(row.key)}
              >
                <X size={14} aria-hidden />
              </Button>
            </div>
            <input
              className={styles.input}
              aria-label="Title"
              placeholder="Title"
              value={row.title}
              onChange={(change) => update(row.key, { title: change.target.value })}
            />
            <textarea
              className={styles.input}
              aria-label="Brief"
              placeholder="What the department is to do and hand back"
              rows={2}
              value={row.brief}
              onChange={(change) => update(row.key, { brief: change.target.value })}
            />
            <WaitsOn
              row={row}
              rows={rows}
              kept={kept}
              onChange={(waitsOn) => update(row.key, { waitsOn })}
            />
            {"newDepartment" in row.department ? (
              <NewDepartmentFields
                draft={row.department.newDepartment}
                onChange={(newDepartment) => update(row.key, { department: { newDepartment } })}
                workspaces={workspaces}
                onNewWorkspace={onNewWorkspace}
              />
            ) : null}
          </li>
        ))}
      </ol>
      <div>
        <Button
          onClick={() =>
            onChange([
              ...rows,
              {
                key: nextKey(rows),
                title: "",
                brief: "",
                waitsOn: [],
                department:
                  saved[0] === undefined
                    ? { newDepartment: newDraft() }
                    : { departmentId: saved[0].id },
              },
            ])
          }
        >
          <Plus size={14} aria-hidden />
          Add a piece
        </Button>
      </div>
    </>
  );
}
