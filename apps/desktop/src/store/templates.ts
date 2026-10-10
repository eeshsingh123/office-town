import type { ProfileRecord, ProfileRequest } from "@office-town/contract";
import { useEffect } from "react";
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

// How many agents were made from each template; guests called in once do not count.
export function useTemplateUses(): Record<string, number> {
  const agents = useApp((state) => state.agents);
  const uses: Record<string, number> = {};
  for (const agent of Object.values(agents)) {
    if (agent.profileId !== undefined && agent.guest === undefined) {
      uses[agent.profileId] = (uses[agent.profileId] ?? 0) + 1;
    }
  }
  return uses;
}

export function usedText(count: number): string {
  return count === 0 ? "Not used yet" : `Used for ${count} agent${count === 1 ? "" : "s"}`;
}
