// Each brand's own full-colour logo, one file per connector slug in ./logos (the gilbarbara
// "logos" set, svgl and theSVG; Zapier and Stripe as their glyph in the brand colour). An app with
// no file here gets its first letter.
const FILES = import.meta.glob<string>("./logos/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

export const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([file, url]) => [file.slice("./logos/".length, -".svg".length), url]),
);

// Black or near-black marks, flipped to light in dark mode so they stay visible.
export const DEEP = new Set([
  "attio",
  "github",
  "granola",
  "intercom",
  "linear",
  "notion",
  "sentry",
  "square",
  "vercel",
  "wix",
]);
