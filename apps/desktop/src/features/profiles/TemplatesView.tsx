import type { ProfileRecord } from "@office-town/contract";
import { CircleHelp, LayoutGrid, List, MoreHorizontal, Plus, Search } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { deleteTemplate, usedText, useTemplates, useTemplateUses } from "../../store/templates.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import menu from "../../ui/Menu.module.css";
import page from "../../ui/Page.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { useModels } from "./model-line.ts";
import { modelLine, modelName } from "./model-name.ts";
import { draftOf, TemplateDialog, type TemplateDraft } from "./TemplateDialog.tsx";
import styles from "./Templates.module.css";
import { TemplatesGuide } from "./TemplatesGuide.tsx";

type Sort = "used" | "name" | "new";
type Layout = "cards" | "list";
// "free" or an AI app's id; empty for all.
type Filter = string;

const LAYOUT_KEY = "office-town.templates.layout";
const GUIDE_KEY = "office-town.templates.guide-hidden";

function loadGuideHidden(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === "true";
  } catch {
    return false;
  }
}

function loadLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}

interface Editing {
  template: ProfileRecord | undefined;
  start: TemplateDraft | undefined;
  // A new key opens a fresh form.
  key: number;
}

function Actions({
  template,
  onEdit,
  onDuplicate,
}: {
  template: ProfileRecord;
  onEdit: () => void;
  onDuplicate: () => void;
}) {
  return (
    <div className={styles.actions}>
      <Button
        className={styles.small}
        onClick={(event) => {
          event.stopPropagation();
          navigate({ name: "new-task", templateId: template.id });
        }}
      >
        Use
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            icon
            className={styles.small}
            aria-label={`More actions for ${template.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal size={16} aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={menu.surface}
            align="end"
            sideOffset={4}
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenu.Item className={menu.item} onSelect={onEdit}>
              Edit
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menu.item} onSelect={onDuplicate}>
              Duplicate
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={`${menu.item} ${styles.danger}`}
              onSelect={() =>
                void deleteTemplate(template.id).then(() =>
                  showToast(
                    `Deleted “${template.name}”. Agents made from it keep working as before.`,
                  ),
                )
              }
            >
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

export function TemplatesView() {
  const harnesses = useApp((state) => state.harnesses);
  const templates = useTemplates();
  const uses = useTemplateUses();
  const all = templates ?? [];
  const modelsOf = useModels(all.map((template) => template.settings));
  const free = (settings: ProfileRecord["settings"]) =>
    modelsOf(settings)?.find((model) => model.id === settings.model)?.access === "free";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("");
  const [sort, setSort] = useState<Sort>("used");
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [editing, setEditing] = useState<Editing>();
  const [guideHidden, setGuideHidden] = useState(loadGuideHidden);
  const showGuide = (show: boolean) => {
    setGuideHidden(!show);
    try {
      localStorage.setItem(GUIDE_KEY, String(!show));
    } catch {
      // Remembering this is a convenience only.
    }
  };
  const open = (template: ProfileRecord | undefined, start?: TemplateDraft) =>
    setEditing({ template, start, key: (editing?.key ?? 0) + 1 });
  const chooseLayout = (next: Layout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Remembering the layout is a convenience only.
    }
  };

  const apps = harnesses.filter((known) =>
    all.some((template) => template.settings.harness === known.harness),
  );
  const anyFree = all.some((template) => free(template.settings));
  const words = query.trim().toLowerCase();
  const shown = all
    .filter((template) => {
      const line = modelLine(template.settings, harnesses, modelsOf(template.settings));
      const text = `${template.name} ${template.role} ${line}`.toLowerCase();
      if (words !== "" && !text.includes(words)) return false;
      if (filter === "free") return free(template.settings);
      return filter === "" || template.settings.harness === filter;
    })
    .toSorted((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "new"
          ? b.createdAt.localeCompare(a.createdAt)
          : (uses[b.id] ?? 0) - (uses[a.id] ?? 0) || a.name.localeCompare(b.name),
    );

  const filters: { value: Filter; label: string }[] = [
    { value: "", label: "All" },
    ...apps.map((known) => ({ value: known.harness, label: known.name })),
    ...(anyFree ? [{ value: "free", label: "Free models" }] : []),
  ];
  const actions = (template: ProfileRecord) => (
    <Actions
      template={template}
      onEdit={() => open(template)}
      onDuplicate={() => open(undefined, { ...draftOf(template), name: `${template.name} copy` })}
    />
  );

  return (
    <section className={page.page} aria-labelledby="templates-title">
      <div className={styles.page}>
        <header className={styles.head}>
          <div className={page.header}>
            <h1 id="templates-title" className={page.title}>
              Templates
            </h1>
            <p className={page.lead}>Saved agent setups you can reuse.</p>
          </div>
          <div className={styles.headActions}>
            {guideHidden ? (
              <Button variant="ghost" onClick={() => showGuide(true)}>
                <CircleHelp size={14} aria-hidden />
                How templates work
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => open(undefined)}>
              <Plus size={14} aria-hidden />
              New template
            </Button>
          </div>
        </header>

        {guideHidden ? null : (
          <TemplatesGuide
            onHide={() => showGuide(false)}
            {...(templates !== undefined && all.length === 0
              ? { onNew: () => open(undefined) }
              : {})}
          />
        )}

        <div className={styles.tools}>
          <label className={styles.search}>
            <Search size={15} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Search templates by name or job"
              aria-label="Search templates"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <fieldset className={`${form.row} ${form.group}`}>
            <legend className="visually-hidden">Filter by AI app</legend>
            {filters.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={form.chip}
                aria-pressed={filter === choice.value}
                onClick={() => setFilter(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </fieldset>
          <div className={styles.toolsEnd}>
            <fieldset className={`${styles.segment} ${form.group}`}>
              <legend className="visually-hidden">View as</legend>
              <button
                type="button"
                aria-pressed={layout === "cards"}
                onClick={() => chooseLayout("cards")}
              >
                <LayoutGrid size={14} aria-hidden />
                Cards
              </button>
              <button
                type="button"
                aria-pressed={layout === "list"}
                onClick={() => chooseLayout("list")}
              >
                <List size={14} aria-hidden />
                List
              </button>
            </fieldset>
            <label className={styles.sort}>
              Sort
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="used">Most used</option>
                <option value="name">Name</option>
                <option value="new">Newest</option>
              </select>
            </label>
          </div>
        </div>

        {templates === undefined ? (
          <p className={form.hint}>Loading templates…</p>
        ) : all.length === 0 ? (
          <div className={styles.empty}>
            <strong>No templates yet</strong>
            <p className={form.hint}>
              Use New template, or Save as template on any agent's profile.
            </p>
          </div>
        ) : (
          <div className={styles.results}>
            <p className={form.hint}>
              {shown.length === all.length
                ? `${all.length} template${all.length === 1 ? "" : "s"}`
                : `${shown.length} of ${all.length} templates`}
            </p>
            {shown.length === 0 ? (
              <div className={styles.empty}>
                <strong>No templates match</strong>
                <p className={form.hint}>Try a different word, or clear the filter.</p>
              </div>
            ) : layout === "cards" ? (
              <ul className={styles.grid} aria-label="Templates">
                {shown.map((template) => (
                  <li key={template.id} className={styles.card}>
                    <button
                      type="button"
                      className={styles.cardBody}
                      aria-label={`Edit ${template.name}`}
                      onClick={() => open(template)}
                    >
                      <span className={styles.cardTop}>
                        <Avatar name={template.name} colour={template.colour} size={32} />
                        <span className={styles.cardText}>
                          <strong>{template.name}</strong>
                          <span className={styles.job}>
                            {template.role || "No job written yet"}
                          </span>
                        </span>
                      </span>
                      <span className={styles.overview}>
                        {modelLine(template.settings, harnesses, modelsOf(template.settings))}
                      </span>
                    </button>
                    <div className={styles.cardFoot}>
                      <span className={form.hint}>{usedText(uses[template.id] ?? 0)}</span>
                      {actions(template)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Template</th>
                      <th>Model</th>
                      <th>App</th>
                      <th>Used for</th>
                      <th>
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((template) => (
                      <tr key={template.id} onClick={() => open(template)}>
                        <td>
                          <span className={styles.who}>
                            <Avatar name={template.name} colour={template.colour} size={24} />
                            <span className={styles.cardText}>
                              <strong>{template.name}</strong>
                              <span className={form.hint}>{template.role}</span>
                            </span>
                          </span>
                        </td>
                        <td>
                          {modelName(modelsOf(template.settings), template.settings.model) ??
                            "Default model"}
                        </td>
                        <td>
                          {harnesses.find((known) => known.harness === template.settings.harness)
                            ?.name ?? template.settings.harness}
                        </td>
                        <td className={form.hint}>{usedText(uses[template.id] ?? 0)}</td>
                        <td>{actions(template)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      {editing === undefined ? null : (
        <TemplateDialog
          key={editing.key}
          template={editing.template}
          start={editing.start}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(undefined);
          }}
        />
      )}
    </section>
  );
}
