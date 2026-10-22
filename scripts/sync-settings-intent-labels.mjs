import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { parseSettingsIntent } from "../packages/ai/src/chat/intents.js"

const path = join(
  dirname(fileURLToPath(import.meta.url)),
  "../evals/settings-intent/phrases.json"
)
const data = JSON.parse(readFileSync(path, "utf8"))
for (const item of data.cases) {
  const calls = parseSettingsIntent(item.text)
  item.expected = calls.map((call) => ({
    tool: call.tool,
    params: call.input,
  }))
}
writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
console.log("synced", data.cases.length, "cases")
