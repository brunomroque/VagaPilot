import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    include: ["lib/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
})
