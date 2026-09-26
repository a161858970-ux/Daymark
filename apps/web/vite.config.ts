import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // One repo-root .env holds both VITE_* and server-side settings.
  envDir: "../..",
  build: {
    rolldownOptions: {
      output: {
        // Vendor split keeps the entry chunk small without changing behavior.
        codeSplitting: {
          groups: [
            {
              name: (moduleId: string) =>
                /node_modules[\\/]@supabase[\\/]/.test(moduleId)
                  ? "supabase"
                  : null,
            },
            {
              name: (moduleId: string) =>
                /node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(
                  moduleId,
                )
                  ? "react-vendor"
                  : null,
            },
          ],
        },
      },
    },
  },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3100" } },
});
