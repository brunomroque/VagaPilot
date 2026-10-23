import { describe, expect, it } from "vitest"

import {
  AttachmentError,
  classifyDocumentText,
  detectAttachmentIntent,
  detectAttachmentType,
  MAX_ATTACHMENT_BYTES,
} from "./chat-attachments.js"

const bytes = (...values: number[]) =>
  new Uint8Array([...values, 0, 1, 2, 3, 4, 5, 6, 7])

describe("detectAttachmentType", () => {
  it("accepts matching magic bytes and extension", () => {
    expect(
      detectAttachmentType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), "cv.pdf")
    ).toBe("pdf")
    expect(detectAttachmentType(bytes(0x50, 0x4b, 0x03, 0x04), "cv.docx")).toBe(
      "docx"
    )
    expect(
      detectAttachmentType(bytes(0x89, 0x50, 0x4e, 0x47), "print.png")
    ).toBe("png")
    expect(detectAttachmentType(bytes(0xff, 0xd8, 0xff), "print.jpeg")).toBe(
      "jpg"
    )
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0,
    ])
    expect(detectAttachmentType(webp, "a.webp")).toBe("webp")
    expect(
      detectAttachmentType(
        new TextEncoder().encode("Requisitos: AWS"),
        "vaga.txt"
      )
    ).toBe("txt")
  })
  it("rejects renamed, empty and oversized files", () => {
    expect(() => detectAttachmentType(bytes(0x4d, 0x5a), "cv.pdf")).toThrow(
      AttachmentError
    )
    expect(() =>
      detectAttachmentType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), "cv.exe")
    ).toThrow()
    expect(() => detectAttachmentType(new Uint8Array(), "a.pdf")).toThrow(
      /Empty/
    )
    expect(() =>
      detectAttachmentType(new Uint8Array(MAX_ATTACHMENT_BYTES + 1), "a.pdf")
    ).toThrow(/4 MB/)
    expect(() =>
      detectAttachmentType(new Uint8Array([0x41, 0, 0x42]), "a.txt")
    ).toThrow()
  })
})

describe("classifyDocumentText", () => {
  it("recognizes a CV", () => {
    expect(
      classifyDocumentText(
        "Bruno Silva\nResumo profissional\nExperiência profissional\nACME 2019 - atual\nFormação acadêmica\nCertificações: AWS CCP",
        "meu-cv.pdf"
      )
    ).toBe("cv")
  })
  it("recognizes a job description", () => {
    expect(
      classifyDocumentText(
        "Sobre a vaga\nResponsabilidades: liderar squads\nRequisitos: Kubernetes\nDiferenciais: GCP\nBenefícios: VR\nModelo de trabalho: híbrido"
      )
    ).toBe("job_description")
  })
  it("falls back to document", () => {
    expect(classifyDocumentText("Lista de compras: arroz, feijão")).toBe(
      "document"
    )
  })
})

describe("detectAttachmentIntent", () => {
  const cv = { kind: "cv" as const }
  it("asks when only a CV is attached without instruction", () => {
    const decision = detectAttachmentIntent([cv], "")
    expect(decision.intent).toBe("ask")
    expect(decision.options).toContain("updateProfile")
  })
  it("reads explicit CV intents", () => {
    expect(detectAttachmentIntent([cv], "Revisar este CV").intent).toBe(
      "cv_review"
    )
    expect(
      detectAttachmentIntent([cv], "Atualizar meus dados com este CV").intent
    ).toBe("cv_update_profile")
    expect(
      detectAttachmentIntent([cv], "Salvar como nova versão de CV").intent
    ).toBe("cv_new_version")
    expect(detectAttachmentIntent([cv], "Comparar com uma vaga").intent).toBe(
      "cv_vs_job"
    )
  })
  it("CV plus JD compares, or applies when asked", () => {
    expect(
      detectAttachmentIntent([cv, { kind: "job_description" }], "").intent
    ).toBe("cv_vs_job")
    expect(
      detectAttachmentIntent([cv, { kind: "job_image" }], "quero me candidatar")
        .intent
    ).toBe("apply")
    expect(detectAttachmentIntent([cv], "https://x.com/job/1").intent).toBe(
      "cv_vs_job"
    )
  })
  it("job image with or without link", () => {
    expect(
      detectAttachmentIntent(
        [{ kind: "job_image", url: "https://lnkd.in/x" }],
        ""
      ).intent
    ).toBe("job_link")
    expect(
      detectAttachmentIntent([{ kind: "job_image", url: null }], "").intent
    ).toBe("job_from_image")
    expect(
      detectAttachmentIntent([{ kind: "job_description" }], "").intent
    ).toBe("job_description")
  })
  it("unknown documents ask", () => {
    expect(detectAttachmentIntent([{ kind: "document" }], "").intent).toBe(
      "ask"
    )
  })
})
