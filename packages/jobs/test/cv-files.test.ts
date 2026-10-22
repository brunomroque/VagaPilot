import { extractFactsFromCv } from "@vagapilot/ai"
import { FICTITIOUS_CV_PT } from "@vagapilot/ai/fixtures"
import { isExcerptInText } from "@vagapilot/core/facts"
import { describe, expect, it } from "vitest"

import {
  CV_MIME_TYPES,
  CvFileError,
  detectCvFileType,
  extractCvText,
  MAX_CV_BYTES,
  sha256Hex,
} from "../src/cv-files.js"
import { textToDocx, textToPdf } from "./fixtures.js"

describe("detectCvFileType", () => {
  it("accepts real PDF and DOCX content", async () => {
    const pdf = await textToPdf("Currículo fictício")
    const docx = await textToDocx("Currículo fictício")
    expect(
      detectCvFileType(pdf, { name: "cv.pdf", mimeType: CV_MIME_TYPES.pdf })
    ).toBe("pdf")
    expect(
      detectCvFileType(docx, { name: "cv.docx", mimeType: CV_MIME_TYPES.docx })
    ).toBe("docx")
  })

  it("rejects renamed files, empty files and files over 10 MB", async () => {
    const pdf = await textToPdf("x")
    expect(() =>
      detectCvFileType(pdf, { name: "cv.docx", mimeType: CV_MIME_TYPES.docx })
    ).toThrow(CvFileError)
    expect(() =>
      detectCvFileType(new TextEncoder().encode("MZ executable"), {
        name: "cv.pdf",
        mimeType: CV_MIME_TYPES.pdf,
      })
    ).toThrow(/Only PDF and DOCX/)
    expect(() =>
      detectCvFileType(new Uint8Array(), { name: "cv.pdf", mimeType: "" })
    ).toThrow(/Empty/)
    const big = new Uint8Array(MAX_CV_BYTES + 1)
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d])
    expect(() =>
      detectCvFileType(big, { name: "cv.pdf", mimeType: CV_MIME_TYPES.pdf })
    ).toThrow(/10 MB/)
  })

  it("hashes content with SHA-256", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
  })
})

describe("extractCvText", () => {
  it("CA2.1 extracts the fictitious CV from a PDF and grounds its facts", async () => {
    const { text, pages } = await extractCvText(
      await textToPdf(FICTITIOUS_CV_PT),
      "pdf"
    )
    expect(pages).toBe(1)
    expect(text).toContain("Empresa Alfa Pagamentos")
    const result = await extractFactsFromCv(text)
    expect(result.experiences).toHaveLength(3)
    expect(result.facts.length).toBeGreaterThanOrEqual(10)
    const grounded = result.facts.filter((fact) =>
      isExcerptInText(fact.excerpt, text)
    )
    expect(grounded.length / result.facts.length).toBeGreaterThanOrEqual(0.9)
  })

  it("extracts text from a DOCX", async () => {
    const { text, pages } = await extractCvText(
      await textToDocx(FICTITIOUS_CV_PT),
      "docx"
    )
    expect(pages).toBeNull()
    expect(text).toContain("Gama Consultoria")
  })

  it("rejects PDFs over 15 pages and files without text", async () => {
    const long = Array.from({ length: 16 * 50 }, (_, i) => `Linha ${i}`).join(
      "\n"
    )
    await expect(
      extractCvText(await textToPdf(long), "pdf")
    ).rejects.toMatchObject({ code: "too_many_pages" })
    await expect(
      extractCvText(await textToPdf(""), "pdf")
    ).rejects.toMatchObject({ code: "no_text" })
    await expect(
      extractCvText(new TextEncoder().encode("%PDF-broken"), "pdf")
    ).rejects.toMatchObject({ code: "unreadable" })
  })
})
