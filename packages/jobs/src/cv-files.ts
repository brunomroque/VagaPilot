import { createHash } from "node:crypto"

import mammoth from "mammoth"
import { extractText, getDocumentProxy } from "unpdf"

/** Upload limits (spec 10.4: ≤ 10 MB, ≤ 15 pages, PDF/DOCX). */
export const MAX_CV_BYTES = 10 * 1024 * 1024
export const MAX_CV_PAGES = 15

export const CV_MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const

export type CvFileType = keyof typeof CV_MIME_TYPES

export type CvFileErrorCode =
  | "file_too_large"
  | "file_empty"
  | "unsupported_type"
  | "too_many_pages"
  | "no_text"
  | "unreadable"

export class CvFileError extends Error {
  readonly code: CvFileErrorCode

  constructor(code: CvFileErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CvFileError"
    this.code = code
  }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // PK\x03\x04 (DOCX is a zip)

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((value, index) => bytes[index] === value)
}

/**
 * Detects the type from the content (magic bytes), cross-checked with the declared MIME type
 * and extension. Renamed executables and other zips are rejected.
 */
export function detectCvFileType(
  bytes: Uint8Array,
  declared: { name: string; mimeType: string }
): CvFileType {
  if (bytes.byteLength === 0) throw new CvFileError("file_empty", "Empty file")
  if (bytes.byteLength > MAX_CV_BYTES) {
    throw new CvFileError("file_too_large", "File is larger than 10 MB")
  }
  const extension = declared.name.toLowerCase().split(".").pop() ?? ""
  if (startsWith(bytes, PDF_MAGIC) && extension === "pdf") return "pdf"
  if (
    startsWith(bytes, ZIP_MAGIC) &&
    extension === "docx" &&
    (declared.mimeType === CV_MIME_TYPES.docx ||
      declared.mimeType === "application/octet-stream" ||
      declared.mimeType === "")
  ) {
    return "docx"
  }
  throw new CvFileError("unsupported_type", "Only PDF and DOCX are accepted")
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function cvFileTypeFromPath(path: string): CvFileType {
  return path.toLowerCase().endsWith(".docx") ? "docx" : "pdf"
}

/** Plain text of a CV file. PDF via unpdf (pdf.js), DOCX via mammoth. */
export async function extractCvText(
  bytes: Uint8Array,
  type: CvFileType
): Promise<{ text: string; pages: number | null }> {
  try {
    switch (type) {
      case "pdf": {
        const pdf = await getDocumentProxy(new Uint8Array(bytes))
        if (pdf.numPages > MAX_CV_PAGES) {
          throw new CvFileError("too_many_pages", "PDF has more than 15 pages")
        }
        const { text } = await extractText(pdf, { mergePages: true })
        return finish(text, pdf.numPages)
      }
      case "docx": {
        const { value } = await mammoth.extractRawText({
          buffer: Buffer.from(bytes),
        })
        return finish(value, null)
      }
      default: {
        const unreachable: never = type
        throw new Error(`Unhandled CV type: ${String(unreachable)}`)
      }
    }
  } catch (error) {
    if (error instanceof CvFileError) throw error
    throw new CvFileError("unreadable", "Could not read the CV file", {
      cause: error,
    })
  }
}

function finish(
  raw: string,
  pages: number | null
): { text: string; pages: number | null } {
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
  if (text.length < 20) {
    throw new CvFileError("no_text", "No extractable text (scanned PDF?)")
  }
  return { text, pages }
}
