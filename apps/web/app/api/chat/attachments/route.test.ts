import { describe, expect, it } from "vitest"

import {
  classifyAttachmentIntent,
  detectStoredAttachmentKind,
  resolveDocumentRole,
} from "@vagapilot/core/chat-attachments"

describe("chat attachments intent (route contract)", () => {
  it("resolves ambiguous pdf as job when message mentions vaga", () => {
    expect(resolveDocumentRole("descrição da vaga")).toBe("job_document")
    expect(resolveDocumentRole("meu cv")).toBe("cv")
  })

  it("classifies cv-only upload without text as clarify", () => {
    const plan = classifyAttachmentIntent("", ["cv"])
    expect(plan.mode).toBe("clarify")
  })

  it("detects webp job screenshots", () => {
    expect(detectStoredAttachmentKind("linkedin.webp", "auto")).toBe(
      "job_image"
    )
  })
})
