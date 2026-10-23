import "server-only"

import { zipSync, strToU8 } from "fflate"

import type { SupabaseClient } from "@supabase/supabase-js"

/** LGPD portabilidade (P6.4, spec 12): JSON bundle incl. email_threads e notifications. */
export async function buildPrivacyExportBundle(
  supabase: SupabaseClient,
  userId: string
): Promise<Uint8Array> {
  const [
    profile,
    applications,
    emailThreads,
    notifications,
    consents,
    audit,
    conversations,
    messages,
    chatLinks,
    platformProfiles,
  ] = await Promise.all([
    supabase.from("candidate_profiles").select("*").eq("user_id", userId),
    supabase.from("applications").select("*").eq("user_id", userId),
    supabase.from("email_threads").select("*").eq("user_id", userId),
    supabase.from("notifications").select("*").eq("user_id", userId),
    supabase
      .from("consents")
      .select("purpose, version, granted, created_at")
      .eq("user_id", userId),
    supabase
      .from("audit_log")
      .select("action, target_type, target_id, created_at, details")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("conversations")
      .select("id, title, created_at, updated_at, archived_at, context")
      .eq("user_id", userId),
    supabase
      .from("messages")
      .select("id, conversation_id, role, created_at")
      .eq("user_id", userId),
    supabase.from("chat_record_links").select("*").eq("user_id", userId),
    supabase.from("platform_profiles").select("*").eq("user_id", userId),
  ])

  const payload = {
    exportedAt: new Date().toISOString(),
    userId,
    profile: profile.data ?? [],
    applications: applications.data ?? [],
    email_threads: emailThreads.data ?? [],
    notifications: notifications.data ?? [],
    consents: consents.data ?? [],
    audit_log: audit.data ?? [],
    conversations: conversations.data ?? [],
    messages: messages.data ?? [],
    chat_record_links: chatLinks.data ?? [],
    platform_profiles: platformProfiles.data ?? [],
  }

  const json = JSON.stringify(payload, null, 2)
  return zipSync({ "export.json": strToU8(json) })
}
