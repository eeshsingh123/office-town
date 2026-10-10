import type {
  FolderAccess,
  WorkspaceFolder,
  WorkspaceKind,
  WorkspaceRecord,
} from "@office-town/contract";
import { FolderGit2, Plus, Sparkles, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { folderName, saveWorkspace } from "../../store/workspaces.ts";
import { Button } from "../../ui/Button.tsx";
import { FolderField } from "../../ui/FolderField.tsx";
import form from "../../ui/Form.module.css";
import styles from "./Workspaces.module.css";

interface WorkspaceSheetProps {
  // Edits this one; a new workspace otherwise.
  workspace?: WorkspaceRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (workspace: WorkspaceRecord) => void;
}

const KINDS: { value: WorkspaceKind; title: string; text: string; icon: typeof FolderGit2 }[] = [
  {
    value: "folders",
    title: "Use folders I have",
    text: "A code repository or any folder of files you want changed.",
    icon: FolderGit2,
  },
  {
    value: "scratch",
    title: "Start empty",
    text: "Each task gets a new, empty folder. Good for writing and research.",
    icon: Sparkles,
  },
];

interface Extra {
  path: string | undefined;
  access: FolderAccess;
}

export function AccessChoice({
  value,
  onChange,
  label,
}: {
  value: FolderAccess;
  onChange: (access: FolderAccess) => void;
  label: string;
}) {
  return (
    <fieldset className={`${styles.access} ${form.group}`}>
      <legend className="visually-hidden">What agents may do in {label}</legend>
      {(["edit", "read"] as const).map((access) => (
        <button
          key={access}
          type="button"
          aria-pressed={value === access}
          onClick={() => onChange(access)}
        >
          {access === "edit" ? "Can edit" : "Read only"}
        </button>
      ))}
    </fieldset>
  );
}

export function WorkspaceSheet({ workspace, open, onOpenChange, onSaved }: WorkspaceSheetProps) {
  const [kind, setKind] = useState<WorkspaceKind>(workspace?.kind ?? "folders");
  const [main, setMain] = useState<string | undefined>(workspace?.folders[0]?.path);
  const [extras, setExtras] = useState<Extra[]>(workspace?.folders.slice(1) ?? []);
  const [name, setName] = useState(workspace?.name ?? "");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  // Named after its main folder until the user types a name.
  const shownName = name !== "" || main === undefined ? name : folderName(main);
  const chosen = extras.filter((extra): extra is WorkspaceFolder => !!extra.path);
  const ready = main !== undefined && main !== "" && shownName.trim() !== "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // React carries the submit out of the portal, so a form the picker sits in must not see it.
    event.stopPropagation();
    if (!ready || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await saveWorkspace(workspace?.id, {
        name: shownName.trim(),
        kind,
        folders: [{ path: main, access: "edit" }, ...chosen],
      });
      onSaved?.(saved);
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  const changeExtra = (index: number, change: Partial<Extra>) =>
    setExtras(extras.map((extra, at) => (at === index ? { ...extra, ...change } : extra)));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dim} />
        <Dialog.Content className={styles.sheet}>
          <div className={styles.sheetHead}>
            <Dialog.Title className={styles.sheetTitle}>
              {workspace === undefined ? "New workspace" : `Edit ${workspace.name}`}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" icon aria-label="Close">
                <X size={16} aria-hidden />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={form.hint}>
            Choose where your agents will work.
          </Dialog.Description>
          <form onSubmit={submit} className={styles.sheetForm}>
            {workspace === undefined ? (
              <fieldset className={`${styles.kinds} ${form.group}`}>
                <legend className="visually-hidden">Kind of workspace</legend>
                {KINDS.map(({ value, title, text, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    className={styles.kind}
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                  >
                    <span className={`${styles.icon} ${styles[value]}`}>
                      <Icon size={18} aria-hidden />
                    </span>
                    <strong>{title}</strong>
                    <span className={form.hint}>{text}</span>
                  </button>
                ))}
              </fieldset>
            ) : null}

            <div className={styles.field}>
              <span className={styles.fieldLabel}>
                {kind === "scratch" ? "Where new task folders go" : "Main folder"}
              </span>
              <FolderField
                label={kind === "scratch" ? "folder for new task folders" : "main folder"}
                value={main}
                onChange={setMain}
                hint={
                  kind === "scratch"
                    ? "Each task gets its own new folder inside this one."
                    : "Agents start here and can always change it. In a git repository, each worker gets its own copy."
                }
              />
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>Extra folders</span>
              {extras.length === 0 ? (
                <span className={form.hint}>
                  Add folders the work also needs, such as shared notes. Choose for each one whether
                  agents may change it.
                </span>
              ) : null}
              {extras.map((extra, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows keep their place until removed
                <div key={index} className={styles.extra}>
                  <FolderField
                    label={`extra folder ${index + 1}`}
                    value={extra.path}
                    onChange={(path) => changeExtra(index, { path })}
                  />
                  <AccessChoice
                    value={extra.access}
                    label={`extra folder ${index + 1}`}
                    onChange={(access) => changeExtra(index, { access })}
                  />
                  <Button
                    variant="ghost"
                    icon
                    aria-label={`Remove extra folder ${index + 1}`}
                    onClick={() => setExtras(extras.filter((_, at) => at !== index))}
                  >
                    <X size={14} aria-hidden />
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  variant="ghost"
                  onClick={() => setExtras([...extras, { path: undefined, access: "read" }])}
                >
                  <Plus size={14} aria-hidden />
                  Add a folder
                </Button>
              </div>
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Name</span>
              <input
                className={styles.input}
                value={shownName}
                placeholder="For example: Website"
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            {error === undefined ? null : (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.sheetActions}>
              <Dialog.Close asChild>
                <Button variant="ghost">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={!ready || saving}>
                {saving ? "Saving…" : workspace === undefined ? "Create workspace" : "Save"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
