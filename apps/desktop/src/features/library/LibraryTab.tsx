import type { AttachmentKind, LibraryAudience, LibraryItem } from "@office-town/contract";
import { Check, ChevronDown, FolderOpen, MoreHorizontal, Plus, Search } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type DragEvent, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { shell } from "../../shell.ts";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import { ago } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { sizeText, typeLabel } from "../attachments/kinds.ts";
import { GivenToMenu, useHolders } from "./GivenToMenu.tsx";
import styles from "./Library.module.css";
import { addFiles, addFolder, EVERYONE, replaceFile, usedText, useLibrary } from "./library.ts";

type Kind = AttachmentKind | "all";
// "" shows all, "everyone" the items given to everyone, else a department's id.
type Audience = string;

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "file", label: "Files" },
  { value: "image", label: "Images" },
  { value: "folder", label: "Folders" },
];

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

const folderOf = (item: LibraryItem) =>
  item.file.kind === "folder" ? item.file.path : item.file.path.replace(/[\\/][^\\/]*$/, "");

function ItemMenu({ item }: { item: LibraryItem }) {
  const input = useRef<HTMLInputElement>(null);
  const name = item.file.name;
  const run = (work: () => Promise<void>, done: string) =>
    work()
      .then(() => showToast(done))
      .catch((failure: unknown) => showToast(errorText(failure)));
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) void run(() => replaceFile(item.id, file), `Replaced ${name}.`);
        }}
      />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button icon variant="ghost" aria-label={`More actions for ${name}`}>
            <MoreHorizontal size={16} aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={menu.surface} align="end" sideOffset={4}>
            {shell === undefined ? null : (
              <DropdownMenu.Item
                className={menu.item}
                onSelect={() => void shell?.openFolder(folderOf(item))}
              >
                Show in folder
              </DropdownMenu.Item>
            )}
            {item.file.kind === "folder" ? null : (
              <DropdownMenu.Item className={menu.item} onSelect={() => input.current?.click()}>
                Replace with a new version
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              className={`${menu.item} ${styles.danger}`}
              onSelect={() =>
                void run(() => api.removeLibraryItem(item.id), `Removed ${name} from the Library.`)
              }
            >
              Remove from Library
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}

function Row({ item }: { item: LibraryItem }) {
  const adder = useApp((state) =>
    item.addedByAgentId === undefined ? undefined : state.agents[item.addedByAgentId],
  );
  const { file } = item;
  const meta = [
    file.kind === "folder" ? "Linked folder" : sizeText(file.bytes ?? 0),
    adder === undefined
      ? `Added ${ago(item.createdAt)}`
      : `Added by ${adder.name} ${ago(item.createdAt)}`,
  ];
  return (
    <li className={styles.row}>
      <span className={styles.nameCell}>
        <span className={styles.tile} aria-hidden>
          {typeLabel(file.name, file.kind)}
        </span>
        <span className={styles.nameText}>
          <b title={file.path}>{file.name}</b>
          <span>{meta.join(" · ")}</span>
        </span>
      </span>
      <GivenToMenu item={item} />
      <span className={styles.used}>{usedText(item)}</span>
      <ItemMenu item={item} />
    </li>
  );
}

// A workspace's reference files and folders, each given to everyone or to some of its teams.
export function LibraryTab({ workspaceId }: { workspaceId: string }) {
  const items = useLibrary(workspaceId);
  const holders = useHolders(workspaceId);
  const departments = useApp((state) => state.departments);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [audience, setAudience] = useState<Audience>("");
  const [adding, setAdding] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const words = query.trim().toLowerCase();
  const memberIds = new Set(
    holders.find(({ department }) => department.id === audience)?.members.map(({ id }) => id),
  );
  const shown = items.filter(({ file, givenTo }) => {
    if (words !== "" && !file.name.toLowerCase().includes(words)) return false;
    if (kind !== "all" && file.kind !== kind) return false;
    if (audience === "everyone") return givenTo.everyone;
    if (audience === "") return true;
    return (
      givenTo.departmentIds.includes(audience) || givenTo.agentIds.some((id) => memberIds.has(id))
    );
  });
  // Added while a department is shown, an item goes to that department.
  const givenTo: LibraryAudience =
    audience === "" || audience === "everyone"
      ? EVERYONE
      : { everyone: false, departmentIds: [audience], agentIds: [] };
  const audienceLabel =
    audience === ""
      ? "All"
      : audience === "everyone"
        ? "Everyone"
        : (departments[audience]?.name ?? "");

  const track = async (count: number, work: () => Promise<string[]>) => {
    setAdding((now) => now + count);
    try {
      const failed = await work();
      setErrors((now) => [...now, ...failed]);
    } finally {
      setAdding((now) => now - count);
    }
  };
  const add = (files: File[]) => {
    if (files.length > 0) void track(files.length, () => addFiles(workspaceId, files, givenTo));
  };
  const link = (path: string) =>
    track(1, () =>
      addFolder(workspaceId, path, givenTo).then(
        () => [],
        (failure: unknown) => [`Could not add ${path}: ${errorText(failure)}`],
      ),
    );
  const pickFolder = async () => {
    const path = await shell?.pickFolder();
    if (path) await link(path);
  };
  const drop = {
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDragging(false);
      const files: File[] = [];
      for (const entry of event.dataTransfer.items) {
        const file = entry.getAsFile();
        if (file === null) continue;
        if (!entry.webkitGetAsEntry()?.isDirectory) files.push(file);
        else if (shell === undefined) {
          setErrors((now) => [...now, `Folders can be added in the app only: ${file.name}`]);
        } else void link(shell.pathOf(file));
      }
      add(files);
    },
  };

  const counts = (value: Kind) =>
    value === "all" ? items.length : items.filter((item) => item.file.kind === value).length;

  return (
    <section
      className={`${styles.tab} ${dragging ? styles.dropping : ""}`}
      aria-label="Library"
      {...drop}
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          add([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <div className={styles.tools}>
        <label className={styles.search}>
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search the Library"
            aria-label="Search the Library"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className={`${menu.chip} ${styles.filter}`}>
            <span className={menu.chipLabel}>Given to</span>
            {audienceLabel}
            <ChevronDown size={13} aria-hidden />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={menu.surface} align="start" sideOffset={4}>
              <DropdownMenu.RadioGroup value={audience} onValueChange={setAudience}>
                {[
                  { value: "", label: "All" },
                  { value: "everyone", label: "Everyone" },
                  ...holders.map(({ department }) => ({
                    value: department.id,
                    label: department.name,
                  })),
                ].map((choice) => (
                  <DropdownMenu.RadioItem
                    key={choice.value}
                    value={choice.value}
                    className={menu.item}
                  >
                    <span className={menu.itemText}>{choice.label}</span>
                    <DropdownMenu.ItemIndicator>
                      <Check size={14} className={menu.check} aria-hidden />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <fieldset className={`${form.row} ${form.group}`}>
          <legend className="visually-hidden">Type</legend>
          {KINDS.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={form.chip}
              aria-pressed={kind === choice.value}
              onClick={() => setKind(choice.value)}
            >
              {choice.label} {counts(choice.value)}
            </button>
          ))}
        </fieldset>
        <span className={styles.add}>
          {shell === undefined ? null : (
            <Button onClick={() => void pickFolder()}>
              <FolderOpen size={14} aria-hidden />
              Add folder
            </Button>
          )}
          <Button variant="primary" onClick={() => input.current?.click()}>
            <Plus size={14} aria-hidden />
            Add files
          </Button>
        </span>
      </div>

      {adding > 0 ? (
        <p className={form.hint} role="status">
          Adding {adding} {adding === 1 ? "item" : "items"}…
        </p>
      ) : null}
      {errors.length === 0 ? null : (
        <div className={styles.errors} role="alert">
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <Button variant="ghost" onClick={() => setErrors([])}>
            Dismiss
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <div className={styles.empty}>
          <strong>No files yet</strong>
          <p className={form.hint}>
            Drop files or folders here. Agents get them as reference in every task.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className={styles.empty}>
          <strong>Nothing matches</strong>
          <p className={form.hint}>Try a different word, or show all.</p>
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.head} aria-hidden>
            <span>Name</span>
            <span>Given to</span>
            <span>Used</span>
            <span />
          </div>
          <ul className={styles.rows} aria-label="Library items">
            {shown.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
