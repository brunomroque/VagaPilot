import { type LanguageModel } from "ai"
import { MockLanguageModelV4 } from "ai/test"

import { getAiConfig, type AiConfig } from "./config.js"
import { FAKE_MODEL_ID } from "./fake.js"
import { realLanguageModel } from "./providers.js"

export type ModelOptions = {
  /** Overrides the model (tests inject mocks). */
  model?: LanguageModel
  config?: AiConfig
  abortSignal?: AbortSignal
  /** P6.3: run before any billable LLM call (entitlements / cost ceiling). */
  assertBillable?: () => Promise<void>
}

export type ResolvedModel = { model: LanguageModel; id: string }

const usage = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
}

/** FAKE model that answers a structured-output call with a precomputed JSON object. */
export function fakeObjectModel(payload: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "vagapilot-fake",
    modelId: FAKE_MODEL_ID,
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(payload) }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  })
}

/** Gateway model (small or large) or the deterministic fake built by `fake()`. */
export function resolveModel(
  size: "small" | "large",
  fake: () => LanguageModel,
  options: ModelOptions
): ResolvedModel {
  if (options.model) {
    return {
      model: options.model,
      id:
        typeof options.model === "string"
          ? options.model
          : options.model.modelId,
    }
  }
  const config = options.config ?? getAiConfig()
  switch (config.mode) {
    case "fake":
      return { model: fake(), id: FAKE_MODEL_ID }
    case "gateway":
    case "google": {
      const id = size === "small" ? config.extractionModel : config.largeModel
      return { model: realLanguageModel(config, id), id }
    }
    default: {
      const unreachable: never = config.mode
      throw new Error(`Unhandled AI provider mode: ${String(unreachable)}`)
    }
  }
}
