import { describe, expect, it } from "vitest"

import { extractCvTextOrOcr } from "./cv-ocr.js"

// "%PDF-" header but no text layer: pdf.js fails or finds nothing.
const scanned = new TextEncoder().encode("%PDF-1.4\n%garbage\n")

describe("extractCvTextOrOcr", () => {
  it("falls back to OCR for a PDF without text", async () => {
    const text =
      "Fulano de Tal\nExperiência profissional\nAccenture 2019 - atual"
    const result = await extractCvTextOrOcr(scanned, "pdf", async () => text)
    expect(result).toMatchObject({ text, ocr: true })
  })
  it("keeps the original error when OCR has nothing", async () => {
    await expect(
      extractCvTextOrOcr(scanned, "pdf", async () => "")
    ).rejects.toMatchObject({ name: "CvFileError" })
  })
})
