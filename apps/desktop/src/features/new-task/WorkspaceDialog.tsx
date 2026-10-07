import type { WorkspaceRecord } from "@office-town/contract";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import { FolderField } from "../../ui/FolderField.tsx";

interface WorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (workspace: WorkspaceRecord) => void;
}

export function WorkspaceDialog({ open, onOpenChange, onCreated }: WorkspaceDialogProps) {
  const [name, setName] = useState("");
  const [folders, setFolders] = useState<(string | undefined)[]>([undefined]);
  const [error, setError] = useState<string>();
  const chosen = folders.filter(
    (folder): folder is string => folder !== undefined && folder !== "",
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const workspace = await api.createWorkspace({ name, folders: chosen });
      onCreated(workspace);
      setName("");
      setFolders([undefined]);
      setError(undefined);
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={dialog.content}>
          <Dialog.Title className={dialog.title}>New workspace</Dialog.Title>
          <Dialog.Description className={dialog.description}>
            The agent works in the first folder and may use the others as freely.
          </Dialog.Description>
          <form onSubmit={submit} className={dialog.form}>
            <label className={dialog.label}>
              Name
              <input
                className={dialog.input}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            {folders.map((folder, index) => (
              <FolderField
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are only appended
                key={index}
                label={index === 0 ? "Working folder" : `Folder ${index + 1}`}
                value={folder}
                onChange={(next) =>
                  setFolders(folders.map((current, at) => (at === index ? next : current)))
                }
              />
            ))}
            <div>
              <Button variant="ghost" onClick={() => setFolders([...folders, undefined])}>
                Add another folder
              </Button>
            </div>
            {error === undefined ? null : (
              <p className={dialog.error} role="alert">
                {error}
              </p>
            )}
            <div className={dialog.actions}>
              <Dialog.Close asChild>
                <Button variant="ghost">Cancel</Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant="primary"
                disabled={name.trim() === "" || chosen.length === 0}
              >
                Save workspace
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
