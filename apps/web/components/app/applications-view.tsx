"use client"

import { useMemo, useState } from "react"
import {
  DownloadIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  KanbanIcon,
  PlusIcon,
  SearchIcon,
  TableIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import {
  filterApplications,
  hasActiveFilters,
  type TrackerFilters,
} from "@vagapilot/core/tracker"

import { ApplicationBoard } from "@/components/app/application-board"
import { ApplicationsTable } from "@/components/app/applications-table"
import { LoadErrorAlert } from "@/components/app/load-error-alert"
import { FilterMenu, PeriodMenu } from "@/components/app/tracker-filters"
import { useWorkspace } from "@/components/app/workspace-context"
import { filtersToSearchParams, type ExportFormat } from "@/lib/tracker/schemas"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

function exportHref(filters: TrackerFilters, format: ExportFormat) {
  return `/api/applications/export?${filtersToSearchParams(filters, format).toString()}`
}

/** Candidaturas page (P3.1/P3.2): shared filters, table and kanban tabs, import and export. */
export function ApplicationsView() {
  const t = useTranslations("Tracker")
  const { applications, now, loadError, openCreate, setImportOpen } =
    useWorkspace()
  const [filters, setFilters] = useState<TrackerFilters>({ period: "tudo" })
  const visible = useMemo(
    () => filterApplications(applications, filters, now),
    [applications, filters, now]
  )
  const filtered = hasActiveFilters(filters)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold tracking-tight">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <UploadIcon data-icon="inline-start" />
            {t("importAction")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              <DownloadIcon data-icon="inline-start" />
              {t("exportAction")}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  render={<a href={exportHref(filters, "csv")} download />}
                >
                  <FileSpreadsheetIcon />
                  {t("exportCsv")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={<a href={exportHref(filters, "pdf")} download />}
                >
                  <FileTextIcon />
                  {t("exportPdf")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => openCreate()}>
            <PlusIcon data-icon="inline-start" />
            {t("new")}
          </Button>
        </div>
      </div>

      {loadError ? <LoadErrorAlert /> : null}

      <div
        role="search"
        aria-label={t("filters.label")}
        className="flex flex-wrap items-center gap-2"
      >
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={filters.q ?? ""}
            onChange={(event) =>
              setFilters({ ...filters, q: event.target.value })
            }
            placeholder={t("search.placeholder")}
            aria-label={t("search.label")}
          />
        </InputGroup>
        <FilterMenu
          dimension="status"
          filters={filters}
          onChange={setFilters}
        />
        <FilterMenu
          dimension="source"
          filters={filters}
          onChange={setFilters}
        />
        <FilterMenu dimension="route" filters={filters} onChange={setFilters} />
        <FilterMenu dimension="fit" filters={filters} onChange={setFilters} />
        <PeriodMenu
          value={filters.period ?? "tudo"}
          onChange={(period) => setFilters({ ...filters, period })}
        />
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => setFilters({ period: "tudo" })}
          >
            <XIcon data-icon="inline-start" />
            {t("filters.clear")}
          </Button>
        ) : null}
        <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
          {t("count", { shown: visible.length, total: applications.length })}
        </p>
      </div>

      <Tabs defaultValue="table">
        <TabsList>
          <TabsTrigger value="table">
            <TableIcon />
            {t("tabs.table")}
          </TabsTrigger>
          <TabsTrigger value="board">
            <KanbanIcon />
            {t("tabs.board")}
          </TabsTrigger>
        </TabsList>
        {visible.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>
                {filtered ? t("table.emptyFiltered") : t("table.emptyTitle")}
              </EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? t("table.emptyFilteredDescription")
                  : t("table.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {filtered ? (
                <Button
                  variant="outline"
                  onClick={() => setFilters({ period: "tudo" })}
                >
                  {t("filters.clear")}
                </Button>
              ) : (
                <Button onClick={() => openCreate()}>
                  <PlusIcon data-icon="inline-start" />
                  {t("new")}
                </Button>
              )}
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <TabsContent value="table">
              <ApplicationsTable applications={visible} />
            </TabsContent>
            <TabsContent value="board">
              <ApplicationBoard applications={visible} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </section>
  )
}
