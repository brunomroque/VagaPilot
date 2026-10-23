import { describe, expect, it } from "vitest"

import { fakeClassifyEmail } from "./classify/fake.js"
import {
  acceptLlmCode,
  extractOtp,
  isAllowedLink,
  resolveVerificationLink,
  verificationQuery,
  waitForVerification,
} from "./verification.js"
import type { GmailApi } from "./api.js"

describe("extractOtp", () => {
  it.each([
    ["Seu código de verificação é: 482913", "482913"],
    ["Use the code 7341 to sign in.", "7341"],
    ["Token de acesso\n\n839-201\n\nVálido por 10 minutos", "839201"],
    ["Your one-time code: A7K29Q", "A7K29Q"],
  ])("%s", (text, code) => expect(extractOtp(text)).toBe(code))

  it("ignores years, money, phones and urls", () => {
    expect(
      extractOtp(
        "Processo seletivo 2026. Salário R$ 8500. Ligue (11) 99999-0000. https://x.com/123456"
      )
    ).toBeNull()
  })
  it("returns null on ambiguous candidates", () => {
    expect(extractOtp("Código: 111111\nCódigo: 222222")).toBeNull()
  })
  it("accepts an LLM code only if it is in the e-mail", () => {
    expect(acceptLlmCode("seu pin 99 88 77", "998877")).toBe("998877")
    expect(acceptLlmCode("seu pin 99 88 77", "123456")).toBeNull()
  })
})

describe("verification links", () => {
  const allowed = ["gupy.io"]
  it("allowlists https links of the run's ATS only", () => {
    expect(isAllowedLink("https://acme.gupy.io/confirm?t=1", allowed)).toBe(
      true
    )
    expect(isAllowedLink("http://acme.gupy.io/confirm", allowed)).toBe(false)
    expect(isAllowedLink("https://gupy.io.evil.com/confirm", allowed)).toBe(
      false
    )
    expect(isAllowedLink("https://user@acme.gupy.io/confirm", allowed)).toBe(
      false
    )
  })
  it("unwraps trackers hop by hop and refuses anything off the allowlist", async () => {
    const hops: Record<string, string> = {
      "https://u1.sendgrid.net/ls/click?x":
        "https://acme.gupy.io/activate?t=abc",
      "https://u2.sendgrid.net/ls/click?y":
        "https://phish.example.com/activate",
    }
    const fetch = (async (url: string) =>
      new Response(null, {
        status: 302,
        headers: { location: hops[url] ?? "" },
      })) as unknown as typeof globalThis.fetch
    expect(
      await resolveVerificationLink("https://u1.sendgrid.net/ls/click?x", {
        allowedDomains: allowed,
        fetch,
      })
    ).toBe("https://acme.gupy.io/activate?t=abc")
    expect(
      await resolveVerificationLink("https://u2.sendgrid.net/ls/click?y", {
        allowedDomains: allowed,
        fetch,
      })
    ).toBeNull()
    expect(
      await resolveVerificationLink(
        "https://www.google.com/url?q=https://acme.gupy.io/ok",
        { allowedDomains: allowed, fetch }
      )
    ).toBe("https://acme.gupy.io/ok")
    expect(
      await resolveVerificationLink("https://random.example/x", {
        allowedDomains: allowed,
        fetch,
      })
    ).toBeNull()
  })
})

describe("waitForVerification (fake Gmail)", () => {
  const since = new Date("2026-10-23T12:00:00Z")
  const mail = (id: string, from: string, at: string, body: string) => ({
    id,
    from,
    at,
    body,
  })
  const fakeApi = (mails: ReturnType<typeof mail>[]) =>
    ({
      listMessages: async () => ({
        messages: mails.map((m) => ({ id: m.id })),
      }),
      getMetadata: async (id: string) => {
        const m = mails.find((x) => x.id === id)!
        return {
          from: m.from,
          subject: "Verificação",
          receivedAt: new Date(m.at),
        }
      },
      getBodyText: async (id: string) => mails.find((x) => x.id === id)!.body,
    }) as unknown as GmailApi

  it("builds a sender + time query", () => {
    expect(verificationQuery(["gupy.io"], since)).toBe(
      `(from:gupy.io) after:${since.getTime() / 1000 - 120}`
    )
  })
  it("only accepts fresh codes from the ATS domain, never instructions from others", async () => {
    const api = fakeApi([
      mail(
        "old",
        "Gupy <no-reply@gupy.io>",
        "2026-10-23T11:00:00Z",
        "Seu código é: 111111"
      ),
      mail(
        "spoof",
        "Evil <x@gupy.io.evil.com>",
        "2026-10-23T12:01:00Z",
        "Seu código é: 222222"
      ),
      mail(
        "ok",
        "Gupy <no-reply@mail.gupy.io>",
        "2026-10-23T12:01:30Z",
        "Seu código é: 333333"
      ),
    ])
    const found = await waitForVerification(api, {
      kind: "code",
      domains: ["gupy.io"],
      since,
      timeoutMs: 0,
    })
    expect(found?.value).toBe("333333")
    expect(found?.messageId).toBe("ok")
  })
  it("times out with null", async () => {
    let t = 0
    const found = await waitForVerification(fakeApi([]), {
      kind: "code",
      domains: ["gupy.io"],
      since,
      timeoutMs: 20_000,
      pollMs: 10_000,
      now: () => t,
      sleep: async (ms) => void (t += ms),
    })
    expect(found).toBeNull()
  })
})

describe("classifier fixtures (new classes)", () => {
  const classify = (subject: string, body: string) =>
    fakeClassifyEmail({
      fromName: "RH",
      fromAddress: "rh@empresa.com.br",
      subject,
      body,
      receivedAt: new Date(),
      knownCompanies: ["Empresa"],
    }).class
  it.each([
    [
      "Proposta de trabalho",
      "Temos o prazer de apresentar nossa proposta salarial para a vaga.",
      "proposta",
    ],
    [
      "Envio de documentos",
      "Por favor, envie os documentos para admissão (RG, CPF) até 30/10.",
      "documentos",
    ],
    [
      "Sua candidatura está em análise",
      "Seu perfil está em análise pela nossa equipe.",
      "em_analise",
    ],
  ])("%s", (subject, body, expected) =>
    expect(classify(subject, body)).toBe(expected)
  )
})
