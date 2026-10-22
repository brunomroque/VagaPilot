"use client"

import { useMemo, useState, type KeyboardEvent } from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { GripVerticalIcon, PlusIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import type { ApplicationStatus } from "@vagapilot/core/status"
import type { TrackerApplication } from "@vagapilot/core/tracker"

import { CompanyLogo } from "@/components/app/company-logo"
import {
  companyInitials,
  DueBadge,
  StatusBadge,
} from "@/components/app/tracker-ui"
import { useWorkspace } from "@/components/app/workspace-context"
import {
  boardColumns,
  columnByStatus,
  isBoardColumn,
  resolveDrop,
  type BoardColumn,
} from "@/lib/board"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

/** Arrow left/right jump the dragged card to the neighbouring column. */
const columnKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context }
) => {
  const direction =
    event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0
  if (direction === 0) return undefined
  event.preventDefault()

  const { collisionRect, droppableRects, droppableContainers } = context
  if (!collisionRect) return undefined

  const columns = droppableContainers
    .getEnabled()
    .flatMap((container) => {
      const rect = droppableRects.get(container.id)
      return rect ? [rect] : []
    })
    .sort((a, b) => a.left - b.left)
  const centerX = collisionRect.left + collisionRect.width / 2
  const current = columns.findIndex(
    (rect) => centerX >= rect.left && centerX <= rect.left + rect.width
  )
  const target = columns[(current === -1 ? 0 : current) + direction]
  if (!target) return undefined

  return {
    x: target.left + (target.width - collisionRect.width) / 2,
    y: target.top + 56,
  }
}

function JobCardBody({
  application,
  dragging,
}: {
  application: TrackerApplication
  dragging?: boolean
}) {
  const t = useTranslations("Board")
  const { now } = useWorkspace()

  return (
    <Card
      size="sm"
      className={cn(
        "transition-shadow group-hover/job:ring-primary/40 group-focus-visible/job:ring-2 group-focus-visible/job:ring-ring",
        dragging && "shadow-lg ring-primary/40"
      )}
    >
      <CardHeader className="grid-cols-[1fr_auto] items-start">
        <CompanyLogo initials={companyInitials(application.company)} />
        <span
          className="flex flex-col items-end leading-none"
          aria-hidden="true"
        >
          <span className="font-heading text-base font-extrabold text-primary">
            {application.fitScore === null ? "—" : `${application.fitScore}%`}
          </span>
          <span className="text-[0.65rem] text-muted-foreground uppercase">
            {t("fit")}
          </span>
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        <CardDescription>{application.company}</CardDescription>
        <CardTitle className="font-semibold">{application.roleTitle}</CardTitle>
        {application.location ? (
          <p className="text-xs text-muted-foreground">
            {application.location}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-2 bg-transparent">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <StatusBadge status={application.status} />
          {application.nextAction ? (
            <DueBadge dueAt={application.nextActionDueAt} now={now} />
          ) : null}
        </div>
        <GripVerticalIcon
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
      </CardFooter>
    </Card>
  )
}

function DraggableJobCard({
  application,
  onOpen,
}: {
  application: TrackerApplication
  onOpen: () => void
}) {
  const t = useTranslations("Board")
  const tStatus = useTranslations("Status")
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: application.id,
  })
  const column = columnByStatus[application.status]

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    listeners?.onKeyDown?.(event)
    if (event.key === "Enter" && !event.defaultPrevented) onOpen()
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={onOpen}
      data-testid={`job-card-${application.id}`}
      data-company={application.company}
      aria-label={t("card", {
        role: application.roleTitle,
        company: application.company,
        fit:
          application.fitScore === null
            ? t("fitNone")
            : t("fitLabel", { fit: application.fitScore }),
        status: tStatus(application.status),
        column: t(`columns.${column}`),
      })}
      className={cn(
        "group/job cursor-grab touch-manipulation rounded-xl outline-none active:cursor-grabbing",
        isDragging && "opacity-40"
      )}
    >
      <JobCardBody application={application} />
    </div>
  )
}

function BoardColumnView({
  column,
  applications,
  onOpen,
  onAdd,
}: {
  column: BoardColumn
  applications: TrackerApplication[]
  onOpen: (id: string) => void
  onAdd: () => void
}) {
  const t = useTranslations("Board")
  const { setNodeRef, isOver } = useDroppable({ id: column })
  const headingId = `column-${column}`

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      data-testid={`column-${column}`}
      className={cn(
        "flex w-64 shrink-0 flex-col gap-3 rounded-2xl bg-muted/60 p-3 transition-colors xl:w-auto xl:min-w-0",
        isOver && "bg-secondary ring-2 ring-primary/30"
      )}
    >
      <header className="flex flex-col gap-0.5 px-1">
        <div className="flex items-center gap-2">
          <h3 id={headingId} className="text-sm font-bold">
            {t(`columns.${column}`)}
          </h3>
          <Badge variant="outline">{applications.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(`columnDescriptions.${column}`)}
        </p>
      </header>
      <div className="flex min-h-24 flex-col gap-3">
        {applications.map((application) => (
          <DraggableJobCard
            key={application.id}
            application={application}
            onOpen={() => onOpen(application.id)}
          />
        ))}
        {column === "descobertas" ? (
          <Button
            variant="ghost"
            className="border border-dashed"
            onClick={onAdd}
          >
            <PlusIcon data-icon="inline-start" />
            {t("addJob")}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

type PendingChoice = {
  application: TrackerApplication
  column: BoardColumn
  options: ApplicationStatus[]
}

function StatusChoiceDialog({
  choice,
  onClose,
  onChoose,
}: {
  choice: PendingChoice | null
  onClose: () => void
  onChoose: (status: ApplicationStatus) => void
}) {
  const t = useTranslations("Tracker.transitions")
  const tBoard = useTranslations("Board")
  const tStatus = useTranslations("Status")
  const tCommon = useTranslations("Common")

  return (
    <Dialog open={choice !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("chooseTitle")}</DialogTitle>
          <DialogDescription>
            {choice
              ? t("chooseDescription", {
                  company: choice.application.company,
                  column: tBoard(`columns.${choice.column}`),
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {choice?.options.map((status, index) => (
            <Button
              key={status}
              variant={index === 0 ? "default" : "outline"}
              autoFocus={index === 0}
              onClick={() => onChoose(status)}
            >
              {tStatus(status)}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>
            {t("cancel")}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Kanban of the four visual columns; drops go through the status machine (spec 9.4). */
export function ApplicationBoard({
  applications,
}: {
  applications: TrackerApplication[]
}) {
  const t = useTranslations("Board")
  const tStatus = useTranslations("Status")
  const tTransitions = useTranslations("Tracker.transitions")
  const { changeStatus, selectApplication, openCreate } = useWorkspace()
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [choice, setChoice] = useState<PendingChoice | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: columnKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    })
  )

  const byColumn = useMemo(() => {
    const groups = Object.fromEntries(
      boardColumns.map((column) => [column, [] as TrackerApplication[]])
    ) as Record<BoardColumn, TrackerApplication[]>
    for (const application of applications)
      groups[columnByStatus[application.status]].push(application)
    return groups
  }, [applications])

  const byId = (id: UniqueIdentifier) =>
    applications.find((application) => application.id === id)
  const columnLabel = (id: UniqueIdentifier | undefined) =>
    isBoardColumn(id) ? t(`columns.${id}`) : ""

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const application = byId(active.id)
      return application
        ? t("dnd.picked", {
            company: application.company,
            column: t(`columns.${columnByStatus[application.status]}`),
          })
        : undefined
    },
    onDragOver: ({ active, over }) => {
      const application = byId(active.id)
      return application && over
        ? t("dnd.over", {
            company: application.company,
            column: columnLabel(over.id),
          })
        : undefined
    },
    onDragEnd: ({ active, over }) => {
      const application = byId(active.id)
      return application && over
        ? t("dnd.dropped", {
            company: application.company,
            column: columnLabel(over.id),
          })
        : undefined
    },
    onDragCancel: ({ active }) => {
      const application = byId(active.id)
      return application
        ? t("dnd.cancelled", { company: application.company })
        : undefined
    },
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const target = event.over?.id
    const application = byId(event.active.id)
    if (!isBoardColumn(target) || !application) return

    const resolution = resolveDrop(application.status, target)
    switch (resolution.kind) {
      case "same_column":
        return
      case "single":
        changeStatus(application, resolution.status)
        return
      case "choose":
        setChoice({ application, column: target, options: resolution.options })
        return
      case "invalid":
        toast.error(
          tTransitions("invalidColumn", {
            company: application.company,
            from: tStatus(application.status),
            column: t(`columns.${target}`),
          }),
          { description: tTransitions("reasons.not_allowed") }
        )
        return
      default: {
        const unreachable: never = resolution
        throw new Error(`Unknown drop: ${JSON.stringify(unreachable)}`)
      }
    }
  }

  const active = activeId === null ? undefined : byId(activeId)

  return (
    <>
      <DndContext
        id="application-board"
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={(event: DragStartEvent) => setActiveId(event.active.id)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: t("dnd.instructions") },
        }}
      >
        <div
          role="region"
          aria-label={t("label")}
          className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0 xl:grid xl:grid-cols-4 xl:overflow-visible"
        >
          {boardColumns.map((column) => (
            <BoardColumnView
              key={column}
              column={column}
              applications={byColumn[column]}
              onOpen={selectApplication}
              onAdd={() => openCreate()}
            />
          ))}
        </div>
        <DragOverlay>
          {active ? <JobCardBody application={active} dragging /> : null}
        </DragOverlay>
      </DndContext>
      <StatusChoiceDialog
        choice={choice}
        onClose={() => setChoice(null)}
        onChoose={(status) => {
          if (choice) changeStatus(choice.application, status)
          setChoice(null)
        }}
      />
    </>
  )
}
