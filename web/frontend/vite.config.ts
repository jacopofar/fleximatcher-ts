import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^fleximatcher\/wiktionary\/browser$/,
        replacement: resolve(root, "../../src/wiktionary/browser.ts"),
      },
      {
        find: /^fleximatcher$/,
        replacement: resolve(root, "../../src/browser.ts"),
      },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});
