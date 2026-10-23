/**
 * Server-side policy for chat tools: `policy.check(intent, origin, risk)` (spec 10.4, F14
 * RF14.3, CA14.3, CA14.8). Independent of the LLM: the model can ask, only this decides.
 */

export const CHAT_TOOL_NAMES = [
  "ingest_job_postings",
  "get_job_match",
  "check_duplicate",
  "search_facts",
  "get_profile_summary",
  "recommend_cv",
  "suggest_salary",
  "list_pending_actions",
  "get_settings",
  "ask_clarification",
  "record_decision",
  "create_saved_search",
  "update_saved_search",
  "delete_saved_search",
  "add_excluded_company",
  "remove_excluded_company",
  "update_language_level",
  "set_salary_rules",
  "set_preference",
  "set_approval_mode",
  "undo_change",
  "propose_fact",
  "export_tracker",
  "draft_application_email",
  "request_send_email",
  "send_email",
  "open_screen",
  "ats_score",
  "propose_cv_adjustment",
  "apply_cv_adjustment",
  "ensure_hybrid_cv",
  "list_cv_tracks",
  "create_application",
  "update_application_status",
  "read_gmail",
  "answer_missing_info",
  "classify_fact",
  "get_profile_tracking",
  "mark_profile_updated",
] as const
export type ChatToolName = (typeof CHAT_TOOL_NAMES)[number]

/** leitura: no effect; interna: user's own click; baixo: apply + undo; medio/alto: confirmation. */
export type ToolRisk = "leitura" | "interna" | "baixo" | "medio" | "alto"

export function isChatToolName(value: unknown): value is ChatToolName {
  return (
    typeof value === "string" &&
    (CHAT_TOOL_NAMES as readonly string[]).includes(value)
  )
}

/** Risk per tool, from the 10.3 table and the F14 examples. */
export function toolRisk(tool: ChatToolName): ToolRisk {
  switch (tool) {
    case "ingest_job_postings":
    case "get_job_match":
    case "check_duplicate":
    case "search_facts":
    case "get_profile_summary":
    case "recommend_cv":
    case "suggest_salary":
    case "list_pending_actions":
    case "get_settings":
    case "ask_clarification":
    case "export_tracker":
    case "open_screen":
    case "ats_score":
    case "list_cv_tracks":
    case "read_gmail":
    case "get_profile_tracking":
      return "leitura"
    case "mark_profile_updated":
      return "baixo"
    case "record_decision":
      return "interna"
    case "create_saved_search":
    case "update_saved_search":
    case "add_excluded_company":
    case "remove_excluded_company":
    case "set_salary_rules":
    case "set_preference":
    case "undo_change":
      return "baixo"
    case "update_language_level":
    case "propose_fact":
    case "propose_cv_adjustment":
    case "ensure_hybrid_cv":
    case "answer_missing_info":
    case "classify_fact":
    case "draft_application_email":
    case "request_send_email":
      return "medio"
    case "send_email":
      return "alto"
    case "delete_saved_search":
    case "set_approval_mode":
    case "apply_cv_adjustment":
      return "alto"
    case "create_application":
    case "update_application_status":
      return "baixo"
    default: {
      const unreachable: never = tool
      throw new Error(`Unknown tool: ${String(unreachable)}`)
    }
  }
}

/**
 * Where the request came from. `untrusted_content` means the call followed job, ATS, e-mail or
 * CV content in the same turn: such content can never trigger an effect by itself.
 */
export type ToolOrigin =
  "user_turn" | "untrusted_content" | "widget" | "form" | "automation"

export type PolicyDecision =
  | { decision: "allow" }
  | { decision: "allow_with_undo" }
  | {
      decision: "require_confirmation"
      reason: "sensitive" | "untrusted_origin"
    }
  | { decision: "deny"; reason: "untrusted_origin" | "automation_not_allowed" }

/** Applying a low-risk change immediately is safe because it can be undone (RF14.3). */
function lowRisk(origin: ToolOrigin): PolicyDecision {
  switch (origin) {
    case "user_turn":
    case "widget":
    case "form":
      return { decision: "allow_with_undo" }
    case "untrusted_content":
      return { decision: "require_confirmation", reason: "untrusted_origin" }
    case "automation":
      return { decision: "deny", reason: "automation_not_allowed" }
    default: {
      const unreachable: never = origin
      throw new Error(`Unknown origin: ${String(unreachable)}`)
    }
  }
}

/**
 * `confirmed` is true only when the person clicked "Confirmar" on a card or saved a form;
 * the LLM can never set it.
 */
export function policyCheck(input: {
  tool: ChatToolName
  origin: ToolOrigin
  confirmed?: boolean
}): PolicyDecision {
  const risk = toolRisk(input.tool)
  const confirmedByPerson =
    input.confirmed === true &&
    (input.origin === "widget" || input.origin === "form")
  switch (risk) {
    case "leitura":
      return { decision: "allow" }
    case "interna":
      if (input.origin === "untrusted_content")
        return { decision: "deny", reason: "untrusted_origin" }
      if (input.origin === "automation")
        return { decision: "deny", reason: "automation_not_allowed" }
      return { decision: "allow" }
    case "baixo":
      return lowRisk(input.origin)
    case "medio":
      // Language level used to apply with undo. A pasted job ("inglês fluente",
      // a city) was stored as the user's own fact. Confirmation is required first
      // (QA); the card still supports undo after the person confirms.
      return confirmedByPerson
        ? { decision: "allow" }
        : { decision: "require_confirmation", reason: "sensitive" }
    case "alto":
      if (input.origin === "automation")
        return { decision: "deny", reason: "automation_not_allowed" }
      return confirmedByPerson
        ? { decision: "allow" }
        : {
            decision: "require_confirmation",
            reason:
              input.origin === "untrusted_content"
                ? "untrusted_origin"
                : "sensitive",
          }
    default: {
      const unreachable: never = risk
      throw new Error(`Unknown risk: ${String(unreachable)}`)
    }
  }
}

/** True when the decision lets the change be written now. */
export function isAllowedNow(decision: PolicyDecision): boolean {
  return (
    decision.decision === "allow" || decision.decision === "allow_with_undo"
  )
}
