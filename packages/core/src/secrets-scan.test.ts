import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  redactPII,
  redactPIIText,
  REDACTED_EMAIL,
  REDACTED_SECRET,
} from "./redact.js"

type Canary = {
  id: string
  raw: string
  mustNotAppearInRedactedOutput: boolean
}

const canariesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../evals/secrets-canaries/canaries.json"
)

const { strings: canaries } = JSON.parse(
  readFileSync(canariesPath, "utf8")
) as { strings: Canary[] }

/** spec 10.6 secrets-scan — canaries must not survive redaction in logs/traces/audit. */
describe("secrets-scan (spec 10.6)", () => {
  it("redactPIIText removes fictitious PII canaries in free text", () => {
    for (const canary of canaries) {
      if (canary.id.includes("password") || canary.id.includes("api-key"))
        continue
      if (!canary.mustNotAppearInRedactedOutput) continue
      const redacted = redactPIIText(canary.raw)
      expect(redacted).not.toContain(canary.raw)
      if (canary.id.includes("email")) {
        expect(redacted).toContain(REDACTED_EMAIL)
      }
    }
  })

  it("redactPII strips secret key material in structured logs", () => {
    for (const canary of canaries) {
      if (!canary.id.includes("password") && !canary.id.includes("api-key"))
        continue
      const payload = {
        note: canary.raw,
        senha: canary.raw.split("=")[1] ?? canary.raw,
      }
      const out = redactPII(payload) as typeof payload
      const redacted = String(out.senha)
      expect(redacted).toBe(REDACTED_SECRET)
    }
  })

  it("redactPII on audit-shaped objects strips secret keys", () => {
    const payload = {
      action: "chat.message",
      details: {
        senha: "VP-FICTICIA-9xK2mQ!nunca-commitar",
        note: "Contato: marina.ficticia@exemplo.test",
      },
    }
    const out = redactPII(payload) as typeof payload
    expect(out.details.senha).toBe(REDACTED_SECRET)
    expect(String(out.details.note)).toContain(REDACTED_EMAIL)
  })
})
