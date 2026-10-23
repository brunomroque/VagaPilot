import { describe, expect, it } from "vitest"

import { assertCvAppendOnly } from "./cv-structure.js"

describe("assertCvAppendOnly", () => {
  const parent = `Acme Corp · Engenheira (01/2020 – 06/2023)
- Entreguei APIs`

  it("allows additions after parent experiences", () => {
    const next = `${parent}
Nova Skill · Consultora (07/2023 – atual)
- Projetos cloud`
    expect(assertCvAppendOnly({ parentText: parent, nextText: next }).ok).toBe(
      true
    )
  })

  it("rejects changed company on existing row", () => {
    const next = `Outra Corp · Engenheira (01/2020 – 06/2023)
- Entreguei APIs`
    expect(assertCvAppendOnly({ parentText: parent, nextText: next })).toEqual({
      ok: false,
      code: "cv_destructive_change",
    })
  })

  it("rejects removed experience", () => {
    expect(
      assertCvAppendOnly({ parentText: parent, nextText: "- Só bullets" }).ok
    ).toBe(false)
  })
})
