import { getAiConfig, readJobImage } from "@vagapilot/ai"

import { CvFileError, extractCvText, type CvFileType } from "./cv-files.js"

const OCR_RETRY_CODES = new Set(["no_text", "unreadable"])

/**
 * `extractCvText` plus a multimodal fallback for scanned (image-only) PDFs: when pdf.js finds no
 * text, Gemini transcribes the PDF. In fake mode the original error is kept.
 */
export async function extractCvTextOrOcr(
  bytes: Uint8Array,
  type: CvFileType,
  ocr: (bytes: Uint8Array) => Promise<string> = defaultPdfOcr
): Promise<{ text: string; pages: number | null; ocr: boolean }> {
  try {
    return { ...(await extractCvText(bytes, type)), ocr: false }
  } catch (error) {
    if (
      type !== "pdf" ||
      !(error instanceof CvFileError) ||
      !OCR_RETRY_CODES.has(error.code)
    ) {
      throw error
    }
    let text = ""
    try {
      text = (await ocr(bytes)).trim()
    } catch (ocrError) {
      console.error("pdf OCR fallback failed", {
        reason:
          ocrError instanceof Error
            ? ocrError.message.slice(0, 200)
            : "unknown",
      })
    }
    if (text.length < 20) throw error
    return { text, pages: null, ocr: true }
  }
}

async function defaultPdfOcr(bytes: Uint8Array): Promise<string> {
  if (getAiConfig().mode === "fake") return ""
  const { reading } = await readJobImage({
    bytes,
    mediaType: "application/pdf",
  })
  return reading.text
}
