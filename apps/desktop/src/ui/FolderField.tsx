import { Folder } from "lucide-react";
import { shell } from "../shell.ts";
import { Button } from "./Button.tsx";
import styles from "./FolderField.module.css";

interface FolderFieldProps {
  label: string;
  value: string | undefined;
  onChange: (folder: string) => void;
  hint?: string;
}

// The app opens the system's folder picker; browser mode has none, so the path is typed instead.
export function FolderField({ label, value, onChange, hint }: FolderFieldProps) {
  const pick = async () => {
    const folder = await shell?.pickFolder();
    if (typeof folder === "string") onChange(folder);
  };
  return (
    <div className={styles.field}>
      <Folder size={16} className={styles.icon} aria-hidden />
      <div className={styles.path}>
        {shell === undefined ? (
          <input
            className={styles.input}
            aria-label={label}
            placeholder="A full path, such as C:\Agents"
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <div className={value === undefined ? styles.empty : styles.value}>
            {value ?? "No folder chosen yet"}
          </div>
        )}
        {hint === undefined ? null : <div className={styles.hint}>{hint}</div>}
      </div>
      {shell === undefined ? null : (
        <Button onClick={pick} aria-label={`${value === undefined ? "Choose" : "Change"} ${label}`}>
          {value === undefined ? "Choose" : "Change"}
        </Button>
      )}
    </div>
  );
}
