import type { RoleSettings } from "@office-town/contract";
import { useEffect, useState } from "react";
import { readCatalog } from "../../api/catalogs.ts";

// The core's own rule: with no model chosen, every model offered must see images. Undefined
// while unknown, so no warning shows before the catalog is read.
export function useSeesImages(settings: RoleSettings | undefined): boolean | undefined {
  const [sees, setSees] = useState<boolean>();
  const harness = settings?.harness;
  const environment = settings?.environment;
  const model = settings?.model;
  const place = environment === undefined ? "" : JSON.stringify(environment);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `place` stands for the environment
  useEffect(() => {
    setSees(undefined);
    if (harness === undefined || environment === undefined) return;
    let current = true;
    readCatalog(harness, environment)
      .then(({ models }) => {
        const chosen =
          model === undefined
            ? models
            : models.filter((known) => known.id === model || known.resolvedId === model);
        if (current) {
          setSees(chosen.length > 0 && chosen.every((known) => known.inputs?.includes("image")));
        }
      })
      // The core sends the path either way; without a catalog there is nothing to warn about.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [harness, place, model]);
  return sees;
}
