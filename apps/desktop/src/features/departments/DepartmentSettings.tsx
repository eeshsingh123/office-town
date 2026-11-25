import { autonomySchema, type DepartmentRecord, type RoleSettings } from "@office-town/contract";
import { MessageSquareText } from "lucide-react";
import { Tabs } from "radix-ui";
import { type FormEvent, type ReactNode, useState } from "react";
import { api } from "../../api/client.ts";
import { useDepartmentState } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { clearDrafts, ignoreDraft, readDraft, useDraft, useHasDraft } from "../../store/drafts.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Count } from "../../ui/Count.tsx";
import { Crumbs } from "../../ui/Crumbs.tsx";
import { DraftNote } from "../../ui/DraftNote.tsx";
import form from "../../ui/Form.module.css";
import { LineField } from "../../ui/LineField.tsx";
import page from "../../ui/Page.module.css";
import tabs from "../../ui/PageTabs.module.css";
import { PointsField } from "../../ui/PointsField.tsx";
import { StatePill } from "../../ui/StatusIcon.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { DepartmentApps } from "../connectors/DepartmentApps.tsx";
import { DraftBox } from "../drafts/DraftBox.tsx";
import { FilesSection } from "../library/FilesSection.tsx";
import styles from "./DepartmentSettings.module.css";
import { DepartmentWorkspaces } from "./DepartmentWorkspaces.tsx";
import { MemberEditor } from "./MemberEditor.tsx";
import {
  blankPerson,
  type DepartmentForm,
  draftOfForm,
  formOfDepartment,
  formOfDraft,
  missingIn,
  rosterOf,
  teamOf,
  teamSince,
} from "./team-form.ts";

type Tab = "people" | "settings" | "access" | "files";

// The team editor opens on what was left unsaved, on the member the view names, or a new one.
function startingForm(
  department: DepartmentRecord,
  agents: ReturnType<typeof useApp.getState>["agents"],
  member: string | undefined,
  draft: string,
) {
  const saved = formOfDepartment(department, agents);
  const roster = rosterOf(saved);
  const loaded =
    teamSince(readDraft(`${draft}.team`), readDraft(`${draft}.roster`), saved) ?? saved;
  if (member !== "new") {
    const picked = loaded.members.find((one) => one.agentId === member);
    return { loaded, roster, selected: picked?.key ?? loaded.lead.key };
  }
  // Opening "new" again goes back to the one left blank, not a second one.
  const blank = loaded.members.find((one) => one.agentId === undefined && one.role.trim() === "");
  if (blank !== undefined) return { loaded, roster, selected: blank.key };
  const added = blankPerson(loaded.lead.settings);
  return {
    loaded: { ...loaded, members: [...loaded.members, added] },
    roster,
    selected: added.key,
  };
}

// One topic of the Settings tab: its name and a line on the left, its controls on the right.
function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.setting} aria-label={title}>
      <div className={styles.settingLabel}>
        <h2 className={styles.settingTitle}>{title}</h2>
        {hint === undefined ? null : <p className={page.hint}>{hint}</p>}
      </div>
      <div className={styles.settingControl}>{children}</div>
    </section>
  );
}

function RemoveDepartment({ department }: { department: DepartmentRecord }) {
  const [open, setOpen] = useState(false);
  const [withHistory, setWithHistory] = useState(false);
  return (
    <div className={styles.danger}>
      <span className={page.hint}>
        Once its task is done. You choose what happens to its agents.
      </span>
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
    </div>
  );
}

function Editor({
  department,
  member,
  describing,
  tab,
  onTab,
  onSaved,
}: {
  department: DepartmentRecord;
  member: string | undefined;
  // "Describe a change" is open, from the header.
  describing: boolean;
  tab: Tab;
  onTab: (tab: Tab) => void;
  // Opens the editor afresh on the saved team, so new members show as saved.
  onSaved: () => void;
}) {
  const agents = useApp((state) => state.agents);
  const draft = `department.${department.id}`;
  const [start] = useState(() => startingForm(department, agents, member, draft));
  const [team, setTeam] = useDraft<DepartmentForm>(`${draft}.team`, start.loaded, ignoreDraft);
  const [, setRoster] = useDraft(`${draft}.roster`, start.roster, ignoreDraft);
  const [selected, setSelected] = useState(start.selected);
  const [branchPerWorker, setBranchPerWorker] = useDraft(
    `${draft}.branchPerWorker`,
    department.branchPerWorker,
  );
  const [codeFlow, setCodeFlow] = useDraft(`${draft}.codeFlow`, department.codeFlow);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const changed = useHasDraft(draft);
  // The roster goes with the team, to tell who joins or leaves later from a change made here.
  const keepTeam = (next: DepartmentForm) => {
    setTeam(next);
    setRoster(start.roster);
  };
  const change = (next: Partial<DepartmentForm>) => keepTeam({ ...team, ...next });
  const gate = useBypassGate(team.autonomy, (autonomy) => change({ autonomy }), department.name);
  const departments = useApp((state) => state.departments);
  const otherNames = Object.values(departments)
    .filter((one) => one.id !== department.id)
    .map((one) => one.name);
  const missing = missingIn(team, otherNames);

  const redraft = async (notes: string[], drafter: RoleSettings) => {
    const reply = await api.draftDepartments({
      notes,
      drafter,
      departmentId: department.id,
      current: [draftOfForm(team)],
    });
    const [redrafted] = reply.departments;
    if (redrafted !== undefined) {
      const next = formOfDraft({ ...redrafted, departmentId: department.id }, team);
      keepTeam(next);
      setSelected(next.lead.key);
    }
    return reply;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (missing !== undefined) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.updateDepartment(department.id, {
        name: team.name.trim(),
        workspaceIds: team.workspaceIds,
        autonomy: team.autonomy,
        branchPerWorker,
        codeFlow,
        rules: team.rules,
        purpose: team.purpose.trim(),
      });
      await api.changeTeam(department.id, teamOf(team));
      clearDrafts(draft);
      showToast("Saved. Applies from the next task.");
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  const people = team.members.length + 1;
  return (
    <form className={styles.form} onSubmit={save}>
      {describing ? (
        <DraftBox
          name={`${draft}.box`}
          label="Describe a change to the team"
          placeholder=""
          changePlaceholder="For example: add a second tester on Sonnet"
          action="Apply"
          updateLabel="Apply"
          drafted
          run={redraft}
        />
      ) : null}

      <Tabs.Root value={tab} onValueChange={(next) => onTab(next as Tab)}>
        <Tabs.List className={tabs.tabs} aria-label="Department">
          <Tabs.Trigger value="people" className={tabs.tab}>
            People
            <Count value={people} />
          </Tabs.Trigger>
          <Tabs.Trigger value="settings" className={tabs.tab}>
            Settings
          </Tabs.Trigger>
          <Tabs.Trigger value="access" className={tabs.tab}>
            Workspaces and apps
          </Tabs.Trigger>
          <Tabs.Trigger value="files" className={tabs.tab}>
            Files
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="people" className={tabs.panel}>
          <MemberEditor
            team={team}
            onChange={(next) => change(next)}
            selected={selected}
            onSelect={setSelected}
            defaults={team.lead.settings}
            departmentId={department.id}
            workspaceId={department.workspaceId}
          />
        </Tabs.Content>

        <Tabs.Content value="settings" className={tabs.panel}>
          <div className={styles.settings}>
            <SettingRow title="About" hint="The chief reads this when it plans.">
              <label className={form.field}>
                <span className={form.label}>Name</span>
                <input
                  className={form.input}
                  value={team.name}
                  onChange={(event) => change({ name: event.target.value })}
                />
              </label>
              <label className={form.field}>
                <span className={form.label}>What it does</span>
                <LineField
                  value={team.purpose}
                  placeholder="One line"
                  onChange={(purpose) => change({ purpose })}
                />
              </label>
            </SettingRow>

            <SettingRow title="Team rules" hint="Every member follows these, on every task.">
              <PointsField
                label="Team rules"
                value={team.rules}
                placeholder="For example: Use TypeScript"
                addLabel="Add a rule"
                onChange={(rules) => change({ rules })}
              />
            </SettingRow>

            <SettingRow title="Permissions" hint="What the team may do without asking you.">
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
            </SettingRow>

            <SettingRow title="Code" hint="Used in a git repository.">
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
                      Each worker gets its own branch and the lead merges them.
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
            </SettingRow>

            <SettingRow title="Remove">
              <RemoveDepartment department={department} />
            </SettingRow>
          </div>
        </Tabs.Content>

        <Tabs.Content value="access" className={tabs.panel}>
          <div className={styles.settings}>
            <SettingRow
              title="Workspaces"
              hint="Folders this team can edit. New tasks use the default."
            >
              <DepartmentWorkspaces
                value={team.workspaceIds}
                onChange={(workspaceIds) => change({ workspaceIds })}
                departmentName={department.name}
                departmentId={department.id}
              />
            </SettingRow>
            <SettingRow title="Apps">
              <DepartmentApps
                departmentId={department.id}
                harnesses={[team.lead, ...team.members].map(({ settings }) => settings.harness)}
              />
            </SettingRow>
          </div>
        </Tabs.Content>

        <Tabs.Content value="files" className={tabs.panel}>
          <FilesSection
            workspaceId={department.workspaceId}
            workspaceIds={department.workspaceIds}
            holder={{ departmentId: department.id }}
            name={department.name}
          />
        </Tabs.Content>
      </Tabs.Root>

      {changed || error !== undefined || missing !== undefined ? (
        <div className={styles.saveBar}>
          <div className={styles.saveText}>
            {error === undefined ? null : (
              <p className={page.error} role="alert">
                {error}
              </p>
            )}
            {missing === undefined ? null : <span className={form.hint}>{missing}</span>}
            <DraftNote scope={draft} editing />
          </div>
          <Button type="submit" variant="primary" disabled={missing !== undefined} busy={saving}>
            Save
          </Button>
        </div>
      ) : null}
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
  const colour = useApp((state) =>
    department === undefined ? undefined : state.agents[department.leadAgentId]?.colour,
  );
  const state = useDepartmentState(departmentId);
  const [describing, setDescribing] = useState(false);
  const [tab, setTab] = useState<Tab>("people");
  const [saves, setSaves] = useState(0);
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
          <div className={styles.identity}>
            {department === undefined ? null : (
              <Avatar name={department.name} colour={colour ?? "#4F5D75"} size={44} />
            )}
            <div className={styles.headText}>
              <div className={styles.titleRow}>
                <h1 id="department-title" className={page.title}>
                  {department?.name ?? "Department"}
                </h1>
                {department === undefined ? null : <StatePill state={state} />}
              </div>
              {department?.purpose ? <p className={page.lead}>{department.purpose}</p> : null}
            </div>
          </div>
          {department === undefined ? null : (
            <Button aria-pressed={describing} onClick={() => setDescribing(!describing)}>
              <MessageSquareText size={14} aria-hidden />
              Describe a change
            </Button>
          )}
        </header>
        {department === undefined ? (
          <p className={form.hint}>This department no longer exists.</p>
        ) : (
          <Editor
            key={`${department.id}/${saves}`}
            department={department}
            member={member === "new" && saves > 0 ? undefined : member}
            describing={describing}
            tab={tab}
            onTab={setTab}
            onSaved={() => setSaves(saves + 1)}
          />
        )}
      </div>
    </section>
  );
}
