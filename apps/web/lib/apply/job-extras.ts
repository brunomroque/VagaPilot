// Server-side only (also imported by the Netlify background function, so no "server-only").
import type { ApplyJobOptions } from "@vagapilot/browser-pool/job"

/**
 * Optional pieces of the apply worker that live outside browser-pool: the Gemini-driven generic
 * driver (unknown ATSs, APPLY_GENERIC_AI_ENABLED=true) and the Gmail reader for OTP codes and
 * confirmation links of the run's ATS.
 */
export async function applyJobExtras(): Promise<
  Pick<ApplyJobOptions, "genericPlanner" | "verificationFor">
> {
  const [{ createApplyPagePlanner }, gmail] = await Promise.all([
    import("@vagapilot/ai"),
    import("@vagapilot/gmail"),
  ])
  const planner =
    process.env.APPLY_GENERIC_AI_ENABLED === "true"
      ? createApplyPagePlanner()
      : null
  return {
    // Wrapped by the job with the learned recipe of the site (replay without LLM, self-heal).
    genericPlanner: planner,
    async verificationFor(userId, domains) {
      const hooks = await gmail.gmailVerificationHooks(
        gmail.getDefaultGmailRuntime(),
        userId
      )
      if (!hooks) return null
      return {
        awaitCode: (since) => hooks.awaitCode(domains, since),
        awaitLink: (since) => hooks.awaitLink(domains, since),
      }
    },
  }
}
