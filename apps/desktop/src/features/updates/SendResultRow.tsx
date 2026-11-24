import { useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { SettingRow, Switch } from "../../ui/Switch.tsx";
import { PlacePicker } from "./PlacePicker.tsx";
import { openConnect, setResultPlaces, usePlaces } from "./places.ts";

// A task's own Send result: its result goes once to the usual result places when it is done.
// The places are Settings' own, so picking here changes them for every task.
export function SendResultRow({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const places = usePlaces() ?? [];
  const resultPlaces = useApp((state) => state.updates.resultPlaces);
  const [picking, setPicking] = useState(false);
  const picked = places.filter((place) => resultPlaces.includes(place.id));
  if (places.length === 0) {
    return (
      <SettingRow label="Send result" hint="To Slack, Discord or Telegram, once it's done.">
        <Button
          onClick={() =>
            openConnect({
              onConnected: (id) => {
                setResultPlaces([id]);
                onChange(true);
              },
            })
          }
        >
          Connect apps
        </Button>
      </SettingRow>
    );
  }
  return (
    <SettingRow
      label="Send result to"
      hint={
        <PlacePicker
          label="Send result to"
          picked={resultPlaces}
          empty="Choose apps"
          open={picking}
          onOpenChange={setPicking}
          onChange={(next) => {
            setResultPlaces(next);
            if (picked.length === 0 && next.length > 0) onChange(true);
            if (next.length === 0) onChange(false);
          }}
        />
      }
    >
      <Switch
        label="Send result"
        on={on && picked.length > 0}
        onChange={(next) => (next && picked.length === 0 ? setPicking(true) : onChange(next))}
      />
    </SettingRow>
  );
}
