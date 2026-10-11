import type { ProfileRecord } from "@office-town/contract";
import { navigate, useApp } from "../../store/app-store.ts";
import { useTemplates } from "../../store/templates.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import form from "../../ui/Form.module.css";
import page from "../../ui/Page.module.css";
import { useModels } from "./model-line.ts";
import { modelLine } from "./model-name.ts";
import styles from "./Templates.module.css";

interface TemplatePickerProps {
  // The template the form was filled in from; none for a blank start.
  chosen: string | undefined;
  onPick: (template: ProfileRecord | undefined) => void;
  // Such as "this agent" or "the lead".
  who?: string;
  title?: string;
}

// Picking one fills in the form below it; what the user changes after stays theirs (D-55).
export function TemplatePicker({
  chosen,
  onPick,
  who = "this agent",
  title = "Start from a template",
}: TemplatePickerProps) {
  const harnesses = useApp((state) => state.harnesses);
  const templates = useTemplates() ?? [];
  const modelsOf = useModels(templates.map((template) => template.settings));
  const picked = templates.find((template) => template.id === chosen);

  return (
    <section className={page.section} aria-label={title}>
      <div className={styles.pickerHead}>
        <h2 className={page.sectionTitle}>{title}</h2>
        <button
          type="button"
          className={styles.link}
          onClick={() => navigate({ name: "templates" })}
        >
          Manage templates
        </button>
      </div>
      {templates.length === 0 ? (
        <div className={styles.empty}>
          <strong>No templates yet</strong>
          <p className={form.hint}>Use Save as template on any agent's profile.</p>
        </div>
      ) : (
        <>
          <div className={styles.picker}>
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={styles.pick}
                aria-pressed={template.id === chosen}
                onClick={() => onPick(template)}
              >
                <span className={styles.pickName}>
                  <Avatar name={template.name} colour={template.colour} size={22} />
                  {template.name}
                </span>
                <span className={styles.job}>{template.role}</span>
                <span className={styles.overview}>
                  {modelLine(template.settings, harnesses, modelsOf(template.settings))}
                </span>
              </button>
            ))}
            <button
              type="button"
              className={`${styles.pick} ${styles.pickBlank}`}
              aria-pressed={chosen === undefined}
              onClick={() => onPick(undefined)}
            >
              <strong>Start blank</strong>
            </button>
          </div>
          {picked === undefined ? null : (
            <p className={form.info}>
              Filled in from <strong>{picked.name}</strong>. Changing {who} won't change the
              template.
            </p>
          )}
        </>
      )}
    </section>
  );
}
