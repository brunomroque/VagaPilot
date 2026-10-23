import { generateObject } from "ai"
import { z } from "zod"

import { getAiConfig } from "../config.js"
import { fakeObjectModel, resolveModel, type ModelOptions } from "../models.js"

const jobScreenshotSchema = z.object({
  company: z.string().nullable(),
  title: z.string().nullable(),
  location: z.string().nullable(),
  url: z.string().url().nullable(),
})

export type JobScreenshotExtraction = z.infer<typeof jobScreenshotSchema>

const PROMPT =
  "Extraia da imagem os dados visíveis da vaga (empresa, cargo, local e link se aparecer). " +
  "Não invente campos que não estejam legíveis. Use null quando não houver evidência."

export async function extractJobFromScreenshot(
  bytes: Uint8Array,
  mimeType: string,
  options: ModelOptions = {}
): Promise<{
  data: JobScreenshotExtraction
  model: string
}> {
  const config = options.config ?? getAiConfig()
  if (config.mode === "fake") {
    return {
      data: { company: null, title: null, location: null, url: null },
      model: "fake",
    }
  }

  const { model, id } = resolveModel(
    "small",
    () =>
      fakeObjectModel({
        company: null,
        title: null,
        location: null,
        url: null,
      }),
    options
  )

  const result = await generateObject({
    model,
    schema: jobScreenshotSchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          {
            type: "file",
            data: bytes,
            mediaType: mimeType,
          },
        ],
      },
    ],
    temperature: 0,
  })

  return { data: result.object, model: id }
}
