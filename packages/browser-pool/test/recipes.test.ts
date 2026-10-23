import { describe, expect, it } from "vitest"

import { validatePlan, type PageSnapshot } from "../src/apply/ai-driver.js"
import {
  driftScore,
  planFromStep,
  recipeSession,
  saveRecipeRun,
  stepFromPlan,
  type AtsRecipe,
} from "../src/apply/recipes.js"
import {
  generatePassword,
  openPassword,
  sealPassword,
} from "../src/auth/credentials.js"

const field = (key: string, label: string, required = true, kind = "text") =>
  ({
    key,
    kind,
    label,
    name: key,
    autocomplete: null,
    required,
  }) as PageSnapshot["fields"][number]

const formPage = (over: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url: "https://jobs.acme-ats.com/apply/12345/step/2",
  title: "Seus dados",
  text: "Dados pessoais\nPreencha seus dados.\nNome completo\nE-mail",
  fields: [field("f1", "Nome completo"), field("f2", "E-mail", true, "email")],
  passwordKeys: [],
  buttons: [{ key: "b7", label: "Continuar", type: "button" }],
  captcha: false,
  ...over,
})

const step = stepFromPlan(formPage(), { state: "form", nextButton: "b7" })

describe("drift detection (changed DOM fixtures)", () => {
  it("same page with new data-vp keys and another job id → low", () => {
    const d = driftScore(
      formPage({
        url: "https://jobs.acme-ats.com/apply/99999/step/2",
        fields: [
          field("k9", "Nome completo"),
          field("k8", "E-mail", true, "email"),
        ],
        buttons: [{ key: "b42", label: "Continuar", type: "button" }],
      }),
      step
    )
    expect(d.level).toBe("low")
    expect(
      planFromStep(
        formPage({
          buttons: [{ key: "b42", label: "Continuar", type: "button" }],
        }),
        step
      ).plan.nextButton
    ).toBe("b42")
  })
  it("renamed CTA → medium", () => {
    const d = driftScore(
      formPage({
        buttons: [{ key: "b7", label: "Próxima etapa", type: "button" }],
      }),
      step
    )
    expect(d.level).toBe("medium")
    expect(d.reasons).toContain("cta")
  })
  it("new optional field only changes the fingerprint → low", () => {
    const d = driftScore(
      formPage({
        fields: [...formPage().fields, field("f3", "Apelido", false)],
      }),
      step
    )
    expect(d.level).toBe("low")
    expect(d.reasons).toEqual(["fingerprint"])
  })
  it("required field set changed → high", () => {
    const d = driftScore(
      formPage({ fields: [field("f1", "Nome completo"), field("f9", "CPF")] }),
      step
    )
    expect(d.requiredChanged).toBe(true)
    expect(d.level).toBe("high")
  })
  it("unrelated page → high", () => {
    const d = driftScore(
      {
        ...formPage(),
        url: "https://jobs.acme-ats.com/login",
        title: "Entrar",
        text: "Entre",
        fields: [],
        buttons: [],
      },
      step
    )
    expect(d.level).toBe("high")
  })
})

describe("recipe session", () => {
  const recipe = (status: AtsRecipe["status"]): AtsRecipe => ({
    domain: "acme-ats.com",
    platform: "generic_ai",
    version: 1,
    status,
    steps: [step],
    successes: 3,
    failures: 0,
  })
  const llm = () => {
    const calls = { n: 0 }
    return {
      calls,
      fn: async (s: PageSnapshot) => (
        calls.n++,
        {
          state: "form" as const,
          nextButton: s.buttons[0]?.key ?? null,
          usage: { totalTokens: 500 },
        }
      ),
    }
  }

  it("replays without LLM, heals a step, relearns when stale", async () => {
    const a = llm()
    const replay = recipeSession(recipe("trusted"), a.fn)
    expect((await replay.planner(formPage())).nextButton).toBe("b7")
    expect(a.calls.n).toBe(0)
    expect(replay.learnedSteps()).toBeNull()

    await replay.planner(
      formPage({
        buttons: [{ key: "b8", label: "Próxima etapa", type: "button" }],
      })
    )
    expect(a.calls.n).toBe(1)
    expect(replay.stats.healedSteps).toBe(1)
    expect(replay.stats.llmTokens).toBe(500)
    expect(replay.learnedSteps()?.[0]?.roles.nextButton?.text).toBe(
      "Próxima etapa"
    )

    const b = llm()
    const stale = recipeSession(recipe("trusted"), b.fn)
    await stale.planner(formPage({ fields: [field("f9", "CPF")] }))
    await stale.planner(formPage())
    expect(stale.stats.stale).toBe(true)
    expect(b.calls.n).toBe(2) // no replay after going stale
  })

  it("disabled/stale recipes are never replayed", async () => {
    for (const status of ["disabled", "stale"] as const) {
      const a = llm()
      await recipeSession(recipe(status), a.fn).planner(formPage())
      expect(a.calls.n).toBe(1)
    }
  })

  it("never stores typed values or e-mails in shared steps", () => {
    const s = stepFromPlan(
      formPage({
        title: "Olá bruno@example.com 123456789",
        buttons: [
          { key: "b1", label: "Enviar para bruno@example.com", type: "button" },
        ],
      }),
      { state: "form", nextButton: "b1" }
    )
    expect(JSON.stringify(s)).not.toMatch(/bruno@example\.com|123456789/)
  })
})

describe("saveRecipeRun (promotion, versioning)", () => {
  function fakeAdmin() {
    const writes: { op: string; row: Record<string, unknown> }[] = []
    const admin = {
      from: () => ({
        insert: async (row: Record<string, unknown>) => (
          writes.push({ op: "insert", row }),
          { error: null }
        ),
        update: (row: Record<string, unknown>) => ({
          eq: async () => (writes.push({ op: "update", row }), { error: null }),
        }),
      }),
    }
    return { admin: admin as never, writes }
  }
  const base: AtsRecipe = {
    id: "r1",
    domain: "acme-ats.com",
    platform: "generic_ai",
    version: 1,
    status: "learning",
    steps: [step],
    successes: 2,
    failures: 0,
  }

  it("promotes to trusted after N successes", async () => {
    const { admin, writes } = fakeAdmin()
    const session = recipeSession(base, async () => ({ state: "form" }))
    await session.planner(formPage())
    await saveRecipeRun(admin, {
      domain: base.domain,
      platform: base.platform,
      recipe: base,
      session,
      result: "success",
    })
    expect(writes).toHaveLength(1)
    expect(writes[0]!.row).toMatchObject({ status: "trusted", successes: 3 })
  })
  it("stale → old version marked stale and a new version inserted (rollback kept)", async () => {
    const { admin, writes } = fakeAdmin()
    const session = recipeSession({ ...base, status: "trusted" }, async () => ({
      state: "form",
    }))
    await session.planner(formPage({ fields: [field("f9", "CPF")] }))
    await saveRecipeRun(admin, {
      domain: base.domain,
      platform: base.platform,
      recipe: { ...base, status: "trusted" },
      session,
      result: "neutral",
    })
    expect(writes.map((w) => w.op)).toEqual(["update", "insert"])
    expect(writes[0]!.row).toMatchObject({ status: "stale" })
    expect(writes[1]!.row).toMatchObject({
      version: 2,
      parent_version: 1,
      status: "relearning",
    })
  })
})

describe("validatePlan", () => {
  it("drops unknown keys and a 'next' that is really the submit", () => {
    const snap = formPage({
      buttons: [{ key: "b1", label: "Enviar candidatura", type: "submit" }],
    })
    const plan = validatePlan(
      {
        state: "form",
        nextButton: "b1",
        applyButton: "ghost",
        codeField: "nope",
      },
      snap
    )
    expect(plan.nextButton).toBeNull()
    expect(plan.applyButton).toBeNull()
    expect(plan.codeField).toBeNull()
    expect(
      validatePlan({ state: "form" }, { ...snap, captcha: true }).state
    ).toBe("captcha")
  })
})

describe("site credentials crypto", () => {
  const key = Buffer.alloc(32, 7)
  it("seals per user+site and never opens for another", () => {
    const pw = generatePassword()
    expect(pw).toHaveLength(20)
    expect(pw).toMatch(/[a-z]/)
    expect(pw).toMatch(/[A-Z]/)
    expect(pw).toMatch(/\d/)
    const sealed = sealPassword(key, "u1", "gupy.io", pw)
    expect(Buffer.from(sealed).toString("utf8")).not.toContain(pw)
    expect(openPassword(key, "u1", "gupy.io", sealed)).toBe(pw)
    expect(() => openPassword(key, "u2", "gupy.io", sealed)).toThrow()
    expect(() =>
      openPassword(Buffer.alloc(32, 8), "u1", "gupy.io", sealed)
    ).toThrow()
  })
})
