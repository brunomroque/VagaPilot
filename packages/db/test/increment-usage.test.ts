import { createClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { resolveLocalSupabase, seedUsers } from "./local-supabase.js"

const local = await resolveLocalSupabase()

if (!local.ok) {
  console.warn(`\n[increment_usage] SKIPPED — ${local.reason}\n`)
}

describe("increment_usage RPC", () => {
  it.skipIf(!local.ok)("increments atomically with ON CONFLICT", async () => {
    const env = local.ok ? local.env : null
    if (!env) return
    const admin = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const userId = seedUsers.b.id
    const period = "2099-01"
    const metric = "job_analyses"

    await admin
      .from("usage_counters")
      .delete()
      .eq("user_id", userId)
      .eq("period", period)
      .eq("metric", metric)

    const first = await admin.rpc("increment_usage", {
      p_user_id: userId,
      p_period: period,
      p_metric: metric,
      p_delta: 2,
    })
    expect(first.error).toBeNull()
    expect(first.data).toBe(2)

    const second = await admin.rpc("increment_usage", {
      p_user_id: userId,
      p_period: period,
      p_metric: metric,
      p_delta: 3,
    })
    expect(second.error).toBeNull()
    expect(second.data).toBe(5)

    await admin
      .from("usage_counters")
      .delete()
      .eq("user_id", userId)
      .eq("period", period)
      .eq("metric", metric)
  })
})
