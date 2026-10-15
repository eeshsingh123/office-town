import { autonomySchema, type DepartmentRecord, type RoleSettings } from "@office-town/contract";
import { CircleHelp } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { mainPath, useWorkspaces } from "../../store/workspaces.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Crumbs } from "../../ui/Crumbs.tsx";
import form from "../../ui/Form.module.css";
import { Guide, useGuideHidden } from "../../ui/Guide.tsx";
import page from "../../ui/Page.module.css";
import { DraftBox } from "../drafts/DraftBox.tsx";
import { FilesSection } from "../library/FilesSection.tsx";
import { DEPARTMENT_STEPS } from "../team/guides.tsx";
import styles from "./DepartmentSettings.module.css";
import { MemberEditor } from "./MemberEditor.tsx";
import {
  blankPerson,
  type DepartmentForm,
  draftOfForm,
  formOfDepartment,
  formOfDraft,
  missingIn,
  teamOf,
} from "./team-form.ts";

// The team editor opens on the member the view names, or a new one.
function startingForm(
  department: DepartmentRecord,
  agents: ReturnType<typeof useApp.getState>["agents"],
  member: string | undefined,
) {
  const loaded = formOfDepartment(department, agents);
  if (member !== "new") {
    const picked = loaded.members.find((one) => one.agentId === member);
    return { loaded, selected: picked?.key ?? loaded.lead.key };
  }
  const added = blankPerson(loaded.lead.settings);
  return { loaded: { ...loaded, members: [...loaded.members, added] }, selected: added.key };
}

function RemoveDepartment({ department }: { department: DepartmentRecord }) {
  const [open, setOpen] = useState(false);
  const [withHistory, setWithHistory] = useState(false);
  return (
    <section className={styles.danger} aria-labelledby="remove-title">
      <div className={styles.dangerText}>
        <strong id="remove-title">Remove department</strong>
        <span className={form.hint}>
          Not while it works on a task. You choose what happens to its agents and tasks.
        </span>
      </div>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Remove department
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Remove ${department.name}?`}
        description="Its room leaves the office and the chief stops planning for it. This cannot be undone."
        confirmLabel="Remove"
        onConfirm={async () => {
          await api.removeDepartment(department.id, withHistory);
          navigate({ name: "team" });
        }}
      >
        <fieldset className={styles.fieldset}>
          <legend className="visually-hidden">Its agents and task history</legend>
          <label className={form.choice}>
            <input
              type="radio"
              name="history"
              checked={!withHistory}
              onChange={() => setWithHistory(false)}
            />
            <span className={form.choiceText}>
              <strong>Keep its agents and task history</strong>
              <span className={form.hint}>
                Its tasks stay in Tasks; its agents become assistants.
              </span>
            </span>
          </label>
          <label className={form.choice}>
            <input
              type="radio"
              name="history"
              checked={withHistory}
              onChange={() => setWithHistory(true)}
            />
            <span className={form.choiceText}>
              <strong>Delete its agents and task history</strong>
              <span className={form.hint}>Files the agents made stay in the workspace.</span>
            </span>
          </label>
        </fieldset>
      </ConfirmDialog>
    </section>
  );
}

function Settings({
  department,
  member,
}: {
  department: DepartmentRecord;
  member: string | undefined;
}) {
  const agents = useApp((state) => state.agents);
  const workspace = useWorkspaces()?.find((known) => known.id === department.workspaceId);
  const [start] = useState(() => startingForm(department, agents, member));
  const [team, setTeam] = useState<DepartmentForm>(start.loaded);
  const [selected, setSelected] = useState(start.selected);
  const [branchPerWorker, setBranchPerWorker] = useState(department.branchPerWorker);
  const [codeFlow, setCodeFlow] = useState(department.codeFlow);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string }>();
  const change = (next: Partial<DepartmentForm>) => setTeam({ ...team, ...next });
  const gate = useBypassGate(team.autonomy, (autonomy) => change({ autonomy }), department.name);
  const missing = missingIn(team);

  const redraft = async (notes: string[], drafter: RoleSettings) => {
    const reply = await api.draftDepartments({
      notes,
      drafter,
      departmentId: department.id,
      current: [draftOfForm(team)],
    });
    const [draft] = reply.departments;
    if (draft !== undefined) {
      const next = formOfDraft({ ...draft, departmentId: department.id }, team);
      setTeam(next);
      setSelected(next.lead.key);
      setMessage({ error: false, text: "Draft applied. Check the changes, then Save." });
    }
    return reply;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (missing !== undefined) return;
    setSaving(true);
    setMessage(undefined);
    try {
      await api.updateDepartment(department.id, {
        name: team.name.trim(),
        autonomy: team.autonomy,
        branchPerWorker,
        codeFlow,
        rules: team.rules,
        purpose: team.purpose.trim(),
      });
      await api.changeTeam(department.id, teamOf(team));
      setMessage({ error: false, text: "Saved. Changes apply from the next task." });
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
      <section className={page.section}>
        <h2 className={page.sectionTitle}>Change with words</h2>
        <DraftBox
          label="Describe a change to the team"
          placeholder=""
          action="Update draft"
          drafted
          run={redraft}
        />
      </section>

      <section className={page.section}>
        <h2 className={page.sectionTitle}>About</h2>
        <div className={styles.pair}>
          <label className={form.field}>
            <span className={form.label}>Name</span>
            <input
              className={form.input}
              value={team.name}
              onChange={(event) => change({ name: event.target.value })}
            />
          </label>
          <label className={form.field}>
            <span className={form.label}>What it's for</span>
            <input
              className={form.input}
              value={team.purpose}
              placeholder="One line; the chief reads it when it plans"
              onChange={(event) => change({ purpose: event.target.value })}
            />
          </label>
        </div>
        <div className={form.field}>
          <span className={form.label}>Workspace</span>
          <div className={form.row}>
            <button
              type="button"
              className={styles.link}
              onClick={() => navigate({ name: "workspace", workspaceId: department.workspaceId })}
            >
              {workspace?.name ?? "Open workspace"}
            </button>
            <span className={styles.path}>
              {workspace === undefined ? "" : mainPath(workspace)}
            </span>
          </div>
        </div>
      </section>

      <section className={page.section}>
        <h2 className={page.sectionTitle}>Team</h2>
        <MemberEditor
          team={team}
          onChange={(next) => change(next)}
          selected={selected}
          onSelect={setSelected}
          defaults={team.lead.settings}
          departmentId={department.id}
          workspaceId={department.workspaceId}
        />
      </section>

      <section className={page.section}>
        <label className={form.field}>
          <span className={page.sectionTitle}>Team rules</span>
          <span className={form.hint}>Every member follows these, on every task.</span>
          <textarea
            className={form.input}
            value={team.rules}
            placeholder="For example: Use TypeScript. Write a test for each new page."
            onChange={(event) => change({ rules: event.target.value })}
          />
        </label>
      </section>

      <FilesSection
        workspaceId={department.workspaceId}
        holder={{ departmentId: department.id }}
        name={department.name}
      />

      <section className={page.section}>
        <h2 className={page.sectionTitle}>Permissions</h2>
        <fieldset className={styles.fieldset}>
          <legend className="visually-hidden">Permissions</legend>
          {autonomySchema.options.map((level) => (
            <label key={level} className={form.choice}>
              <input
                type="radio"
                name="autonomy"
                checked={team.autonomy === level}
                onChange={() => gate.choose(level)}
              />
              <span className={form.choiceText}>
                <strong>{AUTONOMY[level].label}</strong>
                <span className={form.hint}>{AUTONOMY[level].description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className={page.section}>
        <h2 className={page.sectionTitle}>Code</h2>
        <fieldset className={styles.fieldset}>
          <legend className="visually-hidden">Code</legend>
          <label className={form.choice}>
            <input
              type="checkbox"
              checked={branchPerWorker}
              onChange={(event) => setBranchPerWorker(event.target.checked)}
            />
            <span className={form.choiceText}>
              <strong>One branch per worker</strong>
              <span className={form.hint}>
                In a git repository, each worker gets its own branch and the lead merges them.
              </span>
            </span>
          </label>
          <label className={form.choice}>
            <input
              type="checkbox"
              checked={codeFlow}
              onChange={(event) => setCodeFlow(event.target.checked)}
            />
            <span className={form.choiceText}>
              <strong>Commit, push and open pull requests</strong>
              <span className={form.hint}>
                Uses your git and GitHub CLI logins. Follows the team's permissions.
              </span>
            </span>
          </label>
        </fieldset>
      </section>

      <div className={styles.actions}>
        {message === undefined ? null : (
          <p
            className={message.error ? page.error : form.hint}
            role={message.error ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}
        {missing === undefined ? null : <span className={form.hint}>{missing}</span>}
        <Button type="submit" variant="primary" disabled={saving || missing !== undefined}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <RemoveDepartment department={department} />
      {gate.confirm}
    </form>
  );
}

export function DepartmentSettings({
  departmentId,
  member,
}: {
  departmentId: string;
  member?: string;
}) {
  const department = useApp((state) => state.departments[departmentId]);
  const [guideHidden, setGuideHidden] = useGuideHidden("department");
  return (
    <section className={page.page} aria-labelledby="department-title">
      <div className={styles.column}>
        <Crumbs
          items={[
            { label: "Team", view: { name: "team" } },
            { label: department?.name ?? "Department" },
          ]}
        />
        <header className={styles.head}>
          <div className={page.header}>
            <h1 id="department-title" className={page.title}>
              {department?.name ?? "Department"}
            </h1>
            <p className={page.lead}>
              {department?.purpose || "A lead and the people it hands work to."}
            </p>
          </div>
          {guideHidden ? (
            <Button variant="ghost" onClick={() => setGuideHidden(false)}>
              <CircleHelp size={14} aria-hidden />
              How a department works
            </Button>
          ) : null}
        </header>
        {guideHidden ? null : (
          <Guide
            id="department-guide"
            title="How a department works"
            intro="A lead and its members, with one workspace and one set of rules. The lead decides who does what."
            steps={DEPARTMENT_STEPS}
            onHide={() => setGuideHidden(true)}
          />
        )}
        {department === undefined ? (
          <p className={form.hint}>This department no longer exists.</p>
        ) : (
          <Settings key={department.id} department={department} member={member} />
        )}
      </div>
    </section>
  );
}
