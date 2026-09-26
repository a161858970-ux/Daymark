import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // One repo-root .env holds both VITE_* and server-side settings.
  envDir: "../..",
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3100" } },
});
