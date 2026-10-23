import { describe, expect, it } from "vitest"

import {
  classifyAttachmentIntent,
  detectStoredAttachmentKind,
  isAttachmentIntentId,
} from "./chat-attachments.js"

describe("detectStoredAttachmentKind", () => {
  it("detects images and text job docs", () => {
    expect(detectStoredAttachmentKind("print.png", "auto")).toBe("job_image")
    expect(detectStoredAttachmentKind("jd.txt", "auto")).toBe("job_document")
    expect(detectStoredAttachmentKind("cv.pdf", "auto")).toBe(
      "ambiguous_document"
    )
    expect(detectStoredAttachmentKind("cv.pdf", "cv")).toBe("cv")
  })
})

describe("classifyAttachmentIntent", () => {
  it("asks when only CV is attached without text", () => {
    const result = classifyAttachmentIntent("", ["cv"])
    expect(result.mode).toBe("clarify")
    if (result.mode === "clarify") {
      expect(result.options.map((o) => o.id)).toContain("review_cv")
    }
  })

  it("detects explicit compare intent", () => {
    const result = classifyAttachmentIntent("comparar com a vaga", [
      "cv",
      "job_document",
    ])
    expect(result).toEqual({ mode: "explicit", intent: "compare_cv_job" })
  })

  it("auto-analyzes job screenshot", () => {
    const result = classifyAttachmentIntent("", ["job_image"])
    expect(result).toEqual({ mode: "auto", intent: "analyze_job" })
  })

  it("validates intent ids", () => {
    expect(isAttachmentIntentId("review_cv")).toBe(true)
    expect(isAttachmentIntentId("nope")).toBe(false)
  })
})
