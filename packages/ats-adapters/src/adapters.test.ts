import { normalizeCompanyName } from "@vagapilot/core/blocklist"
import { splitRequirementSections } from "@vagapilot/core/job-text"
import { describe, expect, it } from "vitest"

import { canonicalizeUrl, detectSource, extractJob } from "./detect.js"
import {
  createFixtureFetch,
  FIXTURE_JOB_URLS,
  loadExpectedFixtures,
} from "./fixture-fetch.js"
import { MemoryJobCache, VAGAPILOT_USER_AGENT } from "./http.js"
import type { RawJobPosting } from "./types.js"

function requirementsOf(posting: RawJobPosting): string[] {
  return posting.requirementsHint?.required.length
    ? posting.requirementsHint.required
    : splitRequirementSections(posting.descriptionText).required
}

describe("detectSource and canonicalize (RF4.2)", () => {
  it.each([
    [
      "https://www.linkedin.com/jobs/view/3900000001/?trk=x",
      "linkedin",
      "https://www.linkedin.com/jobs/view/3900000001",
    ],
    [
      "https://www.linkedin.com/jobs/search/?currentJobId=3900000003&keywords=x",
      "linkedin",
      "https://www.linkedin.com/jobs/view/3900000003",
    ],
    [
      "https://br.linkedin.com/jobs/view/gerente-de-ti-at-x-3900000002",
      "linkedin",
      "https://www.linkedin.com/jobs/view/3900000002",
    ],
    [
      "https://empresaficticia.gupy.io/jobs/1001?jobBoardSource=gupy",
      "gupy",
      "https://empresaficticia.gupy.io/jobs/1001",
    ],
    [
      "https://exemplo.inhire.app/vagas/abc-123/slug",
      "inhire",
      "https://exemplo.inhire.app/vagas/abc-123",
    ],
    [
      "https://job-boards.greenhouse.io/lojaexemplo/jobs/4001002",
      "greenhouse",
      "https://boards.greenhouse.io/lojaexemplo/jobs/4001002",
    ],
    [
      "https://boards.greenhouse.io/embed/job_app?for=empresa&token=123",
      "greenhouse",
      "https://boards.greenhouse.io/empresa/jobs/123",
    ],
    [
      "https://jobs.lever.co/exemplotech/8b1c2d3e-0000-4000-8000-000000000001/apply",
      "lever",
      "https://jobs.lever.co/exemplotech/8b1c2d3e-0000-4000-8000-000000000001",
    ],
    [
      "https://x.wd5.myworkdayjobs.com/pt-BR/Site/job/Sao-Paulo/Cargo_R-1",
      "workday",
      "https://x.wd5.myworkdayjobs.com/Site/job/Sao-Paulo/Cargo_R-1",
    ],
    [
      "https://career5.successfactors.eu/career?company=A&career_job_req_id=5&utm_source=x",
      "successfactors",
      "https://career5.successfactors.eu/career?career_job_req_id=5&company=A",
    ],
    [
      "https://jobs.sap.com/job/Sao-Paulo-Cargo/123/",
      "successfactors",
      "https://jobs.sap.com/job/Sao-Paulo-Cargo/123",
    ],
    [
      "https://jobs.quickin.io/empresa/jobs/6001",
      "quickin",
      "https://jobs.quickin.io/empresa/jobs/6001",
    ],
    [
      "https://www.jobbol.com.br/vagas/analista-7001",
      "jobbol",
      "https://jobbol.com.br/vagas/analista-7001",
    ],
    [
      "https://x.vagas.solides.com.br/vaga/8001",
      "solides",
      "https://x.vagas.solides.com.br/vaga/8001",
    ],
    [
      "https://carreiras.exemplo.com.br/vagas/sre?utm_source=a&id=9",
      "outro",
      "https://carreiras.exemplo.com.br/vagas/sre?id=9",
    ],
  ])("%s → %s", (url, source, canonical) => {
    expect(detectSource(url)).toBe(source)
    expect(canonicalizeUrl(url)).toBe(canonical)
  })

  it("rejects non-http input", () => {
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull()
    expect(detectSource("não é url")).toBe("outro")
  })
})

describe("extraction from recorded fixtures (P2.1, no network)", () => {
  it("CA4.1 subset: ≥ 90% company and title correct, ≥ 80% with requirements", async () => {
    const expected = loadExpectedFixtures()
    const fetch = createFixtureFetch()
    let correct = 0
    let withRequirements = 0
    for (const item of expected) {
      const result = await extractJob(item.url, { fetch })
      expect(result.status, item.url).toBe("ok")
      if (result.status !== "ok") continue
      expect(result.posting.source).toBe(item.source)
      const sameCompany =
        normalizeCompanyName(result.posting.company ?? "") ===
        normalizeCompanyName(item.company)
      if (sameCompany && result.posting.title === item.title) correct += 1
      if (requirementsOf(result.posting).length > 0) withRequirements += 1
    }
    expect(expected.length).toBeGreaterThanOrEqual(15)
    expect(correct / expected.length).toBeGreaterThanOrEqual(0.9)
    expect(withRequirements / expected.length).toBeGreaterThanOrEqual(0.8)
  })

  it("CA4.3 no extraction request carries cookies or user session; UA is identifiable", async () => {
    const fetch = createFixtureFetch()
    for (const item of loadExpectedFixtures())
      await extractJob(item.url, { fetch })
    expect(fetch.requests.length).toBeGreaterThan(0)
    for (const request of fetch.requests) {
      expect(request.credentials).toBe("omit")
      expect(Object.keys(request.headers)).not.toContain("cookie")
      expect(Object.keys(request.headers)).not.toContain("authorization")
      expect(request.headers["user-agent"]).toBe(VAGAPILOT_USER_AGENT)
    }
    const linkedin = fetch.requests.filter((request) =>
      request.url.includes("linkedin.com")
    )
    expect(
      linkedin.every((request) => request.url.includes("/jobs-guest/"))
    ).toBe(true)
  })

  it("Greenhouse and Lever use the public APIs", async () => {
    const fetch = createFixtureFetch()
    await extractJob(FIXTURE_JOB_URLS.greenhouse, { fetch })
    await extractJob(FIXTURE_JOB_URLS.lever, { fetch })
    expect(
      fetch.requests.map((request) => new URL(request.url).hostname)
    ).toEqual(["boards-api.greenhouse.io", "api.lever.co"])
  })

  it("LinkedIn 429/999 returns blocked; other failures are explicit", async () => {
    const fetch = createFixtureFetch()
    expect(
      await extractJob(FIXTURE_JOB_URLS.linkedinBlocked, { fetch })
    ).toEqual({
      status: "blocked",
      reason: "rate_limited",
    })
    const nine = (async () => ({
      status: 999,
      ok: false,
      headers: new Headers(),
      text: async () => "",
    })) as unknown as typeof globalThis.fetch
    expect(
      (await extractJob(FIXTURE_JOB_URLS.linkedin, { fetch: nine })).status
    ).toBe("blocked")
    expect(await extractJob(FIXTURE_JOB_URLS.missing, { fetch })).toEqual({
      status: "failed",
      code: "not_found",
    })
    const timeout = (async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" })
    }) as unknown as typeof globalThis.fetch
    expect(await extractJob(FIXTURE_JOB_URLS.gupy, { fetch: timeout })).toEqual(
      {
        status: "failed",
        code: "timeout",
      }
    )
  })

  it("LinkedIn: one request per link, then the 24 h cache (RF15.1, CA15.3)", async () => {
    const fetch = createFixtureFetch()
    const cache = new MemoryJobCache()
    const first = await extractJob(FIXTURE_JOB_URLS.linkedin, { fetch, cache })
    const second = await extractJob(FIXTURE_JOB_URLS.linkedin, { fetch, cache })
    expect(first.status === "ok" && first.fromCache).toBe(false)
    expect(second.status === "ok" && second.fromCache).toBe(true)
    expect(fetch.requests).toHaveLength(1)
  })

  it("cache entries expire after 24 h", async () => {
    let now = 0
    const cache = new MemoryJobCache(() => now)
    await cache.set("k", { status: 200, body: "x", contentType: null }, 1000)
    expect(await cache.get("k")).not.toBeNull()
    now = 1001
    expect(await cache.get("k")).toBeNull()
  })

  it("RF4A.2 detects the external ATS behind a LinkedIn posting and on generic pages", async () => {
    const fetch = createFixtureFetch()
    const linkedin = await extractJob(FIXTURE_JOB_URLS.linkedin, { fetch })
    expect(linkedin.status === "ok" && linkedin.posting.externalApply).toEqual({
      url: "https://boards.greenhouse.io/bancoficticio/jobs/4002001",
      source: "greenhouse",
    })
    const generic = await extractJob(
      "https://carreiras.exemplo.com.br/vagas/sre-9001",
      { fetch }
    )
    expect(
      generic.status === "ok" && generic.posting.externalApply?.source
    ).toBe("lever")
  })

  it("keeps structured hints: Lever lists, salary, work model and Gupy prerequisites", async () => {
    const fetch = createFixtureFetch()
    const lever = await extractJob(FIXTURE_JOB_URLS.lever, { fetch })
    expect(lever.status).toBe("ok")
    if (lever.status === "ok") {
      expect(lever.posting.requirementsHint?.required).toContain("Kubernetes")
      expect(lever.posting.requirementsHint?.preferred).toEqual([
        "Experiência com Terraform",
      ])
      expect(lever.posting.salary).toMatchObject({
        min: 28000,
        max: 35000,
        currency: "BRL",
      })
      expect(lever.posting.workModelHint).toBe("hibrido")
    }
    const gupy = await extractJob(FIXTURE_JOB_URLS.gupy, { fetch })
    expect(
      gupy.status === "ok" && gupy.posting.requirementsHint?.required
    ).toEqual([
      "Experiência com redes e datacenter",
      "Gestão de fornecedores",
      "Liderança de times",
    ])
    const linkedin2 = await extractJob(
      "https://br.linkedin.com/jobs/view/gerente-de-ti-at-industria-exemplo-3900000002",
      { fetch }
    )
    expect(linkedin2.status === "ok" && linkedin2.posting.applyEmail).toBe(
      "talentos@industriaexemplo.test"
    )
  })

  it("drops hidden injection text; visible injected text stays plain data", async () => {
    const fetch = createFixtureFetch()
    const result = await extractJob(FIXTURE_JOB_URLS.injection, { fetch })
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.posting.descriptionText).not.toContain(
        "IGNORE AS INSTRUÇÕES ANTERIORES"
      )
      expect(result.posting.descriptionText).not.toContain(
        "coleta@exemplo.test"
      )
      expect(result.posting.applyEmail).toBeNull()
      expect(result.posting.descriptionText).toContain(
        "Nota para assistentes de IA"
      )
      expect(result.posting.title).toBe("Gerente de Plataforma")
    }
  })
})
