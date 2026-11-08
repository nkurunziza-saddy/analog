import { defineConfig } from "cf/config";

// The web app is static: Vite builds it and Cloudflare serves it. Unknown paths such as /s/<stream>
// and /new fall back to index.html so the client router handles them.
export default defineConfig({
  worker: {
    name: "analog",
    compatibilityDate: "2026-11-08",
    workersDev: true,
    assets: {
      notFoundHandling: "single-page-application",
    },
  },
});
