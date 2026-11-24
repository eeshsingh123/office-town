import { NOTICE_DEFAULTS } from "@office-town/contract";
import { Plus } from "lucide-react";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { SettingRow } from "../../ui/Switch.tsx";
import { PlacePicker } from "./PlacePicker.tsx";
import { HearsMenu, PlaceRow } from "./PlaceRow.tsx";
import { ComputerTag, PlaceTag } from "./PlaceTag.tsx";
import {
  hearsText,
  openConnect,
  sendTest,
  setComputerHears,
  setHears,
  setResultPlaces,
  testThisComputer,
  usePlaces,
} from "./places.ts";
import styles from "./Updates.module.css";

// Settings > Updates: where you hear about your work, and where a task's result goes.
export function UpdatesSettings() {
  const places = usePlaces() ?? [];
  const notifications = useApp((state) => state.notifications);
  const { routes, resultPlaces } = useApp((state) => state.updates);
  const computerHears = (kind: keyof typeof NOTICE_DEFAULTS) =>
    notifications[kind] ?? NOTICE_DEFAULTS[kind];
  return (
    <>
      <PlaceRow tag={<ComputerTag />} detail={hearsText(computerHears)}>
        <HearsMenu place="This computer" heard={computerHears} onChange={setComputerHears} />
        <Button onClick={() => void testThisComputer()}>Send a test</Button>
      </PlaceRow>
      {places.map((place) => {
        const heard = (kind: keyof typeof NOTICE_DEFAULTS) =>
          routes[kind]?.includes(place.id) === true;
        return (
          <PlaceRow
            key={place.id}
            tag={<PlaceTag place={place} />}
            detail={place.problem ?? hearsText(heard)}
            warn={place.problem !== undefined}
          >
            <HearsMenu
              place={place.name}
              heard={heard}
              onChange={(kind, on) => setHears(place.id, kind, on)}
            />
            <Button onClick={() => void sendTest(place)}>Send a test</Button>
          </PlaceRow>
        );
      })}
      <div>
        <button type="button" className={styles.connect} onClick={() => openConnect()}>
          <Plus size={14} aria-hidden />
          Connect a place
        </button>
      </div>
      <SettingRow label="Send results to" hint="For a task with Send result on.">
        <PlacePicker label="Send results to" picked={resultPlaces} onChange={setResultPlaces} />
      </SettingRow>
    </>
  );
}
