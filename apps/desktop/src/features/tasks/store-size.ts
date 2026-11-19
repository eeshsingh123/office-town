import { api } from "../../api/client.ts";
import { useLoaded } from "../../ui/use-loaded.ts";

// Past this, the history is worth pruning; deleting tasks is the only way to free it.
export const LARGE_STORE_BYTES = 1024 ** 3;

// Task history on this computer: the database and the kept results, in bytes, and its folder.
export function useStoreInfo(): { bytes: number | undefined; folder: string | undefined } {
  const size = useLoaded("store-size", api.readStoreSize).value;
  return {
    bytes: size === undefined ? undefined : size.databaseBytes + size.resultBytes,
    folder: size?.folder,
  };
}

export const useStoreSize = (): number | undefined => useStoreInfo().bytes;
