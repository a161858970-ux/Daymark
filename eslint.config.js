import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      // Cargo build output and generated Tauri assets (gitignored anyway).
      "src-tauri/**",
      // Local visual-check scripts and browser session dumps.
      "output/**",
      ".playwright-cli/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        indexedDB: "readonly",
        crypto: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        fetch: "readonly",
      },
    },
  },
);
