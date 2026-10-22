"use client"

import { useMemo, useState } from "react"
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import {
  allowedTransitions,
  APPLICATION_STATUSES,
  statusRank,
} from "@vagapilot/core/status"
import { referenceDate, type TrackerApplication } from "@vagapilot/core/tracker"

import { DueBadge, StatusBadge } from "@/components/app/tracker-ui"
import { useWorkspace } from "@/components/app/workspace-context"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
})

const helper = createColumnHelper<typeof features, TrackerApplication>()

const PAGE_SIZE = 20

function RowActions({ application }: { application: TrackerApplication }) {
  const t = useTranslations("Tracker.table")
  const tStatus = useTranslations("Status")
  const { changeStatus, selectApplication } = useWorkspace()
  const options = allowedTransitions(application.status, { source: "usuario" })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("rowActions", { company: application.company })}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => selectApplication(application.id)}>
            {t("open")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("changeStatus")}</DropdownMenuLabel>
          {options.length === 0 ? (
            <DropdownMenuItem disabled>{t("noTransitions")}</DropdownMenuItem>
          ) : (
            options.map((status) => (
              <DropdownMenuItem
                key={status}
                onClick={() => changeStatus(application, status)}
              >
                {tStatus(status)}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** TanStack Table view (P3.1). Rows arrive already filtered by the shared tracker filters. */
export function ApplicationsTable({
  applications,
}: {
  applications: TrackerApplication[]
}) {
  const t = useTranslations("Tracker")
  const format = useFormatter()
  const { selectApplication, now } = useWorkspace()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "date", desc: true },
  ])
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor((row) => `${row.company} ${row.roleTitle}`, {
          id: "company",
          header: t("table.company"),
          sortFn: "alphanumeric",
          cell: ({ row }) => (
            <button
              type="button"
              onClick={() => selectApplication(row.original.id)}
              className="flex min-w-0 flex-col rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate font-semibold">
                {row.original.company}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {row.original.roleTitle}
              </span>
            </button>
          ),
        }),
        helper.accessor(
          (row) =>
            statusRank(row.status) * 100 +
            APPLICATION_STATUSES.indexOf(row.status),
          {
            id: "status",
            header: t("table.status"),
            sortFn: "basic",
            cell: ({ row }) => <StatusBadge status={row.original.status} />,
          }
        ),
        helper.accessor((row) => t(`sources.${row.source}`), {
          id: "source",
          header: t("table.source"),
          sortFn: "alphanumeric",
          cell: ({ getValue }) => getValue(),
        }),
        helper.accessor((row) => (row.route ? t(`routes.${row.route}`) : ""), {
          id: "route",
          header: t("table.route"),
          sortFn: "alphanumeric",
          cell: ({ getValue }) => getValue() || "—",
        }),
        helper.accessor((row) => row.fitScore ?? undefined, {
          id: "fit",
          header: t("table.fit"),
          sortFn: "basic",
          sortUndefined: "last",
          cell: ({ row }) =>
            row.original.fitScore === null ? "—" : `${row.original.fitScore}%`,
        }),
        helper.accessor((row) => referenceDate(row).getTime(), {
          id: "date",
          header: t("table.date"),
          sortFn: "basic",
          cell: ({ row }) =>
            format.dateTime(referenceDate(row.original), {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            }),
        }),
        helper.accessor(
          (row) =>
            row.nextAction
              ? row.nextActionDueAt
                ? new Date(row.nextActionDueAt).getTime()
                : Number.MAX_SAFE_INTEGER
              : undefined,
          {
            id: "next",
            header: t("table.next"),
            sortFn: "basic",
            sortUndefined: "last",
            cell: ({ row }) =>
              row.original.nextAction ? (
                <div className="flex min-w-0 flex-col items-start gap-1">
                  <span className="max-w-56 truncate text-sm">
                    {row.original.nextAction}
                  </span>
                  <DueBadge dueAt={row.original.nextActionDueAt} now={now} />
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          }
        ),
        helper.display({
          id: "actions",
          header: () => <span className="sr-only">{t("table.actions")}</span>,
          cell: ({ row }) => <RowActions application={row.original} />,
        }),
      ]),
    [format, now, selectApplication, t]
  )

  const table = useTable({
    features,
    columns,
    data: applications,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  })

  const pageCount = Math.max(1, table.getPageCount())

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table data-testid="applications-table">
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  const canSort = header.column.getCanSort()
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : canSort
                              ? "none"
                              : undefined
                      }
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-2"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {sorted === "asc" ? (
                            <ArrowUpIcon data-icon="inline-end" />
                          ) : sorted === "desc" ? (
                            <ArrowDownIcon data-icon="inline-end" />
                          ) : (
                            <ArrowUpDownIcon data-icon="inline-end" />
                          )}
                        </Button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-testid={`row-${row.original.id}`}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className="align-top">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pageCount > 1 ? (
        <nav
          aria-label={t("table.pagination")}
          className="flex items-center justify-end gap-2"
        >
          <span className="text-sm text-muted-foreground">
            {t("table.page", {
              page: pagination.pageIndex + 1,
              pages: pageCount,
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeftIcon data-icon="inline-start" />
            {t("table.previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {t("table.nextPage")}
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
