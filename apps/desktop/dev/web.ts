import { fileURLToPath } from "node:url";
import { createServer, type Plugin } from "vite";
import { startCore } from "../electron/core-process.ts";

// Browser mode for development: a core, and the UI's dev server forwarding `/api` to it with the
// token, as the shell does in the app (D-36). Arguments go to the core, such as --data-folder.
const CORE_ENTRY = fileURLToPath(new URL("../../../packages/service/src/main.ts", import.meta.url));

const core = await startCore(
  {
    executable: process.execPath,
    args: [CORE_ENTRY, "--stop-when-stdin-closes", ...process.argv.slice(2)],
    env: process.env,
  },
  {
    onCrash: () => {
      console.error("The core stopped.");
      process.exit(1);
    },
  },
);
// The proxy adds the token, so only this page may use it: another site's page could otherwise send
// the core a request, such as starting a task that runs commands. A typed address has no site.
const ownPageOnly: Plugin = {
  name: "own-page-only",
  configureServer(server) {
    server.middlewares.use("/api", (request, response, next) => {
      const site = request.headers["sec-fetch-site"];
      if (site === undefined || site === "same-origin" || site === "none") return next();
      response.statusCode = 403;
      response.end("Only the app's own page may call the core.");
    });
  },
};

const server = await createServer({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  // Runs before Vite's own proxy.
  plugins: [ownPageOnly],
  server: {
    proxy: {
      "/api": {
        target: core.ready.url,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: { authorization: `Bearer ${core.ready.token}` },
        // The proxy holds headers until the first byte of the body, which an idle event stream
        // may not send for minutes, so the page would never see the stream open.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxied, _request, response) => {
            if (proxied.headers["content-type"] === "text/event-stream") {
              queueMicrotask(() => response.flushHeaders());
            }
          });
        },
      },
    },
  },
});
await server.listen();
server.printUrls();

process.on("SIGINT", async () => {
  await server.close();
  await core.stop();
  process.exit(0);
});
