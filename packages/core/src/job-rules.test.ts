import { describe, expect, it } from "vitest"

import {
  capFitByRubric,
  checkDuplicateInTracker,
  computeJobAlerts,
  declaredLevel,
  fitFromRubric,
  inferSeniority,
  mergeAlerts,
  mergeDuplicateWithGmail,
  recommendCv,
  suggestSalary,
  titleSimilarity,
  type ProfileForAlerts,
  type SalaryRule,
  type TrackedApplication,
} from "./job-rules.js"
import {
  detectTextLanguage,
  findApplyEmail,
  splitRequirementSections,
} from "./job-text.js"

describe("inferSeniority (P2.2, before the LLM)", () => {
  it.each([
    ["Engenheiro de Software Sênior", "senior"],
    ["Senior Backend Engineer", "senior"],
    ["Desenvolvedor Pleno React", "pleno"],
    ["Analista Jr. de Dados", "junior"],
    ["Estágio em Engenharia", "estagio"],
    ["Coordenador(a) de Infraestrutura", "coordenador"],
    ["Engineering Manager, Plataforma", "gerente"],
    ["Gerente de TI", "gerente"],
    ["Head de Engenharia", "head"],
    ["Diretora de Tecnologia", "diretor"],
    ["VP of Engineering", "vp"],
    ["CTO", "c_level"],
    ["Staff Engineer", "especialista"],
  ] as const)("%s → %s", (title, expected) => {
    expect(inferSeniority(title)).toBe(expected)
  })

  it("does not treat product/project managers as people managers", () => {
    expect(inferSeniority("Product Manager")).toBeNull()
    expect(inferSeniority("Senior Product Manager")).toBe("senior")
  })

  it("reads an explicit level line from the description", () => {
    expect(
      inferSeniority("Analista de Dados", "Nível: Pleno\nRequisitos")
    ).toBe("pleno")
    expect(inferSeniority("Analista de Dados", "sem nível")).toBeNull()
  })
})

const profile: ProfileForAlerts = {
  languages: [{ language: "Inglês", level: "intermediario", cefr: null }],
  workModels: ["hibrido", "remoto"],
  regimes: ["clt"],
  cities: ["São Paulo"],
  homeCity: "São Paulo",
  relocation: "nao",
  targetSeniorities: ["gerente"],
}

describe("computeJobAlerts (10.5: code alerts the LLM cannot remove)", () => {
  it("CA6.2 fluent English required with intermediate declared always alerts", () => {
    const alerts = computeJobAlerts(
      {
        seniority: "gerente",
        workModel: "remoto",
        regime: "clt",
        location: null,
        languagesRequired: [{ language: "Inglês", level: "fluente" }],
      },
      profile
    )
    expect(alerts.map((alert) => alert.code)).toEqual(["idioma"])
    expect(alerts[0]?.params).toMatchObject({
      required: "fluente",
      declared: "intermediario",
    })
  })

  it("CA6.2 uses the CEFR level when it is higher than the label", () => {
    expect(
      declaredLevel(
        [{ language: "english", level: "intermediario", cefr: "C1" }],
        "Inglês"
      )
    ).toBe("fluente")
    expect(
      computeJobAlerts(
        {
          seniority: null,
          workModel: null,
          regime: null,
          location: null,
          languagesRequired: [{ language: "English", level: "fluente" }],
        },
        {
          ...profile,
          languages: [
            { language: "Inglês", level: "intermediario", cefr: "C1" },
          ],
        }
      )
    ).toEqual([])
  })

  it("alerts on missing language, work model, location, regime and seniority", () => {
    const alerts = computeJobAlerts(
      {
        seniority: "diretor",
        workModel: "presencial",
        regime: "pj",
        location: "Curitiba - PR",
        languagesRequired: [{ language: "Espanhol", level: "avancado" }],
      },
      profile
    )
    expect(alerts.map((alert) => alert.code).sort()).toEqual(
      ["idioma", "local", "modelo", "regime", "senioridade_acima"].sort()
    )
  })

  it("no location alert when the city matches or the user relocates", () => {
    const job = {
      seniority: "gerente" as const,
      workModel: "hibrido" as const,
      regime: "clt" as const,
      location: "São Paulo, SP",
      languagesRequired: [],
    }
    expect(computeJobAlerts(job, profile)).toEqual([])
    expect(
      computeJobAlerts(
        { ...job, location: "Recife" },
        { ...profile, relocation: "sim" }
      )
    ).toEqual([])
  })

  it("seniority far below the target alerts", () => {
    const alerts = computeJobAlerts(
      {
        seniority: "pleno",
        workModel: null,
        regime: null,
        location: null,
        languagesRequired: [],
      },
      profile
    )
    expect(alerts.map((alert) => alert.code)).toEqual(["senioridade_abaixo"])
  })

  it("merging keeps every code alert even when the model omits it", () => {
    const code = [{ code: "idioma" as const, message: "x" }]
    expect(mergeAlerts(code, [])).toEqual(code)
    expect(
      mergeAlerts(code, [
        { code: "idioma", message: "duplicate" },
        { code: "salario_fora", message: "y" },
      ]).map((alert) => alert.code)
    ).toEqual(["idioma", "salario_fora"])
  })
})

const rules: SalaryRule[] = [
  {
    seniority: "gerente",
    regime: "clt",
    min: 28000,
    target: 32000,
    currency: "BRL",
    period: "mensal",
  },
  {
    seniority: "gerente",
    regime: "pj",
    min: null,
    target: 38000,
    currency: "BRL",
    period: "mensal",
  },
  {
    seniority: "coordenador",
    regime: "clt",
    min: null,
    target: 20000,
    currency: "BRL",
    period: "mensal",
  },
]

describe("suggestSalary (RF6.3, deterministic)", () => {
  it("uses the rule for seniority × regime", () => {
    const result = suggestSalary(rules, { seniority: "gerente", regime: "pj" })
    expect(result.status).toBe("rule")
    if (result.status === "rule") expect(result.rule.target).toBe(38000)
  })

  it("prefers CLT and lists alternatives when the regime is unknown", () => {
    const result = suggestSalary(rules, {
      seniority: "gerente",
      regime: "nao_informado",
    })
    expect(result.status === "rule" && result.rule.regime).toBe("clt")
    expect(
      result.status === "rule" && result.alternatives.map((rule) => rule.regime)
    ).toEqual(["pj"])
  })

  it("alerts when the posting range is below the rule", () => {
    const result = suggestSalary(rules, {
      seniority: "gerente",
      regime: "clt",
      jobRange: { min: 18000, max: 24000, currency: "BRL" },
    })
    expect(result.alert?.code).toBe("salario_fora")
    expect(result.alert?.params?.direction).toBe("abaixo")
  })

  it("no seniority or no rule never invents a value", () => {
    expect(
      suggestSalary(rules, { seniority: null, regime: "clt" }).status
    ).toBe("no_seniority")
    expect(
      suggestSalary(rules, { seniority: "diretor", regime: "clt" }).status
    ).toBe("no_rule")
  })
})

describe("checkDuplicateInTracker (RF5.1, CA5.1)", () => {
  const now = new Date("2026-10-22T12:00:00Z")
  const applications: TrackedApplication[] = [
    {
      id: "a1",
      canonicalLink:
        "https://boards.greenhouse.io/empresaficticia/jobs/4001001",
      company: "Empresa Fictícia Pagamentos",
      roleTitle: "Engineering Manager, Plataforma",
      status: "enviada",
      appliedAt: "2026-09-01T10:00:00Z",
      createdAt: "2026-09-01T10:00:00Z",
    },
    {
      id: "a2",
      canonicalLink: null,
      company: "Loja Exemplo Ltda.",
      roleTitle: "Gerente de Engenharia",
      status: "rascunho",
      appliedAt: null,
      createdAt: "2026-10-01T10:00:00Z",
    },
    {
      id: "a3",
      canonicalLink: null,
      company: "Antiga S.A.",
      roleTitle: "Gerente de Engenharia",
      status: "enviada",
      appliedAt: "2025-01-01T10:00:00Z",
      createdAt: "2025-01-01T10:00:00Z",
    },
  ]

  it("CA5.1 the same canonical URL already sent is ja_aplicado with the date", () => {
    const result = checkDuplicateInTracker(
      {
        canonicalUrl:
          "https://boards.greenhouse.io/empresaficticia/jobs/4001001",
        company: "Outra",
        title: "Outro cargo",
      },
      applications,
      now
    )
    expect(result).toMatchObject({
      status: "ja_aplicado",
      applicationId: "a1",
      reason: "url",
    })
    expect(result.status !== "nao_aplicado" && result.appliedAt).toBe(
      "2026-09-01T10:00:00Z"
    )
  })

  it("RF5.2 gmail matches upgrade nao_aplicado when a related application exists", () => {
    const duplicate = mergeDuplicateWithGmail(
      { status: "nao_aplicado" },
      {
        status: "ok",
        matches: [
          {
            subject: "Confirmação — Loja Exemplo",
            receivedAt: "2026-10-01T12:00:00.000Z",
          },
        ],
      },
      applications[1],
      0.9
    )
    expect(duplicate).toMatchObject({
      status: "possivel_duplicata",
      reason: "gmail",
      applicationId: "a2",
    })
  })

  it("same normalized company + similar title within 180 days is possivel_duplicata", () => {
    const result = checkDuplicateInTracker(
      {
        canonicalUrl: "https://x.test/1",
        company: "Loja Exemplo",
        title: "Gerente de Engenharia (híbrido)",
      },
      applications,
      now
    )
    expect(result).toMatchObject({
      status: "possivel_duplicata",
      applicationId: "a2",
      reason: "empresa_cargo",
    })
  })

  it("ignores applications older than 180 days and different titles", () => {
    expect(
      checkDuplicateInTracker(
        {
          canonicalUrl: "https://x.test/2",
          company: "Antiga",
          title: "Gerente de Engenharia",
        },
        applications,
        now
      ).status
    ).toBe("nao_aplicado")
    expect(
      checkDuplicateInTracker(
        {
          canonicalUrl: "https://x.test/3",
          company: "Loja Exemplo",
          title: "Analista Financeiro",
        },
        applications,
        now
      ).status
    ).toBe("nao_aplicado")
  })

  it("title similarity threshold is 0.85", () => {
    expect(
      titleSimilarity("Gerente de Engenharia", "Gerente de Engenharia")
    ).toBe(1)
    expect(
      titleSimilarity("Gerente de Engenharia", "Analista de Dados")
    ).toBeLessThan(0.85)
  })
})

describe("fit rubric (10.5)", () => {
  it("alto needs every required item covered and no blocking alert", () => {
    expect(fitFromRubric({ uncoveredRequired: 0, alerts: [] })).toBe("alto")
    expect(
      fitFromRubric({
        uncoveredRequired: 0,
        alerts: [{ code: "salario_fora" }],
      })
    ).toBe("alto")
    expect(
      fitFromRubric({ uncoveredRequired: 0, alerts: [{ code: "idioma" }] })
    ).toBe("medio")
    expect(fitFromRubric({ uncoveredRequired: 2, alerts: [] })).toBe("medio")
    expect(fitFromRubric({ uncoveredRequired: 3, alerts: [] })).toBe("baixo")
    expect(
      fitFromRubric({
        uncoveredRequired: 1,
        alerts: [{ code: "idioma" }, { code: "local" }],
      })
    ).toBe("baixo")
  })

  it("the model can lower the level but never raise it above the rubric", () => {
    expect(capFitByRubric("alto", "medio")).toBe("medio")
    expect(capFitByRubric("baixo", "alto")).toBe("baixo")
  })
})

describe("recommendCv (RF6.2)", () => {
  const versions = [
    { id: "v-ops-pt", trackId: "ops", language: "pt-BR", isDefault: true },
    { id: "v-eng-pt", trackId: "eng", language: "pt-BR", isDefault: false },
    { id: "v-eng-en", trackId: "eng", language: "en", isDefault: true },
  ]

  it("picks the job language and the most similar track", () => {
    expect(
      recommendCv({
        jobLanguage: "pt-BR",
        trackScores: [
          { trackId: "ops", similarity: 0.4 },
          { trackId: "eng", similarity: 0.7 },
        ],
        versions,
      })
    ).toMatchObject({
      cvVersionId: "v-eng-pt",
      trackId: "eng",
      reason: "track_similarity",
    })
    expect(
      recommendCv({
        jobLanguage: "en",
        trackScores: [{ trackId: "eng", similarity: 0.2 }],
        versions,
      })
    ).toMatchObject({ cvVersionId: "v-eng-en", language: "en" })
  })

  it("a tie goes to the default version", () => {
    expect(
      recommendCv({
        jobLanguage: "pt-BR",
        trackScores: [
          { trackId: "eng", similarity: 0.5 },
          { trackId: "ops", similarity: 0.5 },
        ],
        versions,
      })
    ).toMatchObject({ cvVersionId: "v-ops-pt", reason: "default_tie" })
  })

  it("falls back to another language when the job language has no CV", () => {
    expect(
      recommendCv({ jobLanguage: "es", trackScores: [], versions }).reason
    ).toBe("language_fallback")
    expect(
      recommendCv({ jobLanguage: "pt-BR", trackScores: [], versions: [] })
        .reason
    ).toBe("none")
  })
})

describe("job text helpers", () => {
  const text = [
    "Sobre a vaga",
    "Liderar o time de plataforma.",
    "Requisitos:",
    "- Experiência com Kubernetes em produção",
    "- Liderança de times de engenharia",
    "Diferenciais",
    "• Terraform",
    "Benefícios",
    "- Vale refeição",
    "Envie seu CV para vagas@empresaficticia.com.br",
  ].join("\n")

  it("splits required and preferred sections", () => {
    expect(splitRequirementSections(text)).toEqual({
      required: [
        "Experiência com Kubernetes em produção",
        "Liderança de times de engenharia",
      ],
      preferred: ["Terraform"],
    })
  })

  it("finds the application e-mail", () => {
    expect(findApplyEmail(text)).toBe("vagas@empresaficticia.com.br")
    expect(findApplyEmail("sem e-mail")).toBeNull()
  })

  it("detects the posting language", () => {
    expect(detectTextLanguage(text)).toBe("pt-BR")
    expect(
      detectTextLanguage(
        "We are looking for an engineer with experience and the team will grow"
      )
    ).toBe("en")
  })
})
