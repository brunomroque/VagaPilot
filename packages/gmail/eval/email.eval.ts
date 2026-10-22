import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { getAiConfig } from "@vagapilot/ai"
import {
  CLASSIFIER_CLASSES,
  parseEmailAddress,
  type ClassifierClass,
} from "@vagapilot/core/email"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { classifyEmail } from "../src/classify/classify-email.js"

/*
 * `pnpm eval:email` (P4.2, 10.6 email-classify, CA11.1, CA11.2). Fake provider by default; set
 * EVAL_EMAIL_PROVIDER=gateway with AI_GATEWAY_API_KEY to measure the real small model.
 */

const datasetPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../evals/email/emails.json"
)

const datasetSchema = z.object({
  emails: z.array(
    z.object({
      id: z.string(),
      label: z.enum(CLASSIFIER_CLASSES),
      from: z.string(),
      subject: z.string(),
      date: z.string(),
      body: z.string(),
      deadline: z.string().optional(),
    })
  ),
})

/** CA11.1 targets apply to these classes. */
const GATED: ClassifierClass[] = [
  "reprovacao",
  "teste_etapa",
  "convite_entrevista",
]
const MIN_PRECISION = 0.9
const MIN_RECALL = 0.85
const MIN_DEADLINE_ACCURACY = 0.9

const dataset = datasetSchema.parse(
  JSON.parse(readFileSync(datasetPath, "utf8"))
)
const useGateway = process.env.EVAL_EMAIL_PROVIDER === "gateway"
const config = useGateway
  ? getAiConfig({ ...process.env, VITEST: undefined })
  : undefined

type Row = {
  id: string
  label: ClassifierClass
  predicted: ClassifierClass
  deadlineOk: boolean | null
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator
}

describe(`email-classify eval (${dataset.emails.length} fictitious e-mails, ${useGateway ? "gateway" : "fake"} provider)`, () => {
  it("CA11.1 precision ≥ 0,9 and recall ≥ 0,85; CA11.2 deadlines ≥ 90%", async () => {
    const rows: Row[] = []
    for (const email of dataset.emails) {
      const from = parseEmailAddress(email.from)
      const result = await classifyEmail(
        {
          fromAddress: from.address,
          fromName: from.name,
          subject: email.subject,
          body: email.body,
          receivedAt: new Date(email.date),
        },
        { config }
      )
      rows.push({
        id: email.id,
        label: email.label,
        predicted: result.class,
        deadlineOk:
          email.label === "teste_etapa" && email.deadline
            ? result.deadline?.toISOString() ===
              new Date(email.deadline).toISOString()
            : null,
      })
    }

    const table = CLASSIFIER_CLASSES.map((cls) => {
      const tp = rows.filter(
        (row) => row.label === cls && row.predicted === cls
      ).length
      const predicted = rows.filter((row) => row.predicted === cls).length
      const actual = rows.filter((row) => row.label === cls).length
      return {
        class: cls,
        support: actual,
        precision: Number(ratio(tp, predicted).toFixed(2)),
        recall: Number(ratio(tp, actual).toFixed(2)),
      }
    })
    const deadlines = rows.filter((row) => row.deadlineOk !== null)
    const deadlineAccuracy = ratio(
      deadlines.filter((row) => row.deadlineOk).length,
      deadlines.length
    )
    const accuracy = ratio(
      rows.filter((row) => row.label === row.predicted).length,
      rows.length
    )

    console.table(table)
    console.info(
      `accuracy ${accuracy.toFixed(2)} · CA11.2 deadline accuracy ${deadlineAccuracy.toFixed(2)} (${deadlines.length} teste_etapa)`
    )
    const misses = rows.filter(
      (row) => row.label !== row.predicted || row.deadlineOk === false
    )
    if (misses.length > 0) console.info("misses", misses)

    for (const cls of GATED) {
      const metrics = table.find((row) => row.class === cls)
      expect(metrics?.precision, `${cls} precision`).toBeGreaterThanOrEqual(
        MIN_PRECISION
      )
      expect(metrics?.recall, `${cls} recall`).toBeGreaterThanOrEqual(
        MIN_RECALL
      )
    }
    expect(deadlineAccuracy).toBeGreaterThanOrEqual(MIN_DEADLINE_ACCURACY)
  })
})
