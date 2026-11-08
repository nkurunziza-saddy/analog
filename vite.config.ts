import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { localApi } from "./vite.local-api";
import { devApi } from "./vite.dev-api";

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    localApi(),
    devApi(),
    // Cloudflare's Build Output is only needed for `cf deploy`; the dev server stays plain Vite so the
    // dev console's local API keeps working.
    ...(command === "build" ? [cloudflare()] : []),
  ],
}));
