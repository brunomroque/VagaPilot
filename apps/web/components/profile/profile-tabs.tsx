"use client"

import type { ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

/** Profile sections as tabs; the active tab is mirrored in `?secao=` so links can deep-link. */
export function ProfileTabs<V extends string>({
  defaultValue,
  tabs,
  panels,
}: {
  defaultValue: V
  tabs: { value: V; label: string }[]
  panels: Record<V, ReactNode>
}) {
  const t = useTranslations("ProfilePage")
  const router = useRouter()
  const pathname = usePathname()
  return (
    <Tabs
      defaultValue={defaultValue}
      onValueChange={(value) =>
        router.replace(`${pathname}?secao=${String(value)}`, { scroll: false })
      }
    >
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <TabsList aria-label={t("tabsLabel")}>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="flex flex-col gap-4 pt-2"
        >
          {panels[tab.value]}
        </TabsContent>
      ))}
    </Tabs>
  )
}
