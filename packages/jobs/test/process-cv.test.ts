import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { FICTITIOUS_CV_PT } from "@vagapilot/ai/fixtures"
import { SupabaseAuditSink } from "@vagapilot/db/server"
import { resolveLocalSupabase } from "@vagapilot/db/testing"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sha256Hex } from "../src/cv-files.js"
import { processCvUpload } from "../src/process-cv.js"
import { textToPdf } from "./fixtures.js"

const local = await resolveLocalSupabase()
if (!local.ok) {
  if (process.env.VAGAPILOT_REQUIRE_SUPABASE === "1") {
    throw new Error(`[jobs] VAGAPILOT_REQUIRE_SUPABASE=1 but ${local.reason}`)
  }
  console.warn(
    `\n[jobs] SKIPPED — cv/uploaded integration did not run: ${local.reason}\n`
  )
}

type FactRow = {
  status: string
  source: string
  experience_id: string | null
  source_ref: { cv_version_id: string; excerpt: string } | null
  embedding: string | null
}

describe.skipIf(!local.ok)(
  "cv/uploaded job (inline fallback) on local Supabase",
  () => {
    let admin: SupabaseClient
    let userId = ""
    let experienceId = ""
    const cvVersionId = randomUUID()

    beforeAll(async () => {
      if (!local.ok) return
      admin = createClient(local.env.url, local.env.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const created = await admin.auth.admin.createUser({
        email: `jobs+${randomUUID()}@vagapilot.test`,
        password: "Ficticia#2026",
        email_confirm: true,
      })
      if (!created.data.user) throw new Error(created.error?.message)
      userId = created.data.user.id

      const experience = await admin
        .from("experiences")
        .insert({
          user_id: userId,
          company: "Empresa Alfa Pagamentos Ltda.",
          title: "Engenheira de Software Sênior",
          employment_type: "clt",
          start_date: "2021-03-01",
          is_current: true,
        })
        .select("id")
        .single<{ id: string }>()
      experienceId = experience.data?.id ?? ""

      const pdf = await textToPdf(FICTITIOUS_CV_PT)
      const path = `${userId}/${cvVersionId}.pdf`
      const upload = await admin.storage
        .from("cvs")
        .upload(
          path,
          new Blob([new Uint8Array(pdf)], { type: "application/pdf" })
        )
      if (upload.error) throw new Error(upload.error.message)
      const version = await admin.from("cv_versions").insert({
        id: cvVersionId,
        user_id: userId,
        language: "pt-BR",
        label: "Engenharia",
        storage_path: path,
        file_sha256: sha256Hex(pdf),
        origin: "upload",
      })
      if (version.error) throw new Error(version.error.message)
    })

    afterAll(async () => {
      if (!userId) return
      await admin.storage.from("cvs").remove([`${userId}/${cvVersionId}.pdf`])
      await admin.auth.admin.deleteUser(userId)
    })

    it("CA2.1 stores the text and proposes grounded facts with source_ref and embeddings", async () => {
      const deps = { admin, audit: new SupabaseAuditSink(admin) }
      const result = await processCvUpload(deps, { userId, cvVersionId })
      expect(result.text.status).toBe("ok")
      expect(result.facts?.proposed).toBeGreaterThanOrEqual(10)

      const version = await admin
        .from("cv_versions")
        .select("extracted_text")
        .eq("id", cvVersionId)
        .single<{ extracted_text: string }>()
      expect(version.data?.extracted_text).toContain("Gama Consultoria")

      const facts = await admin
        .from("confirmed_facts")
        .select("status, source, experience_id, source_ref, embedding")
        .eq("user_id", userId)
      const rows = (facts.data ?? []) as FactRow[]
      expect(rows.length).toBe(result.facts?.proposed)
      expect(rows.every((row) => row.status === "proposto")).toBe(true)
      expect(rows.every((row) => row.source === "cv_upload")).toBe(true)
      expect(
        rows.every((row) => row.source_ref?.cv_version_id === cvVersionId)
      ).toBe(true)
      expect(rows.every((row) => row.embedding !== null)).toBe(true)
      // "Empresa Alfa Pagamentos" in the CV matches "… Ltda." in the profile.
      expect(
        rows.filter((row) => row.experience_id === experienceId)
      ).toHaveLength(3)

      const audit = await admin
        .from("audit_log")
        .select("action")
        .eq("user_id", userId)
        .eq("action", "fact.proposed")
      expect(audit.data?.length).toBe(rows.length)
    })

    it("is idempotent when the job is retried", async () => {
      const deps = { admin, audit: new SupabaseAuditSink(admin) }
      const again = await processCvUpload(deps, { userId, cvVersionId })
      expect(again.facts?.skipped).toBe(true)
    })

    it("refuses a CV row that belongs to another user", async () => {
      const deps = { admin, audit: new SupabaseAuditSink(admin) }
      await expect(
        processCvUpload(deps, { userId: randomUUID(), cvVersionId })
      ).rejects.toThrow(/not found/)
    })
  }
)
