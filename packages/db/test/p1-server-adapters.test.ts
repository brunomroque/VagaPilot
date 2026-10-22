import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { logAudit } from "@vagapilot/core/audit"
import { createFieldCrypto, LocalKeyProvider } from "@vagapilot/core/crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { fromBytea, toBytea } from "../src/bytea.js"
import {
  searchConfirmedFacts,
  SupabaseAuditSink,
  SupabaseDekStore,
} from "../src/server/index.js"
import {
  resolveLocalSupabase,
  seedUsers,
  type LocalSupabase,
} from "./local-supabase.js"

const local = await resolveLocalSupabase()

if (!local.ok) {
  if (process.env.VAGAPILOT_REQUIRE_SUPABASE === "1") {
    throw new Error(`[p1] VAGAPILOT_REQUIRE_SUPABASE=1 but ${local.reason}`)
  }
  console.warn(
    `\n[p1] SKIPPED — server adapter tests did not run: ${local.reason}\n`
  )
}

const DIMENSIONS = 1536

function unitVector(axis: number): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0)
  vector[axis % DIMENSIONS] = 1
  return vector
}

function clientFor(env: LocalSupabase, key: string): SupabaseClient {
  return createClient(env.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

describe("bytea helpers", () => {
  it("round-trips bytes through PostgREST hex text", () => {
    const bytes = new Uint8Array([0, 1, 171, 255])
    expect(toBytea(bytes)).toBe("\\x0001abff")
    expect(fromBytea(toBytea(bytes))).toEqual(bytes)
    expect(fromBytea(null)).toBeNull()
    expect(() => fromBytea("\\xzz")).toThrow()
  })
})

describe.skipIf(!local.ok)("P1 server adapters on local Supabase", () => {
  let admin: SupabaseClient
  let asTester: SupabaseClient
  let asMarina: SupabaseClient
  let testerId = ""
  const email = `p1-adapters+${randomUUID()}@vagapilot.test`
  const password = "Ficticia#2026"

  beforeAll(async () => {
    if (!local.ok) return
    admin = clientFor(local.env, local.env.serviceRoleKey)
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Pessoa Teste Fictícia" },
    })
    if (created.error || !created.data.user) {
      throw new Error(`createUser failed: ${created.error?.message}`)
    }
    testerId = created.data.user.id
    asTester = clientFor(local.env, local.env.anonKey)
    await asTester.auth.signInWithPassword({ email, password })
    asMarina = clientFor(local.env, local.env.anonKey)
    await asMarina.auth.signInWithPassword({
      email: seedUsers.a.email,
      password: seedUsers.password,
    })
  })

  afterAll(async () => {
    if (testerId) await admin.auth.admin.deleteUser(testerId)
  })

  describe("SupabaseDekStore", () => {
    it("inserts if absent and never overwrites", async () => {
      const store = new SupabaseDekStore(admin)
      expect(await store.get(testerId)).toBeUndefined()
      const first = await store.put(testerId, {
        wrappedDek: new Uint8Array([1, 2, 3]),
        keyId: "local:first",
        createdAt: new Date("2026-10-01T00:00:00Z"),
      })
      const second = await store.put(testerId, {
        wrappedDek: new Uint8Array([9, 9, 9]),
        keyId: "local:second",
        createdAt: new Date(),
      })
      expect(second.keyId).toBe("local:first")
      expect(second.wrappedDek).toEqual(first.wrappedDek)
      await store.delete(testerId)
      expect(await store.get(testerId)).toBeUndefined()
    })

    it("user_keys is not reachable with a user session", async () => {
      const read = await asTester.from("user_keys").select("*")
      expect(read.error?.code).toBe("42501")
      const write = await asTester.from("user_keys").insert({
        user_id: testerId,
        wrapped_dek: "\\x00",
        key_id: "x",
      })
      expect(write.error?.code).toBe("42501")
    })

    it("CA1.2 sensitive fields are stored encrypted (no plaintext in the database)", async () => {
      const crypto = createFieldCrypto({
        keyProvider: new LocalKeyProvider(new Uint8Array(32).fill(7)),
        dekStore: new SupabaseDekStore(admin),
      })
      const cpf = "123.456.789-09"
      const ciphertext = await crypto.encryptField(
        testerId,
        JSON.stringify({ cpf })
      )
      const { error } = await asTester.from("candidate_profiles").upsert({
        user_id: testerId,
        display_name: "Pessoa Teste Fictícia",
        documents_enc: toBytea(ciphertext),
      })
      expect(error).toBeNull()

      const { data } = await admin
        .from("candidate_profiles")
        .select("documents_enc")
        .eq("user_id", testerId)
        .single<{ documents_enc: string }>()
      const stored = fromBytea(data?.documents_enc) ?? new Uint8Array()
      expect(Buffer.from(stored).toString("latin1")).not.toContain(cpf)
      expect(data?.documents_enc).not.toContain(
        Buffer.from(cpf).toString("hex")
      )

      crypto.clearCache()
      expect(
        JSON.parse(await crypto.decryptFieldText(testerId, stored))
      ).toEqual({ cpf })

      await crypto.destroyUserKey(testerId)
      await expect(crypto.decryptFieldText(testerId, stored)).rejects.toThrow()
    })
  })

  describe("SupabaseAuditSink", () => {
    it("appends redacted entries to audit_log", async () => {
      await logAudit(new SupabaseAuditSink(admin), {
        userId: testerId,
        actor: "usuario",
        action: "fact.confirmed",
        targetType: "confirmed_fact",
        targetId: randomUUID(),
        details: { note: "contato teste@exemplo.test" },
      })
      const { data } = await admin
        .from("audit_log")
        .select("action, details")
        .eq("user_id", testerId)
      expect(data).toHaveLength(1)
      expect(data?.[0]?.action).toBe("fact.confirmed")
      expect(JSON.stringify(data?.[0]?.details)).not.toContain(
        "teste@exemplo.test"
      )
    })
  })

  describe("searchConfirmedFacts", () => {
    beforeAll(async () => {
      const rows = (
        [
          ["proposto", "Fato proposto que nunca pode aparecer"],
          ["confirmado", "Liderou a migração para Kubernetes"],
          ["rejeitado", "Fato rejeitado que nunca pode aparecer"],
        ] as const
      ).map(([status, statement]) => ({
        user_id: testerId,
        statement,
        kind: "conquista",
        status,
        source: "manual",
        embedding: JSON.stringify(unitVector(3)),
      }))
      const { error } = await admin.from("confirmed_facts").insert(rows)
      if (error) throw new Error(error.message)
    })

    it("CA2.2 never returns proposed or rejected facts (service role)", async () => {
      const hits = await searchConfirmedFacts(
        admin,
        testerId,
        unitVector(3),
        10
      )
      expect(hits.map((hit) => hit.statement)).toEqual([
        "Liderou a migração para Kubernetes",
      ])
      expect(hits.every((hit) => hit.status === "confirmado")).toBe(true)
      expect(hits[0]?.similarity).toBeCloseTo(1, 5)
    })

    it("CA2.2 never returns proposed or rejected facts (user session)", async () => {
      const hits = await searchConfirmedFacts(
        asTester,
        testerId,
        unitVector(3),
        10
      )
      expect(hits).toHaveLength(1)
    })

    it("RLS keeps other users' facts out of the search", async () => {
      const hits = await searchConfirmedFacts(
        asMarina,
        testerId,
        unitVector(3),
        10
      )
      expect(hits).toEqual([])
    })
  })
})
