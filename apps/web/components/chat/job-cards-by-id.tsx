"use client"

import { useEffect, useState } from "react"

import { loadCardsAction } from "@/app/app/chat/actions"
import type { JobCardData } from "@/lib/chat/types"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { JobCardView, type CvOption } from "./job-card-view"

/** Loads the current card data for matches referenced by a tool result. */
export function JobCardsById({
  matchIds,
  cvOptions,
}: {
  matchIds: string[]
  cvOptions: CvOption[]
}) {
  const [cards, setCards] = useState<JobCardData[] | null>(null)
  const key = matchIds.join(",")
  useEffect(() => {
    let active = true
    void loadCardsAction({ matchIds: key.split(",").filter(Boolean) }).then(
      (result) => {
        if (active && result.ok) setCards(result.data)
      }
    )
    return () => {
      active = false
    }
  }, [key])
  if (!cards) return <Skeleton className="h-32 w-full max-w-2xl" />
  return (
    <div className="flex flex-col gap-3">
      {cards.map((card) => (
        <JobCardView key={card.matchId} initial={card} cvOptions={cvOptions} />
      ))}
    </div>
  )
}
