import { describe, expect, it } from "vitest"

import { fakeObjectModel } from "./models.js"
import {
  normalizeParsedCv,
  parseCvStructured,
  type ParsedCv,
} from "./parse-cv.js"

const raw: ParsedCv = {
  contact: {
    name: "  Maria  Silva ",
    email: "maria@example.com",
    phone: null,
    location: null,
    linkedin: null,
  },
  experiences: [
    {
      company: "Acme",
      title: "Analista",
      startMonth: "2020",
      endMonth: "2022-13",
      isCurrent: false,
      description: null,
    },
    {
      company: " ",
      title: "x",
      startMonth: null,
      endMonth: null,
      isCurrent: false,
      description: null,
    },
    {
      company: "Beta",
      title: "Gerente",
      startMonth: "2022-03",
      endMonth: "2024-01",
      isCurrent: true,
      description: "d",
    },
  ],
  education: [
    {
      institution: "USP",
      degree: null,
      field: null,
      level: "graduacao",
      startYear: 1800,
      endYear: 2016,
    },
  ],
  languages: [{ language: "Inglês", level: "avancado" }],
  certifications: [],
  skills: ["SQL", "sql", " Python ", ""],
}

describe("normalizeParsedCv", () => {
  it("trims, drops empty rows, fixes dates and dedupes skills", () => {
    const n = normalizeParsedCv(raw)
    expect(n.contact.name).toBe("Maria Silva")
    expect(n.experiences).toHaveLength(2)
    expect(n.experiences[0]).toMatchObject({
      startMonth: "2020-01",
      endMonth: null,
    })
    expect(n.experiences[1]!.endMonth).toBeNull()
    expect(n.education[0]).toMatchObject({ startYear: null, endYear: 2016 })
    expect(n.skills).toEqual(["SQL", "Python"])
  })
})

describe("parseCvStructured", () => {
  it("uses the injected model and normalizes its output", async () => {
    const result = await parseCvStructured("cv", {
      model: fakeObjectModel(raw),
    })
    expect(result.promptVersion).toBe("parse-cv.v3")
    expect(result.data.skills).toEqual(["SQL", "Python"])
  })
})
