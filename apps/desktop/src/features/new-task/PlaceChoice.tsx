import type { WorkspaceRecord } from "@office-town/contract";
import { Plus } from "lucide-react";
import { Button } from "../../ui/Button.tsx";
import { OptionRows } from "../../ui/Choice.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { FolderField } from "../../ui/FolderField.tsx";
import page from "../../ui/Page.module.css";

interface ProjectPickerProps {
  workspaces: WorkspaceRecord[];
  workspaceId: string | undefined;
  onWorkspace: (workspaceId: string) => void;
  onNewWorkspace: () => void;
}

// A project is a saved workspace: one or more folders the work happens in.
export function ProjectPicker({
  workspaces,
  workspaceId,
  onWorkspace,
  onNewWorkspace,
}: ProjectPickerProps) {
  return (
    <div className={page.row}>
      {workspaces.length > 0 ? (
        <ChoiceMenu
          label="Project"
          value={workspaceId ?? ""}
          choices={workspaces.map((known) => ({
            value: known.id,
            label: known.name,
            description: known.folders.join(" · "),
          }))}
          onChange={onWorkspace}
        />
      ) : (
        <span className={page.hint}>No project yet. Add the folder you want it to work in.</span>
      )}
      <Button variant="ghost" onClick={onNewWorkspace}>
        <Plus size={14} aria-hidden />
        New project
      </Button>
    </div>
  );
}

interface PlaceChoiceProps extends ProjectPickerProps {
  place: "workspace" | "folder";
  onPlace: (place: "workspace" | "folder") => void;
  folder: string | undefined;
  onFolder: (folder: string) => void;
}

export function PlaceChoice({ place, onPlace, folder, onFolder, ...project }: PlaceChoiceProps) {
  return (
    <section className={page.section}>
      <h2 className={page.sectionTitle}>Which folder should it work in?</h2>
      <OptionRows
        name="place"
        label="Which folder it works in"
        value={place}
        wide
        options={[
          {
            value: "workspace",
            title: "My project",
            description: "Work on files you already have, such as a code repository.",
          },
          {
            value: "folder",
            title: "A fresh folder",
            description: "A new, empty folder named after today's date and your task.",
          },
        ]}
        onChange={onPlace}
      />
      {place === "workspace" ? (
        <ProjectPicker {...project} />
      ) : (
        <FolderField
          label="folder for new work"
          value={folder}
          onChange={onFolder}
          hint="Each task gets its own folder inside this one."
        />
      )}
    </section>
  );
}
