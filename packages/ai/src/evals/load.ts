import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** Reads a FICTITIOUS dataset from the repository's `evals/` folder (spec 8.3). */
export function loadEval<T>(relativePath: string): T {
  const root = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../evals"
  )
  return JSON.parse(readFileSync(join(root, relativePath), "utf8")) as T
}

export function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
