import { app, Menu, Tray } from "electron";

export interface TrayActions {
  open(): void;
  quit(): void;
}

// On a Mac the menu bar takes a template image, which the system tints for light and dark, and a
// click opens the icon's menu, as every menu bar icon does.
export function createTray(
  { icon, template }: { icon: string; template: string },
  { open, quit }: TrayActions,
): Tray {
  const mac = process.platform === "darwin";
  const tray = new Tray(mac ? template : icon);
  tray.setToolTip(app.getName());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${app.getName()}`, click: open },
      { type: "separator" },
      { label: "Quit", click: quit },
    ]),
  );
  if (!mac) tray.on("click", open);
  return tray;
}
