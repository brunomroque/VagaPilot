"use client"

import { useEffect, useState } from "react"

import { siteRiskLevel, type SiteRiskLevel } from "@vagapilot/core/risks"

import { listSiteRiskLevelsAction } from "@/app/app/configuracoes/riscos/actions"

let cache: Promise<{ domain: string; level: SiteRiskLevel }[]> | null = null

/** Risk level of a job URL's site, from the admin list (fetched once per page). */
export function useSiteRisk(url: string | null | undefined): SiteRiskLevel | null {
  const [level, setLevel] = useState<SiteRiskLevel | null>(null)
  useEffect(() => {
    let host: string
    try {
      host = new URL(url ?? "").hostname
    } catch {
      return
    }
    cache ??= listSiteRiskLevelsAction().catch(() => [])
    let alive = true
    void cache.then((levels) => {
      if (alive) setLevel(siteRiskLevel(host, levels))
    })
    return () => {
      alive = false
    }
  }, [url])
  return level
}
