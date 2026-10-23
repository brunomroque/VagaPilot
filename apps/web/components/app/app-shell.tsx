"use client"

import type { CSSProperties, ReactNode } from "react"
import type { UIMessage } from "ai"

import { AnalyzeJobDialog } from "@/components/app/analyze-job-dialog"
import { AppSidebar } from "@/components/app/app-sidebar"
import { AppTopbar } from "@/components/app/app-topbar"
import { ApplicationSheet } from "@/components/app/application-sheet"
import { CommandMenu } from "@/components/app/command-menu"
import { ImportCsvDialog } from "@/components/app/import-csv-dialog"
import { NewApplicationDialog } from "@/components/app/new-application-dialog"
import { WorkspaceProvider } from "@/components/app/workspace-context"
import { ChatSheetLauncher } from "@/components/chat/chat-sheet"
import { ChatSheetProvider } from "@/components/chat/chat-sheet-context"
import type { NextStepsPayload } from "@/lib/chat/next-steps"
import type { TrackerData } from "@/lib/tracker/types"
import type { PendingQuestionView } from "@/components/chat/pending-questions-panel"
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"

export function AppShell({
  isAdmin = false,
  displayName,
  firstName,
  today,
  tracker,
  nowIso,
  chatBootstrap,
  plan,
  children,
}: {
  isAdmin?: boolean
  displayName: string
  firstName: string
  today: string
  tracker: TrackerData
  nowIso: string
  chatBootstrap: {
    conversationId: string
    initialMessages: UIMessage[]
    cvOptions: { id: string; label: string }[]
    pendingQuestions: PendingQuestionView[]
    nextSteps: NextStepsPayload
  }
  plan: {
    name: string
    used: number
    limit: number | null
    usageLabel: string
  }
  children: ReactNode
}) {
  return (
    <WorkspaceProvider data={tracker} nowIso={nowIso}>
      <ChatSheetProvider>
        <SidebarProvider
          style={{ "--sidebar-width": "14.25rem" } as CSSProperties}
        >
          <AppSidebar displayName={displayName} plan={plan} isAdmin={isAdmin} />
          <SidebarInset className="min-w-0">
            <AppTopbar firstName={firstName} today={today} />
            <div className="flex flex-1 flex-col p-4 md:p-8">{children}</div>
          </SidebarInset>
          <CommandMenu />
          <ChatSheetLauncher
            conversationId={chatBootstrap.conversationId}
            initialMessages={chatBootstrap.initialMessages}
            cvOptions={chatBootstrap.cvOptions}
            pendingQuestions={chatBootstrap.pendingQuestions}
            nextSteps={chatBootstrap.nextSteps}
          />
          <AnalyzeJobDialog />
          <NewApplicationDialog />
          <ImportCsvDialog />
          <ApplicationSheet />
        </SidebarProvider>
      </ChatSheetProvider>
    </WorkspaceProvider>
  )
}
