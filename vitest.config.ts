import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config();

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/tests/**"],
      reporter: ["text", "json-summary"],
    },
  },
});
