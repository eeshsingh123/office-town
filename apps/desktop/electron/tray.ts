import { Menu, Tray } from "electron";

export interface TrayActions {
  open(): void;
  quit(): void;
}

export function createTray(icon: string, { open, quit }: TrayActions): Tray {
  const tray = new Tray(icon);
  tray.setToolTip("Office Town");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Office Town", click: open },
      { type: "separator" },
      { label: "Quit", click: quit },
    ]),
  );
  tray.on("click", open);
  return tray;
}
