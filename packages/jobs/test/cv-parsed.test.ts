import { describe, expect, it } from "vitest"

import { computeProfileDiff } from "../src/cv-parsed.js"

const parsed = {
  contact: {
    name: null,
    email: null,
    phone: null,
    location: null,
    linkedin: null,
  },
  experiences: [
    {
      company: "Acme Ltda",
      title: "Analista",
      startMonth: "2020-01",
      endMonth: null,
      isCurrent: true,
      description: null,
    },
    {
      company: "Beta",
      title: "Gerente",
      startMonth: "2018-01",
      endMonth: "2019-12",
      isCurrent: false,
      description: null,
    },
  ],
  education: [
    {
      institution: "USP",
      degree: "Bacharelado",
      field: null,
      level: "graduacao" as const,
      startYear: null,
      endYear: 2016,
    },
  ],
  languages: [
    { language: "Inglês", level: "avancado" as const },
    { language: "Espanhol", level: "basico" as const },
  ],
  certifications: [
    { name: "AWS Solutions Architect", issuer: null, year: null },
  ],
  skills: ["SQL", "Kubernetes"],
}

describe("computeProfileDiff", () => {
  it("lists only what the profile lacks, with stable keys", () => {
    const diff = computeProfileDiff(parsed, {
      experiences: [{ company: "Acme", title: "analista" }],
      educations: [{ institution: "usp" }],
      languages: [{ language: "Ingles" }],
      factStatements: ["Domínio de SQL avançado"],
    })
    expect(diff.map((d) => d.kind).sort()).toEqual(
      ["certification", "experience", "language", "skill"].sort()
    )
    expect(diff.find((d) => d.kind === "experience")!.value).toMatchObject({
      company: "Beta",
    })
    expect(diff.find((d) => d.kind === "skill")!.value).toEqual({
      name: "Kubernetes",
    })
    expect(new Set(diff.map((d) => d.key)).size).toBe(diff.length)
    expect(
      computeProfileDiff(parsed, {
        experiences: [],
        educations: [],
        languages: [],
        factStatements: [],
      })
    ).toHaveLength(8)
  })
})
