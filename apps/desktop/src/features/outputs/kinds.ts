import type { OutputTarget } from "@office-town/contract";

// How the viewer shows a file (M8); "other" opens in its default app.
export type ViewKind = "page" | "site" | "image" | "pdf" | "markdown" | "table" | "code" | "other";

const BY_EXTENSION: Record<string, ViewKind> = {
  html: "page",
  htm: "page",
  pdf: "pdf",
  md: "markdown",
  markdown: "markdown",
  csv: "table",
  tsv: "table",
};
for (const extension of "png jpg jpeg gif webp svg avif bmp ico".split(" ")) {
  BY_EXTENSION[extension] = "image";
}
for (const extension of (
  "txt log json jsonc ts tsx js jsx mjs cjs css scss less py rb go rs java kt swift c h cpp hpp cs " +
  "php sh bash zsh ps1 bat yml yaml toml ini cfg conf xml sql graphql vue svelte astro lua r dart " +
  "scala ex exs erl hs ml tf gradle properties diff patch"
).split(" ")) {
  BY_EXTENSION[extension] = "code";
}
// Files known by their whole name.
const NAMED = new Set(["dockerfile", "makefile", "procfile", "license", "readme"]);

export const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

export function extensionOf(path: string): string {
  const name = fileName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1);
}

export function viewKindOf(target: OutputTarget): ViewKind {
  if (target.kind === "site") return "site";
  const extension = extensionOf(target.path);
  if (extension === "" && NAMED.has(fileName(target.path).toLowerCase())) return "code";
  return BY_EXTENSION[extension] ?? "other";
}

export const KIND_LABELS: Record<ViewKind, string> = {
  page: "Page",
  site: "Live site",
  image: "Image",
  pdf: "PDF",
  markdown: "Document",
  table: "Table",
  code: "Code",
  other: "File",
};

// Inside one of the task's folders it reads from there, with forward slashes.
export function shownPath(path: string, roots: readonly string[]): string {
  const folded = (text: string) => text.replaceAll("\\", "/").replace(/\/+$/, "");
  const file = folded(path);
  const root = roots
    .map(folded)
    .filter((one) => file.toLowerCase().startsWith(`${one.toLowerCase()}/`))
    .sort((a, b) => b.length - a.length)[0];
  return root === undefined ? file : file.slice(root.length + 1);
}

// Comma or tab separated, quotes as spreadsheets write them; only the first rows are read.
export function parseTable(text: string, separator: "," | "\t", maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length && rows.length < maxRows; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if ((cell !== "" || row.length > 0) && rows.length < maxRows) rows.push([...row, cell]);
  return rows;
}
