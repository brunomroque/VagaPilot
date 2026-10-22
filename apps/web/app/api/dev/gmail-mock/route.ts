import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import {
  deliverFixtureMessages,
  fixtureMessageSchema,
  isGmailMockEnabled,
} from "@vagapilot/gmail"
import { buildDemoMailbox } from "@vagapilot/gmail/fixtures"

import { getCurrentUser } from "@/lib/auth/session"
import { hasSameOrigin } from "@/lib/gmail/http"
import { getGmailRuntime } from "@/lib/gmail/runtime"
import { apiError } from "@/lib/http"

/**
 * DEV/TEST ONLY: fixture Gmail backend. 404 unless NODE_ENV !== "production" AND
 * VAGAPILOT_GMAIL_MOCK=1. Delivers FICTITIOUS messages into the signed-in user's mock mailbox,
 * as if they had just arrived (the next sync picks them up through history).
 */
const bodySchema = z.union([
  z.object({ preset: z.literal("demo") }),
  z.object({
    messages: z.array(fixtureMessageSchema).min(1).max(50),
    replace: z.boolean().optional(),
  }),
])

export async function GET() {
  if (!isGmailMockEnabled()) return new NextResponse(null, { status: 404 })
  return NextResponse.json({ data: { enabled: true } })
}

export async function POST(request: NextRequest) {
  if (!isGmailMockEnabled()) return new NextResponse(null, { status: 404 })
  if (!hasSameOrigin(request))
    return apiError("invalid_request", "Cross-origin request.", 403)
  const user = await getCurrentUser()
  if (!user) return apiError("unauthorized", "Sign in first.", 401)
  const mailbox = getGmailRuntime()?.mailbox
  if (!mailbox)
    return apiError("not_configured", "Mock mailbox unavailable.", 503)

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return apiError("invalid_request", "Invalid fixture messages.", 400)
  const messages =
    "preset" in parsed.data
      ? buildDemoMailbox(new Date())
      : parsed.data.messages
  const replace =
    "replace" in parsed.data ? Boolean(parsed.data.replace) : false
  const stored = await deliverFixtureMessages(mailbox, user.id, messages, {
    replace,
  })
  return NextResponse.json({
    data: { delivered: messages.length, total: stored.messages.length },
  })
}
