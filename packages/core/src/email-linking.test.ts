import { describe, expect, it } from "vitest"

import {
  LINK_MIN_SCORE,
  linkEmailToApplication,
  type LinkableApplication,
  type LinkableEmail,
} from "./email-linking.js"

const applications: LinkableApplication[] = [
  {
    id: "loft",
    company: "Loft",
    roleTitle: "Gerente de Plataforma",
    status: "enviada",
    link: "https://loft.inhire.app/vagas/88123",
    appliedAt: "2026-10-10T12:00:00Z",
    createdAt: "2026-10-09T12:00:00Z",
  },
  {
    id: "alfa-eng",
    company: "Empresa Fictícia Alfa Ltda.",
    roleTitle: "Engineering Manager",
    status: "em_analise",
    link: "https://boards.greenhouse.io/alfa/jobs/4567890",
    appliedAt: "2026-10-01T12:00:00Z",
    createdAt: "2026-10-01T12:00:00Z",
  },
  {
    id: "alfa-data",
    company: "Empresa Fictícia Alfa",
    roleTitle: "Head de Dados",
    status: "enviada",
    link: null,
    appliedAt: "2026-10-02T12:00:00Z",
    createdAt: "2026-10-02T12:00:00Z",
  },
]

function email(overrides: Partial<LinkableEmail>): LinkableEmail {
  return {
    fromName: null,
    fromDomain: "gupy.io",
    subject: "",
    text: "",
    receivedAt: new Date("2026-10-20T12:00:00Z"),
    ...overrides,
  }
}

describe("linkEmailToApplication (P4.2)", () => {
  it("links by normalized company and role from an ATS sender", () => {
    const result = linkEmailToApplication(
      email({
        fromDomain: "inhire.app",
        subject: "Loft | Atualização da sua candidatura",
        company: "Loft S.A.",
        role: "Gerente de Plataforma",
      }),
      applications
    )
    expect(result).toMatchObject({ applicationId: "loft", ambiguous: false })
    expect(result.score).toBeGreaterThanOrEqual(0.8)
  })

  it("links by the company's own sender domain", () => {
    const result = linkEmailToApplication(
      email({
        fromName: "Talentos",
        fromDomain: "loft.com.br",
        subject: "Próximos passos",
      }),
      applications
    )
    expect(result.applicationId).toBe("loft")
  })

  it("uses the job code to separate two roles at the same company", () => {
    const result = linkEmailToApplication(
      email({
        fromDomain: "greenhouse.io",
        subject: "Empresa Fictícia Alfa: next steps",
        text: "Regarding job 4567890, we would like to schedule an interview.",
        company: "Empresa Fictícia Alfa",
      }),
      applications
    )
    expect(result).toMatchObject({
      applicationId: "alfa-eng",
      ambiguous: false,
    })
  })

  it("RF11.3a marks two equally likely applications as ambiguous", () => {
    const result = linkEmailToApplication(
      email({
        subject: "Empresa Fictícia Alfa - retorno",
        company: "Empresa Fictícia Alfa",
      }),
      applications
    )
    expect(result.ambiguous).toBe(true)
    expect(result.applicationId).toBeNull()
    expect(
      result.candidates.map((candidate) => candidate.applicationId).sort()
    ).toEqual(["alfa-data", "alfa-eng"])
  })

  it("ignores e-mails sent long before the application (date window)", () => {
    const result = linkEmailToApplication(
      email({
        subject: "Loft | candidatura",
        company: "Loft",
        receivedAt: new Date("2026-09-01T12:00:00Z"),
      }),
      applications
    )
    expect(result.applicationId).toBeNull()
  })

  it("returns no link when nothing matches", () => {
    const result = linkEmailToApplication(
      email({ subject: "Newsletter de vagas", company: "Outra Empresa" }),
      applications
    )
    expect(result).toEqual({
      applicationId: null,
      score: 0,
      ambiguous: false,
      candidates: [],
    })
    expect(LINK_MIN_SCORE).toBeGreaterThan(0)
  })
})
