import { useApp } from "../../store/app-store.ts";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import styles from "./Connectors.module.css";

// Who can use an app: one small chip per provider, or "All" for an app every provider uses (D-96).
export function ProviderTags({ tags, named = false }: { tags: string[]; named?: boolean }) {
  const harnesses = useApp((state) => state.harnesses);
  return (
    <span className={styles.tags}>
      {tags.map((tag) => {
        if (tag === "all") {
          return (
            <span key={tag} className={styles.tag} title="Every provider">
              All
            </span>
          );
        }
        const name = harnesses.find(({ harness }) => harness === tag)?.name ?? tag;
        return (
          <span key={tag} className={styles.tag} title={`${name} agents`}>
            <ProviderLogo harness={tag} size="sm" />
            {named ? name : null}
          </span>
        );
      })}
    </span>
  );
}
