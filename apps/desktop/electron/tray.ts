import { app, Menu, Tray } from "electron";

export interface TrayActions {
  open(): void;
  quit(): void;
}

export function createTray(icon: string, { open, quit }: TrayActions): Tray {
  const tray = new Tray(icon);
  tray.setToolTip(app.getName());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${app.getName()}`, click: open },
      { type: "separator" },
      { label: "Quit", click: quit },
    ]),
  );
  tray.on("click", open);
  return tray;
}
