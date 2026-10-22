import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createRestGmailApi, GMAIL_API_BASE, GmailApiError } from "./api.js"
import { htmlToText } from "./mime.js"

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url")

function api(routes: Record<string, { status?: number; json: unknown }>) {
  const urls: string[] = []
  const headers: string[] = []
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      urls.push(url)
      headers.push(new Headers(init?.headers).get("authorization") ?? "")
      const path = url.replace(GMAIL_API_BASE, "").split("?")[0] ?? ""
      const route = routes[path]
      if (!route) return new Response("{}", { status: 404 })
      return new Response(JSON.stringify(route.json), {
        status: route.status ?? 200,
      })
    }
  )
  return {
    client: createRestGmailApi({
      getAccessToken: async () => "token-ficticio",
      fetch: fetchMock as unknown as typeof fetch,
    }),
    urls,
    headers,
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Real network is not allowed in tests")
  })
})
afterEach(() => vi.unstubAllGlobals())

describe("Gmail REST client (mocked Gmail API)", () => {
  it("reads headers and the Gmail snippet without the body (format=metadata)", async () => {
    const { client, urls, headers } = api({
      "/messages/m1": {
        json: {
          id: "m1",
          threadId: "t1",
          snippet: "Olá! Recebemos sua candidatura",
          internalDate: String(Date.parse("2026-10-20T13:00:00Z")),
          payload: {
            headers: [
              { name: "From", value: "Gupy <no-reply@gupy.io>" },
              { name: "Subject", value: "Recebemos sua candidatura" },
            ],
          },
        },
      },
    })
    const meta = await client.getMetadata("m1")
    expect(meta).toEqual({
      id: "m1",
      threadId: "t1",
      from: "Gupy <no-reply@gupy.io>",
      subject: "Recebemos sua candidatura",
      snippet: "Olá! Recebemos sua candidatura",
      receivedAt: new Date("2026-10-20T13:00:00Z"),
    })
    expect(urls[0]).toContain("format=metadata")
    expect(headers[0]).toBe("Bearer token-ficticio")
  })

  it("decodes text/plain bodies and falls back to HTML", async () => {
    const { client } = api({
      "/messages/plain": {
        json: {
          payload: {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/html", body: { data: b64("<p>HTML</p>") } },
              {
                mimeType: "text/plain",
                body: { data: b64("Texto simples ção") },
              },
            ],
          },
        },
      },
      "/messages/html": {
        json: {
          payload: {
            mimeType: "text/html",
            body: {
              data: b64(
                '<style>x{}</style><p>Prazo:&nbsp;25/10</p><a href="https://x.test/t">teste</a>'
              ),
            },
          },
        },
      },
    })
    expect(await client.getBodyText("plain")).toBe("Texto simples ção")
    expect(await client.getBodyText("html")).toBe(
      "Prazo: 25/10\n https://x.test/t teste"
    )
    expect(htmlToText("<script>alert(1)</script>ok")).toBe("ok")
  })

  it("lists history additions, ignoring sent mail, and flags expired history ids", async () => {
    const { client } = api({
      "/history": {
        json: {
          historyId: "900",
          history: [
            { messagesAdded: [{ message: { id: "a", labelIds: ["INBOX"] } }] },
            {
              messagesAdded: [
                { message: { id: "b", labelIds: ["SENT"] } },
                { message: { id: "a" } },
              ],
            },
          ],
        },
      },
    })
    expect(await client.listHistory("100")).toEqual({
      messageIds: ["a"],
      historyId: "900",
      nextPageToken: null,
    })

    const expired = api({ "/history": { status: 404, json: {} } })
    await expect(expired.client.listHistory("1")).rejects.toEqual(
      new GmailApiError("history_expired", 404)
    )
    const unauthorized = api({ "/profile": { status: 401, json: {} } })
    await expect(unauthorized.client.getProfile()).rejects.toMatchObject({
      code: "unauthorized",
    })
  })
})
