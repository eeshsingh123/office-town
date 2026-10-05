import {
  type AgentColour,
  type Autonomy,
  agentColours,
  type ProfileRecord,
  type ProfileRequest,
} from "@office-town/contract";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { type Choice, ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { profileSummary } from "../../ui/format.ts";
import { useLoaded } from "../../ui/use-loaded.ts";
import styles from "./ProfilesView.module.css";
import { type ChipSettings, SettingsChips } from "./SettingsChips.tsx";

interface Draft {
  name: string;
  role: string;
  colour: AgentColour;
  instructions: string;
  // Lowers the department's level; none keeps it.
  autonomy: Autonomy | undefined;
  settings: ChipSettings;
}

// A value no level can take.
const SAME = "~same";
const CAPS: Choice<Autonomy | typeof SAME>[] = [
  { value: SAME, label: "Same as the department" },
  ...(["supervised", "trusted", "full"] as const).map((level) => ({
    value: level,
    ...AUTONOMY[level],
  })),
];

function draftOf(profile: ProfileRecord | undefined, harness: string): Draft {
  if (profile === undefined) {
    return {
      name: "",
      role: "",
      colour: agentColours[0].value,
      instructions: "",
      autonomy: undefined,
      settings: { harness, environment: { kind: "native" } },
    };
  }
  const { instructions = "", autonomy, ...settings } = profile.settings;
  const { name, role, colour } = profile;
  return { name, role, colour, instructions, autonomy, settings };
}

function requestOf(draft: Draft): ProfileRequest {
  const instructions = draft.instructions.trim();
  return {
    name: draft.name,
    role: draft.role,
    colour: draft.colour,
    settings: {
      ...draft.settings,
      ...(instructions === "" ? {} : { instructions }),
      ...(draft.autonomy === undefined ? {} : { autonomy: draft.autonomy }),
    },
  };
}

function ProfileForm({
  profile,
  copied,
  onSaved,
  onDeleted,
  onDuplicate,
}: {
  profile: ProfileRecord | undefined;
  // A duplicate's fields, for a new profile.
  copied: Draft | undefined;
  onSaved: (saved: ProfileRecord) => void;
  onDeleted: () => void;
  onDuplicate: (draft: Draft) => void;
}) {
  const harnesses = useApp((state) => state.harnesses);
  const agents = useApp((state) => state.agents);
  const [draft, setDraft] = useState(
    () => copied ?? draftOf(profile, harnesses[0]?.harness ?? "claude"),
  );
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const users = Object.values(agents).filter((agent) => agent.profileId === profile?.id);

  const run = async (work: () => Promise<void>) => {
    setSaving(true);
    setError(undefined);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const request = requestOf(draft);
      onSaved(
        profile === undefined
          ? await api.createProfile(request)
          : await api.updateProfile(profile.id, request),
      );
    });
  };

  return (
    <form className={styles.form} onSubmit={save}>
      <div className={styles.identity}>
        <Avatar name={draft.name || "?"} colour={draft.colour} size={48} />
        <div className={styles.colours}>
          <span className={styles.label}>Colour at the desk</span>
          <div role="radiogroup" aria-label="Colour" className={styles.swatches}>
            {agentColours.map((colour) => (
              <label
                key={colour.value}
                className={styles.swatch}
                style={{ background: colour.value }}
                title={colour.label}
              >
                <input
                  type="radio"
                  name="colour"
                  className="visually-hidden"
                  aria-label={colour.label}
                  checked={draft.colour === colour.value}
                  onChange={() => setDraft({ ...draft, colour: colour.value })}
                />
              </label>
            ))}
          </div>
        </div>
        {users.length === 0 ? null : (
          <span className={styles.hint}>
            Used by {users.map((agent) => agent.name).join(", ")}. Changes apply to their next
            session.
          </span>
        )}
      </div>
      <div className={styles.pair}>
        <label className={styles.field}>
          <span className={styles.label}>Profile name</span>
          <input
            className={styles.input}
            value={draft.name}
            required
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Role</span>
          <input
            className={styles.input}
            value={draft.role}
            placeholder="For example: builds pages, styles and forms"
            onChange={(event) => setDraft({ ...draft, role: event.target.value })}
          />
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>Instructions</span>
        <textarea
          className={styles.input}
          rows={5}
          value={draft.instructions}
          onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
        />
        <span className={styles.hint}>
          Sent to the agent at the start of every task, as part of its brief.
        </span>
      </label>
      <div className={styles.field}>
        <span className={styles.label}>How it works</span>
        <div className={styles.chips}>
          <SettingsChips
            value={draft.settings}
            onChange={(settings) => setDraft({ ...draft, settings })}
          />
        </div>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>Autonomy</span>
        <div>
          <ChoiceMenu
            label="Autonomy"
            value={draft.autonomy ?? SAME}
            choices={CAPS}
            onChange={(next) => setDraft({ ...draft, autonomy: next === SAME ? undefined : next })}
          />
        </div>
        <span className={styles.hint}>
          A profile can lower its department's level, never raise it.
        </span>
      </div>
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        {profile === undefined ? null : (
          <>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() =>
                void run(async () => {
                  await api.deleteProfile(profile.id);
                  onDeleted();
                })
              }
            >
              Delete profile
            </Button>
            <Button
              disabled={saving}
              onClick={() => onDuplicate({ ...draft, name: `${draft.name} copy` })}
            >
              Duplicate
            </Button>
          </>
        )}
        <Button type="submit" variant="primary" disabled={saving || draft.name.trim() === ""}>
          Save
        </Button>
      </div>
    </form>
  );
}

// Saved descriptions of agents, like a character creator: a new task or a team role starts
// from one.
export function ProfilesView() {
  const harnesses = useApp((state) => state.harnesses);
  const listed = useLoaded("profiles", api.listProfiles);
  const [profiles, setProfiles] = useState<ProfileRecord[]>();
  const shown = profiles ?? listed.value ?? [];
  // The profile shown, or "new"; a duplicate is a new one that starts from a copy.
  const [chosen, setChosen] = useState<string>("new");
  const [copy, setCopy] = useState<{ key: number; draft: Draft }>();
  const startNew = (draft?: Draft) => {
    setChosen("new");
    setCopy(draft === undefined ? undefined : { key: (copy?.key ?? 0) + 1, draft });
  };
  const profile = shown.find((known) => known.id === chosen);

  const replace = (next: ProfileRecord[]) =>
    setProfiles(next.toSorted((a, b) => a.name.localeCompare(b.name)));

  return (
    <section className={styles.page} aria-labelledby="profiles-title">
      <nav className={styles.list} aria-label="Saved profiles">
        <div className={styles.listHead}>
          <h1 id="profiles-title">Profiles</h1>
          <Button variant="ghost" onClick={() => startNew()}>
            <Plus size={14} aria-hidden />
            New
          </Button>
        </div>
        {listed.error === undefined ? null : <p className={styles.error}>{listed.error}</p>}
        {shown.map((known) => (
          <button
            key={known.id}
            type="button"
            className={styles.item}
            aria-current={known.id === chosen ? "true" : undefined}
            onClick={() => setChosen(known.id)}
          >
            <Avatar name={known.name} colour={known.colour} size={26} />
            <span className={styles.itemText}>
              <span>{known.name}</span>
              <span className={styles.hint}>{profileSummary(known, harnesses)}</span>
            </span>
          </button>
        ))}
        {shown.length === 0 ? (
          <p className={styles.hint}>
            No profiles yet. Save one to start tasks and team roles from it.
          </p>
        ) : null}
      </nav>
      <div className={styles.editor}>
        <ProfileForm
          key={`${chosen}:${copy?.key ?? 0}`}
          profile={profile}
          copied={profile === undefined ? copy?.draft : undefined}
          onSaved={(saved) => {
            replace([...shown.filter((known) => known.id !== saved.id), saved]);
            setChosen(saved.id);
          }}
          onDeleted={() => {
            replace(shown.filter((known) => known.id !== chosen));
            startNew();
          }}
          onDuplicate={startNew}
        />
      </div>
    </section>
  );
}
