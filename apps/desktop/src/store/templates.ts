import type { ProfileRecord, ProfileRequest, ProfileUses } from "@office-town/contract";
import { useEffect, useState } from "react";
import { api } from "../api/client.ts";
import { useApp } from "./app-store.ts";

// Templates are "profiles" in the API (D-55); the app calls them templates.
const byName = (templates: ProfileRecord[]) =>
  templates.toSorted((a, b) => a.name.localeCompare(b.name));

let loading: Promise<void> | undefined;

function loadTemplates(): Promise<void> {
  loading ??= api
    .listProfiles()
    .then((templates) => useApp.setState({ templates: byName(templates) }))
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

// Loaded once, then kept up to date by the saves below.
export function useTemplates(): ProfileRecord[] | undefined {
  const templates = useApp((state) => state.templates);
  useEffect(() => {
    if (templates === undefined) void loadTemplates();
  }, [templates]);
  return templates;
}

export async function saveTemplate(
  id: string | undefined,
  request: ProfileRequest,
): Promise<ProfileRecord> {
  const saved =
    id === undefined ? await api.createProfile(request) : await api.updateProfile(id, request);
  const others = (useApp.getState().templates ?? []).filter((known) => known.id !== saved.id);
  useApp.setState({ templates: byName([...others, saved]) });
  return saved;
}

export async function deleteTemplate(id: string): Promise<void> {
  await api.deleteProfile(id);
  const left = (useApp.getState().templates ?? []).filter((known) => known.id !== id);
  useApp.setState({ templates: left });
}

// Counted by the core, which holds every agent; the app holds only those it shows. Read each time
// the page opens, and undefined until then, so no count shows wrong.
export function useTemplateUses(): ProfileUses | undefined {
  const [uses, setUses] = useState<ProfileUses>();
  useEffect(() => {
    let current = true;
    api.countProfileUses().then(
      (read) => {
        if (current) setUses(read);
      },
      (failure: unknown) => console.error("Could not count template uses.", failure),
    );
    return () => {
      current = false;
    };
  }, []);
  return uses;
}

export function usedText(count: number | undefined): string {
  if (count === undefined) return "";
  return count === 0 ? "Not used yet" : `Used for ${count} agent${count === 1 ? "" : "s"}`;
}
