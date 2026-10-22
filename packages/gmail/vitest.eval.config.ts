import { defineConfig } from "vitest/config"

/** `pnpm eval:email` (P4.2): runs the labelled corpus in evals/email. Not part of `turbo test`. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["eval/**/*.eval.ts"],
    testTimeout: 600_000,
    silent: false,
  },
})
