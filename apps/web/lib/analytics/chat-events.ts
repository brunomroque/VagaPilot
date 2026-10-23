"use client"

import posthog from "posthog-js"

export type ChatEntry = "home" | "sheet" | "page"

export function captureChatOpened(entry: ChatEntry) {
  try {
    posthog.capture("chat_opened", { entry })
  } catch {
    /* analytics optional */
  }
}

export function captureChatMessageSent() {
  try {
    posthog.capture("chat_message_sent")
  } catch {
    /* optional */
  }
}

export function captureChatToolCalled(tool: string) {
  try {
    posthog.capture("chat_tool_called", { tool })
  } catch {
    /* optional */
  }
}

export function captureChatWidgetClicked(kind: string, choice: string) {
  try {
    posthog.capture("chat_widget_clicked", { kind, choice })
  } catch {
    /* optional */
  }
}

export function captureApprovalDecided(
  kind: string,
  decision: "aprovada" | "rejeitada"
) {
  try {
    posthog.capture("approval_decided", { kind, decision })
  } catch {
    /* optional */
  }
}

export function captureDeepLinkOpened(screen: string) {
  try {
    posthog.capture("deep_link_opened", { screen })
  } catch {
    /* optional */
  }
}
