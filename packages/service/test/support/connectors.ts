import type { Secrets } from "../../src/connectors/secrets.ts";

// The credential store, kept in memory; `values` shows what was written.
export function memorySecrets(): Secrets & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    kind: "store",
    values,
    read: (id) => values.get(id),
    write: (id, value) => {
      values.set(id, value);
    },
    remove: (id) => {
      values.delete(id);
    },
  };
}
