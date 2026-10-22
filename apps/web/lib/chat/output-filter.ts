import "server-only"

import type { TextStreamPart, ToolSet } from "ai"

import { ORCHESTRATOR_PROMPT_FRAGMENTS } from "@vagapilot/ai"
import { filterOutput } from "@vagapilot/core/guardrails"

/** Hosts the assistant may link to (the app, job sources). Others lose links that carry data. */
export const ALLOWED_LINK_HOSTS = [
  "vagapilot.app",
  "linkedin.com",
  "gupy.io",
  "inhire.app",
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "successfactors.com",
  "successfactors.eu",
  "quickin.io",
  "jobbol.com.br",
  "solides.com.br",
  "127.0.0.1",
  "localhost",
]

const FLUSH_AT = 400

/**
 * Output filter (10.4/F14): buffers text per block and runs `filterOutput` on whole lines,
 * so links with user data, PII and prompt echoes never reach the client (CA14.11).
 */
export function outputFilterTransform<TOOLS extends ToolSet>(
  refusal: string,
  extraHosts: readonly string[] = []
) {
  return (): TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>> => {
    const buffers = new Map<string, string>()
    const options = {
      allowedHosts: [...ALLOWED_LINK_HOSTS, ...extraHosts],
      promptFragments: ORCHESTRATOR_PROMPT_FRAGMENTS,
    }
    let leaked = false

    function emit(
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
      id: string,
      text: string
    ) {
      if (!text || leaked) return
      const result = filterOutput(text, options, refusal)
      if (result.reasons.includes("prompt_leak")) leaked = true
      controller.enqueue({
        type: "text-delta",
        id,
        text: result.text,
      } as TextStreamPart<TOOLS>)
    }

    return new TransformStream({
      transform(part, controller) {
        if (part.type === "text-delta") {
          const buffer = (buffers.get(part.id) ?? "") + part.text
          const cut = buffer.lastIndexOf("\n")
          if (cut >= 0 || buffer.length > FLUSH_AT) {
            const end =
              cut >= 0 ? cut + 1 : buffer.lastIndexOf(" ") + 1 || buffer.length
            emit(controller, part.id, buffer.slice(0, end))
            buffers.set(part.id, buffer.slice(end))
          } else {
            buffers.set(part.id, buffer)
          }
          return
        }
        if (part.type === "text-end") {
          emit(controller, part.id, buffers.get(part.id) ?? "")
          buffers.delete(part.id)
        }
        controller.enqueue(part)
      },
      flush(controller) {
        for (const [id, text] of buffers) emit(controller, id, text)
      },
    })
  }
}
