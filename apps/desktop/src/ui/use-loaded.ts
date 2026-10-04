import { useEffect, useRef, useState } from "react";

export interface Loaded<T> {
  value?: T;
  error?: string;
}

// Loads once per key, and again when the key changes; no key, no load. A load that finishes after
// its key changed is dropped.
export function useLoaded<T>(key: string | undefined, load: () => Promise<T>): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({});
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    setLoaded({});
    if (key === undefined) return;
    let current = true;
    latest
      .current()
      .then((value) => {
        if (current) setLoaded({ value });
      })
      .catch((error: unknown) => {
        if (current) setLoaded({ error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      current = false;
    };
  }, [key]);
  return loaded;
}
