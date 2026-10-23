import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const sql = readFileSync(
  join(root, "supabase/migrations/20261024000000_risk_alerts_legal_evidence.sql"),
  "utf8"
).replace(/\r\n/g, "\n")

describe("legal evidence migration", () => {
  it.each(["legal_documents", "legal_acceptances", "apply_consent_decisions"])(
    "%s blocks update and delete with a trigger",
    (table) => {
      expect(sql).toMatch(
        new RegExp(
          `before update or delete on public\\.${table}\\nfor each row execute function public\\.block_mutation\\(\\)`
        )
      )
      expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated`)
    }
  )

  it("chains acceptances per user and keeps evidence after account deletion", () => {
    expect(sql).toContain("unique nulls not distinct (user_id, prev_hash)")
    const body = sql.split("create table public.legal_acceptances (")[1]!.split(");")[0]!
    expect(body).toMatch(/user_id uuid not null,/)
    expect(body).not.toMatch(/user_id[^\n]*references/)
  })

  it.each(["termos-de-uso", "politica-de-privacidade", "termo-riscos-automacao"])(
    "seeds %s exactly as docs/legal (template hash)",
    (slug) => {
      const md = readFileSync(join(root, `docs/legal/${slug}.md`), "utf8").replace(/\r\n/g, "\n")
      const hash = createHash("sha256").update(md, "utf8").digest("hex")
      expect(sql).toContain(`$legal$${md}$legal$, '${hash}'`)
    }
  )
})
