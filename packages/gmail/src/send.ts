import { GMAIL_API_BASE } from "./api.js"

export type SendEmailInput = {
  from: string
  to: string[]
  cc?: string[]
  subject: string
  bodyText: string
  /** Raw bytes of the CV attachment. */
  attachment?: { filename: string; mimeType: string; data: Uint8Array }
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

function buildMime(input: SendEmailInput): string {
  const boundary = `vp_${Date.now().toString(36)}`
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    input.attachment
      ? `Content-Type: multipart/mixed; boundary="${boundary}"`
      : "Content-Type: text/plain; charset=UTF-8",
  ]
  if (!input.attachment) {
    return [...headers, "", input.bodyText].join("\r\n")
  }
  const parts = [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.bodyText,
    `--${boundary}`,
    `Content-Type: ${input.attachment.mimeType}; name="${input.attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${input.attachment.filename}"`,
    "",
    Buffer.from(input.attachment.data).toString("base64"),
    `--${boundary}--`,
    "",
  ]
  return parts.join("\r\n")
}

/** Sends via Gmail API users.messages.send (P6.1). */
export async function sendGmailMessage(
  getAccessToken: () => Promise<string>,
  input: SendEmailInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ id: string; threadId: string }> {
  const token = await getAccessToken()
  const raw = encodeBase64Url(buildMime(input))
  const response = await fetchImpl(`${GMAIL_API_BASE}/messages/send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ raw }),
  })
  if (!response.ok) {
    throw new Error(`gmail_send_failed:${response.status}`)
  }
  const json = (await response.json()) as { id?: string; threadId?: string }
  if (!json.id || !json.threadId)
    throw new Error("gmail_send_failed:invalid_response")
  return { id: json.id, threadId: json.threadId }
}
