import { redactPII } from "@vagapilot/core/redact"

/** Langfuse / OpenTelemetry metadata for AI SDK calls (PII redacted, spec 10.4). */
export function llmTelemetryOptions(functionId: string, sessionId?: string) {
  const enabled =
    Boolean(process.env.LANGFUSE_PUBLIC_KEY) &&
    Boolean(process.env.LANGFUSE_SECRET_KEY)
  return {
    experimental_telemetry: {
      isEnabled: enabled,
      functionId,
      metadata: redactPII({
        service: "vagapilot",
        promptVersion: process.env.VAGAPILOT_PROMPT_VERSION ?? "dev",
        ...(sessionId ? { sessionId } : {}),
      }) as Record<string, string>,
    },
  }
}
