import { beforeEach, describe, expect, it, vi } from "vitest"

import type { LegalSlug } from "@vagapilot/core/legal"

import type { EvidenceRow } from "@/lib/legal/pure"

const mocks = vi.hoisted(() => ({
  adminClient: {} as unknown,
  docs: {} as Record<
    string,
    { version: string; sha256: string; id: string; slug: string }
  >,
  docsLoadError: undefined as "query_failed" | "admin_unavailable" | undefined,
  evidenceRows: [] as EvidenceRow[],
  loadThrows: false,
}))

vi.mock("@/lib/server/admin", () => ({
  getAdminClient: () => mocks.adminClient,
}))

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => null,
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}))

vi.mock("@/lib/auth/dev-bypass", () => ({
  isDevAuthBypassEnabled: () => false,
  DEV_SESSION_COOKIE: "dev",
  devUser: { id: "dev", email: "dev@test", displayName: "Dev" },
}))

vi.mock("@/lib/legal/server", async () => {
  const { latestByDocument } = await import("../legal/pure")
  return {
    latestByDocument,
    loadCurrentLegalDocuments: async () => {
      if (mocks.loadThrows) throw new Error("load failed")
      return {
        docs: mocks.docs,
        error: mocks.docsLoadError,
      }
    },
    loadEvidence: async () => mocks.evidenceRows,
  }
})

const { hasAcceptedTerms } = await import("./session")

const baseUser = {
  id: "u1",
  email: "marina@vagapilot.test",
  displayName: "Marina",
  firstName: "Marina",
  isDevBypass: false,
}

function acceptRow(
  slug: LegalSlug,
  version: string,
  sha256: string,
  seq: number
): EvidenceRow {
  return {
    id: `id-${seq}`,
    seq,
    document_id: "d",
    recorded_at: new Date().toISOString(),
    user_id: baseUser.id,
    email: baseUser.email,
    action: "accept",
    document_slug: slug,
    document_version: version,
    document_sha256: sha256,
    checkboxes: {},
    typed_confirmation: null,
    accepted_at: new Date().toISOString(),
    ip: null,
    user_agent: null,
    session_id: null,
    locale: "pt-BR",
    ui_version: "dev",
    prev_hash: null,
    record_hash: "h".repeat(64),
  }
}

beforeEach(() => {
  mocks.adminClient = {}
  mocks.loadThrows = false
  mocks.docsLoadError = undefined
  mocks.docs = {
    "termos-de-uso": {
      id: "d1",
      slug: "termos-de-uso",
      version: "v1",
      sha256: "a".repeat(64),
    },
    "politica-de-privacidade": {
      id: "d2",
      slug: "politica-de-privacidade",
      version: "v1",
      sha256: "b".repeat(64),
    },
  }
  mocks.evidenceRows = []
})

describe("hasAcceptedTerms", () => {
  it("returns true for dev bypass", async () => {
    expect(await hasAcceptedTerms({ ...baseUser, isDevBypass: true })).toBe(
      true
    )
  })

  it("returns false when admin client is missing", async () => {
    mocks.adminClient = null
    expect(await hasAcceptedTerms(baseUser)).toBe(false)
  })

  it("returns false when no required legal documents load", async () => {
    mocks.docs = {}
    expect(await hasAcceptedTerms(baseUser)).toBe(false)
  })

  it("returns false when legal documents load reports an error", async () => {
    mocks.docsLoadError = "query_failed"
    expect(await hasAcceptedTerms(baseUser)).toBe(false)
  })

  it("returns false when loading legal data throws", async () => {
    mocks.loadThrows = true
    expect(await hasAcceptedTerms(baseUser)).toBe(false)
  })

  it("returns true when every signup-required doc is accepted", async () => {
    mocks.evidenceRows = [
      acceptRow("termos-de-uso", "v1", "a".repeat(64), 1),
      acceptRow("politica-de-privacidade", "v1", "b".repeat(64), 2),
    ]
    expect(await hasAcceptedTerms(baseUser)).toBe(true)
  })
})
