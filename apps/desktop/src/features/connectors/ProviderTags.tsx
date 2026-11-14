import { useApp } from "../../store/app-store.ts";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import styles from "./Connectors.module.css";

// Which providers' agents can use an app, by name; logo only in tight rows (D-96). "all" is an app
// every provider uses.
export function ProviderTags({ tags, named = true }: { tags: string[]; named?: boolean }) {
  const harnesses = useApp((state) => state.harnesses);
  return (
    <span className={styles.tags}>
      {tags.map((tag) => {
        if (tag === "all") {
          return (
            <span key={tag} className={styles.tag} title="Every provider">
              {named ? "Any provider" : "All"}
            </span>
          );
        }
        const name = harnesses.find(({ harness }) => harness === tag)?.name ?? tag;
        return (
          <span key={tag} className={styles.tag} title={named ? undefined : name}>
            <ProviderLogo harness={tag} size="sm" />
            {named ? name : null}
          </span>
        );
      })}
    </span>
  );
}
