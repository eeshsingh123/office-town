import { app, Menu } from "electron";

export interface AppMenuActions {
  openSettings(): void;
  quit(): void;
}

// A Mac app needs its own menu bar for the usual shortcuts: without an Edit menu, ⌘C and ⌘V do
// nothing in text. No View menu, so the installed app has no developer tools.
export function setAppMenu({ openSettings, quit }: AppMenuActions): void {
  const name = app.getName();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: name,
        submenu: [
          { role: "about", label: `About ${name}` },
          { type: "separator" },
          { label: "Settings…", accelerator: "Command+,", click: openSettings },
          { type: "separator" },
          { role: "hide", label: `Hide ${name}` },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          // Not the quit role: quitting asks first while agents work.
          { label: `Quit ${name}`, accelerator: "Command+Q", click: quit },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "Window",
        submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "close" }],
      },
    ]),
  );
}
