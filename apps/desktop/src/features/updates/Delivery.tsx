import type { Delivery as DeliveryRecord } from "@office-town/contract";
import { useApp } from "../../store/app-store.ts";
import { PlaceTags } from "./PlaceTag.tsx";
import styles from "./Updates.module.css";

// Where a result went, under it: "Sent to [Slack]", or why a send failed. Places are matched by
// the name they had when it was sent; one renamed or removed since shows as its old name.
export function DeliveryLine({
  delivery,
  inChat = false,
}: {
  delivery: DeliveryRecord | undefined;
  // Lined up with the agent's last message.
  inChat?: boolean;
}) {
  const places = useApp((state) => state.places);
  if (delivery === undefined) return null;
  const sent = Object.values(places ?? {}).filter((place) => delivery.sentTo.includes(place.name));
  const gone = delivery.sentTo.filter((name) => !sent.some((place) => place.name === name));
  if (delivery.sentTo.length === 0 && delivery.problem === undefined) return null;
  return (
    <span className={`${styles.delivery} ${inChat ? styles.inChat : ""}`}>
      {delivery.sentTo.length === 0 ? null : (
        <>
          Sent to <PlaceTags places={sent} />
          {gone.join(", ")}
        </>
      )}
      {delivery.problem === undefined ? null : (
        <span className={styles.warn}>{delivery.problem}</span>
      )}
    </span>
  );
}
