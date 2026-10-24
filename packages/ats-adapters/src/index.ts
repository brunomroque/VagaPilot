export {
  adapterFor,
  adapters,
  canonicalizeUrl,
  detectSource,
  extractJob,
} from "./detect.js"
export { decodeEntities, htmlToText } from "./html.js"
export {
  CACHE_TTL_MS,
  FETCH_TIMEOUT_MS,
  fetchPublic,
  MemoryJobCache,
  VAGAPILOT_USER_AGENT,
} from "./http.js"
export {
  fetchViaProviders,
  providersFromEnv,
  type FetchProvider,
} from "./providers.js"
export { formAdapterFor, isLinkedInApplyPage } from "./form/index.js"
export { linkedInGuestUrl } from "./adapters/linkedin.js"
export { genericCanonical, parseUrl } from "./url.js"
export type {
  CachedResponse,
  ExtractFailureCode,
  ExtractResult,
  FetchCtx,
  JobCache,
  JobSource,
  JobSourceAdapter,
  RawJobPosting,
} from "./types.js"
