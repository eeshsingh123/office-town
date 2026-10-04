import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  // The app loads its code from disk, so one larger file costs nothing over the network.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1024 },
});
