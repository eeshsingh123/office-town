import { FolderOpen, ListChecks, type LucideIcon, Pencil, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { AUTONOMY } from "../../ui/autonomy.ts";
import styles from "./NewDepartment.module.css";
import type { DepartmentForm } from "./team-form.ts";

function Fact({
  icon: Icon,
  label,
  action,
  onEdit,
  children,
}: {
  icon: LucideIcon;
  label: string;
  action: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={styles.fact} onClick={onEdit}>
      <span className={styles.factIcon} aria-hidden>
        <Icon size={16} />
      </span>
      <span className={styles.factText}>
        <span className={styles.factLabel}>{label}</span>
        <span className={styles.factValue}>{children}</span>
      </span>
      <span className={styles.factAction}>
        <Pencil size={13} aria-hidden />
        {action}
      </span>
    </button>
  );
}

// What the review shows under the team; each tile opens the step that sets it.
export function ReviewFacts({
  form,
  workspaceNames,
  onWorkspaces,
  onRules,
}: {
  form: DepartmentForm;
  // The default first.
  workspaceNames: string[];
  onWorkspaces: () => void;
  onRules: () => void;
}) {
  const [first, ...others] = workspaceNames;
  const rules = form.rules.split(/\r?\n/).filter((line) => line.trim() !== "").length;
  return (
    <div className={styles.facts}>
      <Fact icon={FolderOpen} label="Workspaces" action="Change" onEdit={onWorkspaces}>
        {first === undefined ? (
          <span className={styles.factMissing}>Not chosen yet</span>
        ) : (
          <>
            {first}
            <span className={styles.factTag}>Default</span>
            {others.length === 0 ? null : (
              <span className={styles.factMore}>+ {others.join(", ")}</span>
            )}
          </>
        )}
      </Fact>
      <Fact icon={ShieldCheck} label="Permissions" action="Change" onEdit={onRules}>
        {AUTONOMY[form.autonomy].label}
      </Fact>
      <Fact
        icon={ListChecks}
        label="Team rules"
        action={rules === 0 ? "Add" : "Edit"}
        onEdit={onRules}
      >
        {rules === 0 ? (
          <span className={styles.factMissing}>None yet</span>
        ) : rules === 1 ? (
          "1 rule"
        ) : (
          `${rules} rules`
        )}
      </Fact>
    </div>
  );
}
