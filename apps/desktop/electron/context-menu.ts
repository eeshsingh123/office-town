import {
  app,
  type BrowserWindow,
  type ContextMenuParams,
  clipboard,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";

// The plain text menu Windows users expect. It only fires where the page opened no menu of its
// own, since the page's right-click menus prevent the event first (D-89).
export function addTextMenu(window: BrowserWindow): void {
  const { webContents } = window;
  webContents.on("context-menu", (_event, params) => {
    const items = textMenuItems(params, window);
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window });
  });
}

function textMenuItems(
  params: ContextMenuParams,
  window: BrowserWindow,
): MenuItemConstructorOptions[] {
  const { webContents } = window;
  const groups: MenuItemConstructorOptions[][] = [];
  if (params.misspelledWord) {
    groups.push([
      ...params.dictionarySuggestions.map((word) => ({
        label: word,
        click: () => webContents.replaceMisspelling(word),
      })),
      {
        label: "Add to dictionary",
        click: () => webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      },
    ]);
  }
  if (params.linkURL) {
    groups.push([{ label: "Copy link", click: () => clipboard.writeText(params.linkURL) }]);
  }
  if (params.mediaType === "image" && params.hasImageContents) {
    groups.push([
      { label: "Copy image", click: () => webContents.copyImageAt(params.x, params.y) },
    ]);
  }
  if (params.isEditable) {
    const { canCut, canCopy, canPaste, canSelectAll } = params.editFlags;
    groups.push([
      { role: "cut", enabled: canCut },
      { role: "copy", enabled: canCopy },
      { role: "paste", enabled: canPaste },
    ]);
    groups.push([{ role: "selectAll", enabled: canSelectAll }]);
  } else if (params.selectionText.trim() !== "") {
    groups.push([{ role: "copy" }]);
  }
  if (!app.isPackaged) {
    groups.push([
      { label: "Inspect", click: () => webContents.inspectElement(params.x, params.y) },
    ]);
  }
  return groups.flatMap((group, index) =>
    index === 0 ? group : [{ type: "separator" as const }, ...group],
  );
}
