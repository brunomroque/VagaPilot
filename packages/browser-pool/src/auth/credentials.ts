import { randomInt } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { fromBytea, toBytea } from "@vagapilot/db/server"

import { authStateKeyFromEnv, openAuthState, sealAuthState } from "./crypto.js"

type Env = Record<string, string | undefined>

/**
 * Site accounts the bot creates on ATSs with the user's e-mail (table `ats_credentials`).
 * Passwords are generated here, sealed with AUTH_STATE_ENCRYPTION_KEY (AES-256-GCM, AAD bound
 * to user + site) and only ever decrypted server side: in the runner, or when the user asks to
 * see it. They are never logged, audited or returned in lists.
 */

export type AtsCredential = {
  site: string
  email: string
  password: string
  created_at?: string
  updated_at?: string
}

export type AtsCredentialSummary = {
  site: string
  email: string
  created_at: string
  updated_at: string
}

export const credentialAad = (userId: string, site: string) =>
  Buffer.from(`vp-cred|${userId}|${site}`, "utf8")

const LOWER = "abcdefghijkmnopqrstuvwxyz"
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const DIGITS = "23456789"
const SYMBOLS = "!@#$%*-_+?"

/** Strong random password that satisfies the usual ATS rules (upper, lower, digit, symbol). */
export function generatePassword(length = 20): string {
  const all = LOWER + UPPER + DIGITS + SYMBOLS
  const pick = (set: string) => set[randomInt(set.length)]!
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < Math.max(12, length)) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join("")
}

export function sealPassword(
  key: Buffer,
  userId: string,
  site: string,
  password: string
): Buffer {
  return sealAuthState(key, credentialAad(userId, site), { p: password })
}

export function openPassword(
  key: Buffer,
  userId: string,
  site: string,
  sealed: Uint8Array
): string {
  return openAuthState<{ p: string }>(key, credentialAad(userId, site), sealed)
    .p
}

function requireKey(env: Env): Buffer {
  const key = authStateKeyFromEnv(env)
  if (!key) throw new Error("AUTH_STATE_ENCRYPTION_KEY não está configurada.")
  return key
}

export async function listCredentials(
  admin: SupabaseClient,
  userId: string
): Promise<AtsCredentialSummary[]> {
  const { data, error } = await admin
    .from("ats_credentials")
    .select("site, email, created_at, updated_at")
    .eq("user_id", userId)
    .order("site")
  if (error) throw new Error(error.message)
  return (data ?? []) as AtsCredentialSummary[]
}

export async function getCredential(
  admin: SupabaseClient,
  userId: string,
  site: string,
  env: Env = process.env
): Promise<AtsCredential | null> {
  const { data, error } = await admin
    .from("ats_credentials")
    .select("site, email, password_enc, created_at, updated_at")
    .eq("user_id", userId)
    .eq("site", site)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as {
    site: string
    email: string
    password_enc: string | null
    created_at: string
    updated_at: string
  } | null
  const bytes = row?.password_enc ? fromBytea(row.password_enc) : null
  if (!row || !bytes) return null
  return {
    site: row.site,
    email: row.email,
    password: openPassword(requireKey(env), userId, site, bytes),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** Creates (or with `rotate`, replaces) the site password. Returns the plaintext once, in memory. */
export async function saveNewCredential(
  admin: SupabaseClient,
  userId: string,
  site: string,
  email: string,
  env: Env = process.env,
  password: string = generatePassword()
): Promise<AtsCredential> {
  const key = requireKey(env)
  const now = new Date().toISOString()
  const { error } = await admin.from("ats_credentials").upsert(
    {
      user_id: userId,
      site,
      email,
      password_enc: toBytea(sealPassword(key, userId, site, password)),
      updated_at: now,
    },
    { onConflict: "user_id,site" }
  )
  if (error) throw new Error(error.message)
  return { site, email, password, updated_at: now }
}

export async function deleteCredential(
  admin: SupabaseClient,
  userId: string,
  site: string
) {
  const { error } = await admin
    .from("ats_credentials")
    .delete()
    .eq("user_id", userId)
    .eq("site", site)
  if (error) throw new Error(error.message)
}
