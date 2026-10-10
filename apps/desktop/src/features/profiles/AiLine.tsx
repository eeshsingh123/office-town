import type { AgentSettings } from "@office-town/contract";
import { Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";
import { environmentKey, readCatalog } from "../../api/catalogs.ts";
import { useApp } from "../../store/app-store.ts";
import { useLoaded } from "../../ui/use-loaded.ts";
import styles from "./AiLine.module.css";

type Settings = Pick<AgentSettings, "harness" | "environment" | "model" | "effort">;

// Such as "Claude Code · Sonnet 5.5 · high thinking"; the model list is read once and cached.
export function useAiSummary(settings: Settings | undefined): string {
  const harnesses = useApp((state) => state.harnesses);
  const description = harnesses.find((known) => known.harness === settings?.harness);
  const catalog = useLoaded(
    settings !== undefined && description?.capabilities.modelList
      ? `${settings.harness}|${environmentKey(settings.environment)}`
      : undefined,
    () => readCatalog(settings?.harness ?? "", settings?.environment ?? { kind: "native" }),
  );
  if (settings === undefined) return "";
  const model = catalog.value?.models.find((known) => known.id === settings.model);
  return [
    description?.name ?? settings.harness,
    model?.name ?? settings.model ?? "its default model",
    settings.effort === undefined ? undefined : `${settings.effort} thinking`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

interface AiLineProps {
  summary: string;
  // The choices, shown only after "Change", since most people keep the defaults.
  children?: ReactNode;
  lead?: string;
}

export function AiLine({ summary, children, lead = "Thinks with" }: AiLineProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.line}>
      <span className={styles.icon} aria-hidden>
        <Sparkles size={13} />
      </span>
      <span>
        {lead} <span className={styles.summary}>{summary}</span>
      </span>
      {children === undefined ? null : (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Done" : "Change"}
        </button>
      )}
      {open ? <div className={styles.chips}>{children}</div> : null}
    </div>
  );
}
