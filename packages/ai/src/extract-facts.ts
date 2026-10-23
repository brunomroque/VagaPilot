import { isExcerptInText } from "@vagapilot/core/facts"
import { generateText, Output, type LanguageModel } from "ai"

import { getAiConfig, type AiConfig } from "./config.js"
import { createFakeExtractionModel, FAKE_MODEL_ID } from "./fake.js"
import { realLanguageModel } from "./providers.js"
import {
  EXTRACT_FACTS_PROMPT_VERSION,
  EXTRACT_FACTS_SYSTEM_V1,
} from "./prompts/extract-facts.js"
import {
  cvExtractionSchema,
  type CvExperience,
  type CvFact,
} from "./schemas.js"

/** Upper bound of CV characters sent to the model (≈ 15 pages). */
export const MAX_CV_CHARS = 60_000

export type ExtractFactsResult = {
  facts: CvFact[]
  experiences: CvExperience[]
  /** Facts discarded because their excerpt is not in the CV text (P1.3). */
  droppedFacts: number
  model: string
  promptVersion: string
}

export type ExtractFactsOptions = {
  /** Overrides the model (tests inject mocks). */
  model?: LanguageModel
  config?: AiConfig
  abortSignal?: AbortSignal
}

function resolveModel(
  text: string,
  options: ExtractFactsOptions
): { model: LanguageModel; id: string } {
  if (options.model) {
    const id =
      typeof options.model === "string" ? options.model : options.model.modelId
    return { model: options.model, id }
  }
  const config = options.config ?? getAiConfig()
  switch (config.mode) {
    case "fake":
      return { model: createFakeExtractionModel(text), id: FAKE_MODEL_ID }
    case "gateway":
    case "google":
      return {
        model: realLanguageModel(config, config.extractionModel),
        id: config.extractionModel,
      }
    default: {
      const unreachable: never = config.mode
      throw new Error(`Unhandled AI provider mode: ${String(unreachable)}`)
    }
  }
}

/**
 * Extracts atomic facts from CV text (spec F2 RF2.1, prompt P1.3). Every returned fact has an
 * `excerpt` that exists in the CV text after normalization; the rest are dropped.
 */
export async function extractFactsFromCv(
  text: string,
  options: ExtractFactsOptions = {}
): Promise<ExtractFactsResult> {
  const source = text.slice(0, MAX_CV_CHARS)
  const { model, id } = resolveModel(source, options)

  const { output } = await generateText({
    model,
    output: Output.object({ schema: cvExtractionSchema }),
    system: EXTRACT_FACTS_SYSTEM_V1,
    prompt: `<untrusted source="cv">\n${source}\n</untrusted>`,
    temperature: 0,
    maxRetries: 1,
    abortSignal: options.abortSignal,
  })

  const facts: CvFact[] = []
  const seen = new Set<string>()
  let droppedFacts = 0
  for (const fact of output.facts) {
    if (!isExcerptInText(fact.excerpt, source)) {
      droppedFacts += 1
      continue
    }
    const key = fact.statement.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    facts.push({ ...fact, statement: fact.statement.trim() })
  }

  return {
    facts,
    experiences: output.experiences.filter((experience) =>
      isExcerptInText(experience.excerpt, source)
    ),
    droppedFacts,
    model: id,
    promptVersion: EXTRACT_FACTS_PROMPT_VERSION,
  }
}
