"use server"

import { refresh } from "next/cache"
import { z } from "zod"

import {
  confirmFacts as confirmFactsFor,
  editAndConfirmFact as editAndConfirmFactFor,
  editFactSchema,
  factIdsSchema,
  linkFactsToExperience as linkFactsFor,
  rejectFacts as rejectFactsFor,
} from "@/lib/facts/server"
import {
  fail,
  getUserContext,
  ok,
  type ActionResult,
  type UserContext,
} from "@/lib/server/context"

async function run<T>(
  name: string,
  work: (ctx: UserContext) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  const context = await getUserContext()
  if (!context.ok) return { ok: false, error: context.error }
  try {
    const result = await work(context.ctx)
    if (result.ok) refresh()
    return result
  } catch (error) {
    console.error(
      `[facts:${name}]`,
      error instanceof Error ? error.message : error
    )
    return fail("internal_error", "Could not update the facts.")
  }
}

export async function confirmFacts(ids: string[]) {
  return run("confirm", async (ctx) => {
    const parsed = factIdsSchema.safeParse(ids)
    if (!parsed.success) return fail("invalid_request", "Invalid fact ids.")
    return ok({ count: await confirmFactsFor(ctx, parsed.data) })
  })
}

export async function rejectFacts(ids: string[]) {
  return run("reject", async (ctx) => {
    const parsed = factIdsSchema.safeParse(ids)
    if (!parsed.success) return fail("invalid_request", "Invalid fact ids.")
    return ok({ count: await rejectFactsFor(ctx, parsed.data) })
  })
}

export async function editAndConfirmFact(input: unknown) {
  return run("edit", async (ctx) => {
    const parsed = editFactSchema.safeParse(input)
    if (!parsed.success) return fail("invalid_request", "Invalid fact.")
    const updated = await editAndConfirmFactFor(ctx, parsed.data)
    return updated ? ok(undefined) : fail("not_found", "Fact not found.")
  })
}

export async function linkFactsToExperience(
  experienceId: string,
  ids: string[]
) {
  return run("link", async (ctx) => {
    const parsedIds = factIdsSchema.safeParse(ids)
    if (!z.uuid().safeParse(experienceId).success || !parsedIds.success) {
      return fail("invalid_request", "Invalid ids.")
    }
    const count = await linkFactsFor(ctx, experienceId, parsedIds.data)
    return count > 0
      ? ok({ count })
      : fail("not_found", "Experience not found.")
  })
}
