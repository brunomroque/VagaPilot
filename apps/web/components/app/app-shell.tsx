"use client"

import type { CSSProperties, ReactNode } from "react"

import { AnalyzeJobDialog } from "@/components/app/analyze-job-dialog"
import { AppSidebar } from "@/components/app/app-sidebar"
import { AppTopbar } from "@/components/app/app-topbar"
import { ApplicationSheet } from "@/components/app/application-sheet"
import { CommandMenu } from "@/components/app/command-menu"
import { ImportCsvDialog } from "@/components/app/import-csv-dialog"
import { NewApplicationDialog } from "@/components/app/new-application-dialog"
import { WorkspaceProvider } from "@/components/app/workspace-context"
import type { TrackerData } from "@/lib/tracker/types"
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"

export function AppShell({
  displayName,
  firstName,
  today,
  tracker,
  nowIso,
  children,
}: {
  displayName: string
  firstName: string
  today: string
  tracker: TrackerData
  nowIso: string
  children: ReactNode
}) {
  return (
    <WorkspaceProvider data={tracker} nowIso={nowIso}>
      <SidebarProvider
        style={{ "--sidebar-width": "14.25rem" } as CSSProperties}
      >
        <AppSidebar displayName={displayName} />
        <SidebarInset className="min-w-0">
          <AppTopbar firstName={firstName} today={today} />
          <div className="flex flex-1 flex-col p-4 md:p-8">{children}</div>
        </SidebarInset>
        <CommandMenu />
        <AnalyzeJobDialog />
        <NewApplicationDialog />
        <ImportCsvDialog />
        <ApplicationSheet />
      </SidebarProvider>
    </WorkspaceProvider>
  )
}
