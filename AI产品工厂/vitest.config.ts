import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web", import.meta.url))
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/web/**/*.test.ts", "apps/web/**/*.test.tsx", "apps/worker/**/*.test.ts"],
    environment: "node",
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
