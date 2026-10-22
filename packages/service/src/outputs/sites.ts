// Ports this computer's servers answer on, such as Vite's "Local: http://localhost:5173/".
const LOCAL_ADDRESS = /\b(https?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\b/gi;
// Colour codes would split an address a dev server prints in colour.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape character is the point
const ANSI = /\u001b\[[0-9;]*m/g;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
const ANSWER_TIMEOUT_MS = 1500;

// Each local site the text names, once, by its origin.
export function localAddresses(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.replaceAll(ANSI, "").matchAll(LOCAL_ADDRESS)) {
    const port = Number(match[2]);
    if (port > 0 && port <= 65535) found.add(`${match[1]?.toLowerCase()}://localhost:${port}/`);
  }
  return [...found];
}

// A local address an agent gave, with its path; undefined for anything else. Named localhost as
// spotted ones are, so one site is one address, and a server that answers only on IPv6 loads.
export function siteAddress(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.port === "") return undefined;
  if (!LOCAL_HOSTS.has(url.hostname)) return undefined;
  url.hostname = "localhost";
  return url.href;
}

export const portOf = (address: string) => Number(new URL(address).port);

// Any answer counts, an error page too: something serves there.
export async function isAnswering(address: string): Promise<boolean> {
  try {
    const response = await fetch(address, {
      redirect: "manual",
      signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}
