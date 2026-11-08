import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { localApi } from "./vite.local-api";

export default defineConfig({
  plugins: [react(), tailwindcss(), localApi()],
});
