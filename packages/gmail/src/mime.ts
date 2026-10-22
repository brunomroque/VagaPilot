/** Gmail message payload → plain text, kept in memory only for classification (CA11.4). */

export type GmailPayloadPart = {
  mimeType?: string
  body?: { data?: string; size?: number }
  parts?: GmailPayloadPart[]
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8")
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
}

/** Crude but safe HTML → text: drops scripts/styles, turns blocks into line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(
      /&(nbsp|amp|lt|gt|quot|apos|#39);/g,
      (entity) => ENTITIES[entity] ?? " "
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code))
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
}

function findPart(
  part: GmailPayloadPart,
  mimeType: string
): GmailPayloadPart | null {
  if (part.mimeType === mimeType && part.body?.data) return part
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType)
    if (found) return found
  }
  return null
}

/** text/plain when present, otherwise text/html converted to text. */
export function extractPlainText(
  payload: GmailPayloadPart | undefined
): string {
  if (!payload) return ""
  const plain = findPart(payload, "text/plain")
  if (plain?.body?.data) return decodeBase64Url(plain.body.data)
  const html = findPart(payload, "text/html")
  if (html?.body?.data) return htmlToText(decodeBase64Url(html.body.data))
  return payload.body?.data ? decodeBase64Url(payload.body.data) : ""
}
