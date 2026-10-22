/** Server-only adapters (service_role or user-session Supabase clients). Never import in browser code. */
export { SupabaseAuditSink } from "./audit-sink.js"
export { SupabaseDekStore } from "./dek-store.js"
export { searchConfirmedFacts, type ConfirmedFactHit } from "./fact-search.js"
export { fromBytea, toBytea } from "../bytea.js"
