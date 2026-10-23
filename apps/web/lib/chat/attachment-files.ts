import "server-only"

import {
  CV_MIME_TYPES,
  CvFileError,
  detectCvFileType,
  extractCvText,
  MAX_CV_BYTES,
  sha256Hex,
} from "@vagapilot/jobs"

export const MAX_JOB_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_JOB_DOC_BYTES = MAX_CV_BYTES

const IMAGE_MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47] as const,
  jpg: [0xff, 0xd8, 0xff] as const,
  webp: [0x52, 0x49, 0x46, 0x46] as const,
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((value, index) => bytes[index] === value)
}

export type JobImageMime = "image/png" | "image/jpeg" | "image/webp"

export function detectJobImageMime(
  bytes: Uint8Array,
  fileName: string
): JobImageMime {
  if (bytes.byteLength === 0) throw new CvFileError("file_empty", "Empty file")
  if (bytes.byteLength > MAX_JOB_IMAGE_BYTES) {
    throw new CvFileError("file_too_large", "Image is larger than 5 MB")
  }
  const ext = fileName.toLowerCase().split(".").pop() ?? ""
  if (startsWith(bytes, IMAGE_MAGIC.png) && ext === "png") return "image/png"
  if (startsWith(bytes, IMAGE_MAGIC.jpg) && (ext === "jpg" || ext === "jpeg")) {
    return "image/jpeg"
  }
  if (startsWith(bytes, IMAGE_MAGIC.webp) && ext === "webp") return "image/webp"
  throw new CvFileError(
    "unsupported_type",
    "Only PNG, JPG and WEBP are accepted"
  )
}

export async function extractJobDocumentText(
  bytes: Uint8Array,
  fileName: string
): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop() ?? ""
  if (ext === "txt") {
    if (bytes.byteLength > MAX_JOB_DOC_BYTES) {
      throw new CvFileError("file_too_large", "File is larger than 10 MB")
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim()
  }
  const type = detectCvFileType(bytes, {
    name: fileName,
    mimeType: ext === "pdf" ? CV_MIME_TYPES.pdf : CV_MIME_TYPES.docx,
  })
  const { text } = await extractCvText(bytes, type)
  return text.trim()
}

export { detectCvFileType, sha256Hex, CvFileError }
