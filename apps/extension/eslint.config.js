import { config } from "@vagapilot/config/eslint/base"

/** @type {import("eslint").Linter.Config[]} */
export default [{ ignores: [".output/**", ".wxt/**", "dist/**"] }, ...config]
