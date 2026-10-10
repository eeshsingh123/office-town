import type { ProfileRecord } from "@office-town/contract";
import { LayoutGrid, List, MoreHorizontal, Plus, Search } from "lucide-react";
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
import { modelLine, modelName, useModels } from "./model-line.ts";
import { draftOf, TemplateDialog, type TemplateDraft } from "./TemplateDialog.tsx";
import styles from "./Templates.module.css";

type Sort = "used" | "name" | "new";
type Layout = "cards" | "list";
// "free" or an AI app's id; empty for all.
type Filter = string;

const LAYOUT_KEY = "office-town.templates.layout";

function loadLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}

const STEPS = [
  { title: "Save an agent", text: "On any agent's profile, choose Save as template." },
  {
    title: "Pick it later",
    text: "Starting a task or adding someone to a team? Your templates are at the top.",
  },
  {
    title: "Make it your own",
    text: "The new agent gets its own copy. Change it freely; the template stays the same.",
  },
];

function HowItWorks() {
  return (
    <section className={styles.how} aria-labelledby="how-title">
      <h2 id="how-title" className={page.eyebrow}>
        How templates work
      </h2>
      <ol className={styles.steps}>
        {STEPS.flatMap((step, index) => [
          ...(index === 0
            ? []
            : [<li key={`pipe-${step.title}`} className={styles.pipe} aria-hidden />]),
          <li key={step.title} className={styles.step}>
            <span className={styles.number}>{index + 1}</span>
            <strong>{step.title}</strong>
            <p className={form.hint}>{step.text}</p>
          </li>,
        ])}
      </ol>
    </section>
  );
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
  const modelOf = useModels(all.map((template) => template.settings));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("");
  const [sort, setSort] = useState<Sort>("used");
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [editing, setEditing] = useState<Editing>();
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
  const anyFree = all.some((template) => modelOf(template.settings)?.access === "free");
  const words = query.trim().toLowerCase();
  const shown = all
    .filter((template) => {
      const line = modelLine(template.settings, harnesses, modelOf(template.settings));
      const text = `${template.name} ${template.role} ${line}`.toLowerCase();
      if (words !== "" && !text.includes(words)) return false;
      if (filter === "free") return modelOf(template.settings)?.access === "free";
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
            <p className={page.lead}>
              Ready-made agents you can reuse. Each one keeps a job, notes and which AI to use, so
              adding the same kind of agent again takes one click.
            </p>
          </div>
          <Button variant="primary" onClick={() => open(undefined)}>
            <Plus size={14} aria-hidden />
            New template
          </Button>
        </header>

        <HowItWorks />

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
              Open any agent's profile and choose Save as template, or make one with New template.
            </p>
          </div>
        ) : (
          <>
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
                        {modelLine(template.settings, harnesses, modelOf(template.settings))}
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
                        <td>{modelName(template.settings, modelOf(template.settings))}</td>
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
          </>
        )}
        <p className={form.hint}>
          Editing a template changes only agents you make from it later. Agents already made from it
          keep their own settings.
        </p>
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
