import { describe, expect, it } from "vitest"

import { fakeObjectModel } from "./models.js"
import { readJobImage, sanitizeJobImageReading } from "./read-job-image.js"

const base = {
  isJobPosting: true,
  company: "ACME",
  title: "Engineering Manager",
  location: "São Paulo",
  workModel: "Híbrido",
  url: null,
  text: "ACME\nEngineering Manager\nSão Paulo · Híbrido",
}

describe("sanitizeJobImageReading", () => {
  it("keeps a link that appears in the transcription", () => {
    const r = sanitizeJobImageReading({
      ...base,
      url: "https://www.linkedin.com/jobs/view/123",
      text: `${base.text}\nlinkedin.com/jobs/view/123`,
    })
    expect(r.url).toBe("https://www.linkedin.com/jobs/view/123")
  })
  it("drops a link the model invented", () => {
    const r = sanitizeJobImageReading({
      ...base,
      url: "https://acme.com/careers/9",
    })
    expect(r.url).toBeNull()
  })
  it("recovers a link from the text", () => {
    const r = sanitizeJobImageReading({
      ...base,
      text: `${base.text}\nhttps://lnkd.in/abc`,
    })
    expect(r.url).toBe("https://lnkd.in/abc")
  })
})

describe("readJobImage", () => {
  it("returns the structured reading", async () => {
    const { reading } = await readJobImage(
      { bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" },
      { model: fakeObjectModel(base) }
    )
    expect(reading.company).toBe("ACME")
  })
})
