"use client"

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useMemo,
  useOptimistic,
  useState,
  type ReactNode,
} from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { checkTransition, type ApplicationStatus } from "@vagapilot/core/status"
import {
  pendingActions,
  type TrackerApplication,
} from "@vagapilot/core/tracker"

import {
  changeApplicationStatus,
  completeNextAction,
} from "@/lib/tracker/actions"
import type {
  ActionResult,
  CvOption,
  GmailStatus,
  NotificationItem,
  TrackerData,
} from "@/lib/tracker/types"

type OptimisticPatch = { id: string; changes: Partial<TrackerApplication> }

type CreateDefaults = { link?: string }

type WorkspaceState = {
  applications: TrackerApplication[]
  cvVersions: CvOption[]
  gmail: GmailStatus | null
  notifications: NotificationItem[]
  loadError: boolean
  /** Server time of the last render, so server and client compute the same metrics. */
  now: Date
  /** Applications with a pending next action (sidebar badge, "Suas ações"). */
  openTaskCount: number
  selectedApplication: TrackerApplication | null
  selectApplication: (id: string | null) => void
  changeStatus: (application: TrackerApplication, to: ApplicationStatus) => void
  completeAction: (application: TrackerApplication) => void
  createOpen: boolean
  createDefaults: CreateDefaults
  openCreate: (defaults?: CreateDefaults) => void
  setCreateOpen: (open: boolean) => void
  importOpen: boolean
  setImportOpen: (open: boolean) => void
  analyzeOpen: boolean
  setAnalyzeOpen: (open: boolean) => void
  commandOpen: boolean
  setCommandOpen: (open: boolean) => void
}

const WorkspaceContext = createContext<WorkspaceState | null>(null)

function applyPatch(state: TrackerApplication[], patch: OptimisticPatch) {
  return state.map((item) =>
    item.id === patch.id ? { ...item, ...patch.changes } : item
  )
}

/**
 * Tracker state for the whole /app shell. Data comes from the server layout (RLS-scoped);
 * mutations are server actions that call `refresh()`, with optimistic updates that roll back
 * on failure because the optimistic layer is dropped when the transition ends.
 */
export function WorkspaceProvider({
  data,
  nowIso,
  children,
}: {
  data: TrackerData
  nowIso: string
  children: ReactNode
}) {
  const t = useTranslations("Tracker")
  const tStatus = useTranslations("Status")
  const tTasks = useTranslations("Tasks")
  const [applications, applyOptimistic] = useOptimistic(
    data.applications,
    applyPatch
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createDefaults, setCreateDefaults] = useState<CreateDefaults>({})
  const [importOpen, setImportOpen] = useState(false)
  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)

  const reportFailure = useCallback(
    (result: Extract<ActionResult<unknown>, { ok: false }>) => {
      toast.error(
        result.error.code === "status_conflict"
          ? t("transitions.conflict")
          : t("transitions.error")
      )
    },
    [t]
  )

  const changeStatus = useCallback(
    (application: TrackerApplication, to: ApplicationStatus) => {
      const check = checkTransition(application.status, to, {
        source: "usuario",
      })
      if (!check.ok) {
        toast.error(
          t("transitions.invalid", {
            company: application.company,
            from: tStatus(application.status),
            to: tStatus(to),
          }),
          { description: t(`transitions.reasons.${check.reason}`) }
        )
        return
      }
      startTransition(async () => {
        applyOptimistic({ id: application.id, changes: { status: to } })
        const result = await changeApplicationStatus({
          id: application.id,
          from: application.status,
          to,
        })
        if (result.ok) {
          toast.success(
            t("transitions.moved", {
              company: application.company,
              status: tStatus(to),
            })
          )
        } else {
          reportFailure(result)
        }
      })
    },
    [applyOptimistic, reportFailure, t, tStatus]
  )

  const completeAction = useCallback(
    (application: TrackerApplication) => {
      startTransition(async () => {
        applyOptimistic({
          id: application.id,
          changes: { nextAction: null, nextActionDueAt: null },
        })
        const result = await completeNextAction({ id: application.id })
        if (result.ok) toast.success(tTasks("completed"))
        else reportFailure(result)
      })
    },
    [applyOptimistic, reportFailure, tTasks]
  )

  const openCreate = useCallback((defaults: CreateDefaults = {}) => {
    setCreateDefaults(defaults)
    setCreateOpen(true)
  }, [])

  const now = useMemo(() => new Date(nowIso), [nowIso])

  const value = useMemo<WorkspaceState>(
    () => ({
      applications,
      cvVersions: data.cvVersions,
      gmail: data.gmail,
      notifications: data.notifications,
      loadError: data.loadError,
      now,
      openTaskCount: pendingActions(applications).length,
      selectedApplication:
        applications.find((item) => item.id === selectedId) ?? null,
      selectApplication: setSelectedId,
      changeStatus,
      completeAction,
      createOpen,
      createDefaults,
      openCreate,
      setCreateOpen,
      importOpen,
      setImportOpen,
      analyzeOpen,
      setAnalyzeOpen,
      commandOpen,
      setCommandOpen,
    }),
    [
      applications,
      data.cvVersions,
      data.gmail,
      data.notifications,
      data.loadError,
      now,
      selectedId,
      changeStatus,
      completeAction,
      createOpen,
      createDefaults,
      openCreate,
      importOpen,
      analyzeOpen,
      commandOpen,
    ]
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context)
    throw new Error("useWorkspace must be used inside WorkspaceProvider")
  return context
}
