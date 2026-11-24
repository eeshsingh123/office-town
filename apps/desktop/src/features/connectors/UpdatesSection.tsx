import type { DestinationRecord, TelegramCode } from "@office-town/contract";
import { Pencil, Plus, Trash2, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { confirmed, MoreMenu } from "../../ui/ActionMenu.tsx";
import { Button } from "../../ui/Button.tsx";
import page from "../../ui/Page.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { GUIDES } from "../updates/guides/all.ts";
import { PlaceRow } from "../updates/PlaceRow.tsx";
import { ServiceLogo } from "../updates/PlaceTag.tsx";
import { errorText, openConnect, sendTest, useExpired, usePlaces } from "../updates/places.ts";
import updates from "../updates/Updates.module.css";
import styles from "./Connectors.module.css";

function detailOf(place: DestinationRecord): string {
  if (place.problem !== undefined) return place.problem;
  if (place.settings.kind !== "telegram") return GUIDES[place.settings.kind].label;
  return place.link === undefined
    ? "Telegram. Link your chat to get updates there."
    : `Telegram, linked to ${place.link.name}`;
}

function UpdatesRow({ place, pointed }: { place: DestinationRecord; pointed: boolean }) {
  const [testing, setTesting] = useState(false);
  const [code, setCode] = useState<TelegramCode>();
  const linkable = place.settings.kind === "telegram" && place.link === undefined;
  const expired = useExpired(code?.expiresAt);
  const link = async () => {
    try {
      setCode(await api.linkTelegram(place.id));
    } catch (failure) {
      showToast(errorText(failure));
    }
  };
  return (
    <li id={`place-${place.id}`} className={`${updates.listRow} ${pointed ? updates.pointed : ""}`}>
      <PlaceRow
        logo={<ServiceLogo kind={place.settings.kind} size="md" />}
        tag={<span className={styles.connName}>{place.name}</span>}
        detail={
          linkable && code !== undefined && expired ? (
            "This code ran out. Get a new one."
          ) : linkable && code !== undefined ? (
            <>
              Send <strong>{code.code}</strong> to your bot within 10 minutes.{" "}
              {code.url === undefined ? null : (
                <a className={styles.link} href={code.url} target="_blank" rel="noreferrer">
                  Open in Telegram
                </a>
              )}
            </>
          ) : (
            detailOf(place)
          )
        }
        warn={place.problem !== undefined}
      >
        {linkable ? (
          <Button onClick={() => void link()}>{code === undefined ? "Link" : "New code"}</Button>
        ) : (
          <Button
            busy={testing}
            onClick={() => {
              setTesting(true);
              void sendTest(place).finally(() => setTesting(false));
            }}
          >
            Send a test
          </Button>
        )}
        <MoreMenu
          label={`More for ${place.name}`}
          menu={() => ({
            actions: [
              { label: "Edit", icon: Pencil, run: () => openConnect({ editing: place }) },
              ...(place.link === undefined
                ? []
                : [
                    {
                      label: "Unlink chat",
                      icon: Unlink,
                      run: async () => {
                        await api.unlinkTelegram(place.id);
                      },
                    },
                  ]),
              confirmed(
                { label: "Remove", icon: Trash2 },
                {
                  title: `Remove ${place.name}?`,
                  description: "Updates stop going there. Its key is deleted from this computer.",
                  confirmLabel: "Remove",
                  run: () => api.removeDestination(place.id),
                },
              ),
            ],
          })}
        />
      </PlaceRow>
    </li>
  );
}

// The places updates go to, beside the apps agents use; shown once one is connected (D-130).
// `place` is one to point at, such as one an automation failed to send to.
export function UpdatesSection({ place: pointed }: { place?: string | undefined }) {
  const places = usePlaces();
  const loaded = places !== undefined;
  useEffect(() => {
    if (pointed === undefined || !loaded) return;
    document.getElementById(`place-${pointed}`)?.scrollIntoView({ block: "center" });
  }, [pointed, loaded]);
  if (places === undefined || places.length === 0) return null;
  return (
    <div className={page.section}>
      <div className={page.sectionHead}>
        <h2 className={page.sectionTitle}>Updates</h2>
        <Button variant="ghost" onClick={() => openConnect()}>
          <Plus size={14} aria-hidden />
          Connect a third-party application
        </Button>
      </div>
      <ul className={styles.list} aria-label="Updates">
        {places.map((place) => (
          <UpdatesRow key={place.id} place={place} pointed={place.id === pointed} />
        ))}
      </ul>
    </div>
  );
}
