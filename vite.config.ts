import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { localApi } from "./vite.local-api";
import { devApi } from "./vite.dev-api";

export default defineConfig({
  plugins: [react(), tailwindcss(), localApi(), devApi()],
});
