import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // git es bastante más lento en Windows; las pruebas de flujo completo encadenan decenas de commits.
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
