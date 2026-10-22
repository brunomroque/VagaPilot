import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  createFixtureFetch,
  FIXTURE_JOB_URLS,
} from "@vagapilot/ats-adapters/fixtures"
import { createEmbedder } from "@vagapilot/ai"
import { InMemoryAuditSink } from "@vagapilot/core/audit"
import { resolveLocalSupabase } from "@vagapilot/db/testing"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { processJobIngestion, type IngestDeps } from "../src/ingest.js"
import { dueSearches, previewSearch, runSavedSearch } from "../src/searches.js"

const local = await resolveLocalSupabase()
if (!local.ok) {
  if (process.env.VAGAPILOT_REQUIRE_SUPABASE === "1") {
    throw new Error(`[jobs] VAGAPILOT_REQUIRE_SUPABASE=1 but ${local.reason}`)
  }
  console.warn(
    `\n[jobs] SKIPPED — job/ingest.requested integration did not run: ${local.reason}\n`
  )
}

type MatchRow = {
  id: string
  fit: string | null
  blocked: boolean
  reasons: { factIds: string[] }[]
  alerts: { code: string }[]
  duplicate_check: { status: string; appliedAt?: string | null }
  suggested_salary: { status: string; rule?: { target: number } }
  recommended_cv_version_id: string | null
  model_version: string | null
  prompt_version: string | null
}

describe.skipIf(!local.ok)(
  "job/ingest.requested (inline fallback) on local Supabase",
  () => {
    let admin: SupabaseClient
    let userId = ""
    let factId = ""
    let cvVersionId = ""
    let deps: IngestDeps
    const audit = new InMemoryAuditSink()

    async function ingest(input: { url?: string; text?: string }) {
      const batchId = randomUUID()
      const { data, error } = await admin
        .from("job_ingestions")
        .insert({
          user_id: userId,
          batch_id: batchId,
          input_url: input.url ?? null,
          input_text: input.text ?? null,
        })
        .select("id")
        .single<{ id: string }>()
      if (error || !data) throw new Error(error?.message)
      return processJobIngestion(deps, { userId, ingestionId: data.id })
    }

    async function match(id: string | null): Promise<MatchRow> {
      const { data } = await admin
        .from("job_matches")
        .select("*")
        .eq("id", id ?? "")
        .single<MatchRow>()
      if (!data) throw new Error("match not found")
      return data
    }

    beforeAll(async () => {
      if (!local.ok) return
      admin = createClient(local.env.url, local.env.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const created = await admin.auth.admin.createUser({
        email: `jobs-p2+${randomUUID()}@vagapilot.test`,
        password: "Ficticia#2026",
        email_confirm: true,
      })
      if (!created.data.user) throw new Error(created.error?.message)
      userId = created.data.user.id
      const embedder = createEmbedder()

      await admin.from("candidate_profiles").insert({
        user_id: userId,
        display_name: "Pessoa Fictícia P2",
        city: "São Paulo",
        preferences: {
          workModels: ["hibrido", "remoto"],
          regimes: ["clt"],
          cities: ["São Paulo"],
        },
      })
      await admin
        .from("languages")
        .insert({ user_id: userId, language: "Inglês", level: "intermediario" })
      await admin.from("salary_rules").insert({
        user_id: userId,
        seniority: "gerente",
        regime: "clt",
        amount_target: 32000,
      })
      const statement =
        "Liderei a migração de 40 serviços para Kubernetes em produção"
      const fact = await admin
        .from("confirmed_facts")
        .insert({
          user_id: userId,
          statement,
          kind: "conquista",
          status: "confirmado",
          source: "manual",
          embedding: JSON.stringify(await embedder.embed(statement)),
        })
        .select("id")
        .single<{ id: string }>()
      factId = fact.data?.id ?? ""
      const proposed = "Certificação PMP em gestão de projetos"
      await admin.from("confirmed_facts").insert({
        user_id: userId,
        statement: proposed,
        kind: "certificacao",
        status: "proposto",
        source: "cv_upload",
        embedding: JSON.stringify(await embedder.embed(proposed)),
      })
      const track = await admin
        .from("cv_tracks")
        .insert({
          user_id: userId,
          name: "Plataforma",
          keywords: ["kubernetes", "plataforma"],
        })
        .select("id")
        .single<{ id: string }>()
      const version = await admin
        .from("cv_versions")
        .insert({
          user_id: userId,
          track_id: track.data?.id,
          language: "pt-BR",
          label: "Plataforma",
          is_default: true,
          storage_path: `${userId}/plataforma.pdf`,
          file_sha256: "0".repeat(64),
          origin: "upload",
        })
        .select("id")
        .single<{ id: string }>()
      cvVersionId = version.data?.id ?? ""
      deps = {
        admin,
        audit,
        fetchCtx: { fetch: createFixtureFetch() },
        embedder,
        searchGmailDuplicates: async () => ({ status: "not_connected" }),
      }
    })

    afterAll(async () => {
      if (!local.ok || !userId) return
      await admin.from("job_ingestions").delete().eq("user_id", userId)
      await admin.from("applications").delete().eq("user_id", userId)
      await admin.from("job_matches").delete().eq("user_id", userId)
      await admin.auth.admin.deleteUser(userId)
    })

    it("CA4.1 end to end: posting upserted by canonical URL, match with fit, CV, salary and versions", async () => {
      const result = await ingest({
        url: `${FIXTURE_JOB_URLS.greenhouse}?gh_src=x`,
      })
      expect(result.status).toBe("concluida")
      const posting = await admin
        .from("job_postings")
        .select("*")
        .eq("id", result.jobPostingId ?? "")
        .single()
      expect(posting.data).toMatchObject({
        canonical_url: FIXTURE_JOB_URLS.greenhouse,
        company: "Empresa Fictícia Pagamentos",
        title: "Engineering Manager, Plataforma",
        seniority: "gerente",
        work_model: "hibrido",
      })
      const row = await match(result.jobMatchId)
      expect(row.fit).not.toBeNull()
      expect(row.recommended_cv_version_id).toBe(cvVersionId)
      expect(row.suggested_salary.status).toBe("rule")
      expect(row.suggested_salary.rule?.target).toBe(32000)
      expect(row.model_version).toContain("vagapilot-fake-v1")
      expect(row.prompt_version).toBe("extract-job.v1 + assess-fit.v1")
      expect(audit.records.map((record) => record.action)).toEqual(
        expect.arrayContaining(["job.ingested", "match.created"])
      )
    })

    it("P2.3 reasons cite only confirmed facts; CA6.2 language alert from code", async () => {
      const result = await ingest({ url: FIXTURE_JOB_URLS.greenhouse })
      const row = await match(result.jobMatchId)
      const cited = row.reasons.flatMap((reason) => reason.factIds)
      expect(cited.length).toBeGreaterThan(0)
      expect(cited.every((id) => id === factId)).toBe(true)
      expect(row.alerts.map((alert) => alert.code)).toContain("idioma")
    })

    it("RF4.5 the same link from two users shares one posting", async () => {
      const before = await admin
        .from("job_postings")
        .select("id")
        .eq("canonical_url", FIXTURE_JOB_URLS.greenhouse)
      await ingest({ url: FIXTURE_JOB_URLS.greenhouse })
      const after = await admin
        .from("job_postings")
        .select("id")
        .eq("canonical_url", FIXTURE_JOB_URLS.greenhouse)
      expect(after.data).toHaveLength(1)
      expect(after.data?.[0]?.id).toBe(before.data?.[0]?.id)
    })

    it("CA4.2 a blocked or missing page ends with a code the chat turns into 'cole o texto'", async () => {
      expect(
        await ingest({ url: FIXTURE_JOB_URLS.linkedinBlocked })
      ).toMatchObject({
        status: "bloqueada",
        errorCode: "rate_limited",
      })
      expect(await ingest({ url: FIXTURE_JOB_URLS.missing })).toMatchObject({
        status: "falhou",
        errorCode: "not_found",
      })
      const pasted = await ingest({
        url: FIXTURE_JOB_URLS.missing,
        text: "Gerente de Engenharia\nEmpresa Fictícia\nRequisitos\n- Kubernetes\n- Liderança de times",
      })
      expect(pasted.status).toBe("concluida")
    })

    it("CA5.1 pasting a link already applied to returns ja_aplicado with the date", async () => {
      const appliedAt = "2026-09-01T10:00:00.000Z"
      await admin.from("applications").insert({
        user_id: userId,
        company: "Loja Exemplo",
        role_title: "Senior Backend Engineer",
        source: "greenhouse",
        status: "enviada",
        applied_at: appliedAt,
        link: "https://job-boards.greenhouse.io/lojaexemplo/jobs/4001002",
      })
      const result = await ingest({ url: FIXTURE_JOB_URLS.greenhouseEn })
      const row = await match(result.jobMatchId)
      expect(row.duplicate_check.status).toBe("ja_aplicado")
      expect(row.duplicate_check.appliedAt).toContain("2026-09-01")
    })

    it("RF6.4 a blocked company is skipped without analysis", async () => {
      await admin.from("excluded_companies").insert({
        user_id: userId,
        company_name: "Empresa Fictícia Varejo",
        normalized_name: "empresa ficticia varejo",
      })
      const result = await ingest({ url: FIXTURE_JOB_URLS.gupy })
      const row = await match(result.jobMatchId)
      expect(row.blocked).toBe(true)
      expect(row.fit).toBeNull()
    })

    it("RF4A.3 saved search previews and delivers new postings once, as a batch with fit", async () => {
      const search = await admin
        .from("saved_searches")
        .insert({
          user_id: userId,
          query: "Engineering Manager",
          frequency: "diaria",
        })
        .select("id")
        .single<{ id: string }>()
      const preview = await previewSearch({ admin }, userId, {
        query: "Engineering Manager",
        seniority: null,
        location: null,
        radiusKm: null,
        workModel: null,
        regime: null,
        language: null,
        salaryMin: null,
        salaryMax: null,
        postedWithinDays: null,
        excludedCompanies: [],
        frequency: "diaria",
        timeOfDay: null,
      })
      expect(
        preview.some((item) => item.title === "Engineering Manager, Plataforma")
      ).toBe(true)
      expect(preview.every((item) => item.fit !== undefined)).toBe(true)

      const first = await runSavedSearch(
        { admin },
        { userId, savedSearchId: search.data?.id ?? "" }
      )
      expect(first.delivered).toBeGreaterThan(0)
      const second = await runSavedSearch(
        { admin },
        { userId, savedSearchId: search.data?.id ?? "" }
      )
      expect(second.delivered).toBe(0)
      const due = await dueSearches(admin, new Date(), userId)
      expect(
        due.find((item) => item.savedSearchId === search.data?.id)
      ).toBeUndefined()
    })
  }
)
