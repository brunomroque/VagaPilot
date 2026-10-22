"use client"

import {
  CalendarRangeIcon,
  ChevronDownIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "@vagapilot/core/status"
import {
  APPLICATION_ROUTES,
  FIT_LEVELS,
  JOB_SOURCES,
  NO_FIT,
  PERIOD_PRESETS,
  isPeriodPreset,
  type ApplicationRoute,
  type FitFilter,
  type JobSource,
  type PeriodPreset,
  type TrackerFilters,
} from "@vagapilot/core/tracker"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

export const FIT_FILTERS: readonly FitFilter[] = [...FIT_LEVELS, NO_FIT]

export type FilterDimension = "status" | "source" | "route" | "fit"

type DimensionValue = {
  status: ApplicationStatus
  source: JobSource
  route: ApplicationRoute
  fit: FitFilter
}

const DIMENSION_VALUES: {
  [K in FilterDimension]: readonly DimensionValue[K][]
} = {
  status: APPLICATION_STATUSES,
  source: JOB_SOURCES,
  route: APPLICATION_ROUTES,
  fit: FIT_FILTERS,
}

function toggle<T>(
  list: readonly T[] | undefined,
  value: T,
  checked: boolean
): T[] {
  const current = list ?? []
  return checked
    ? [...current.filter((item) => item !== value), value]
    : current.filter((item) => item !== value)
}

function useDimensionLabel() {
  const tStatus = useTranslations("Status")
  const t = useTranslations("Tracker")
  return function label<K extends FilterDimension>(
    dimension: K,
    value: DimensionValue[K]
  ) {
    switch (dimension) {
      case "status":
        return tStatus(value as ApplicationStatus)
      case "source":
        return t(`sources.${value as JobSource}`)
      case "route":
        return t(`routes.${value as ApplicationRoute}`)
      case "fit":
        return t(`fit.${value as FitFilter}`)
      default:
        throw new Error(`Unknown dimension: ${String(dimension)}`)
    }
  }
}

function DimensionItems<K extends FilterDimension>({
  dimension,
  filters,
  onChange,
}: {
  dimension: K
  filters: TrackerFilters
  onChange: (filters: TrackerFilters) => void
}) {
  const label = useDimensionLabel()
  const selected = (filters[dimension] ?? []) as readonly DimensionValue[K][]
  return (
    <>
      {DIMENSION_VALUES[dimension].map((value) => (
        <DropdownMenuCheckboxItem
          key={value}
          checked={selected.includes(value)}
          closeOnClick={false}
          onCheckedChange={(checked) =>
            onChange({
              ...filters,
              [dimension]: toggle(selected, value, checked),
            })
          }
        >
          {label(dimension, value)}
        </DropdownMenuCheckboxItem>
      ))}
    </>
  )
}

/** One multi-select filter (status, fonte, rota or fit) as a checkbox menu. */
export function FilterMenu({
  dimension,
  filters,
  onChange,
}: {
  dimension: FilterDimension
  filters: TrackerFilters
  onChange: (filters: TrackerFilters) => void
}) {
  const t = useTranslations("Tracker.filters")
  const count = filters[dimension]?.length ?? 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" data-testid={`filter-${dimension}`} />
        }
      >
        {t(dimension)}
        {count > 0 ? <Badge>{count}</Badge> : null}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t(dimension)}</DropdownMenuLabel>
          <DimensionItems
            dimension={dimension}
            filters={filters}
            onChange={onChange}
          />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Compact menu with several dimensions (overview toolbar). */
export function CombinedFilterMenu({
  dimensions,
  filters,
  onChange,
}: {
  dimensions: readonly FilterDimension[]
  filters: TrackerFilters
  onChange: (filters: TrackerFilters) => void
}) {
  const t = useTranslations("Tracker.filters")
  const count = dimensions.reduce(
    (total, dimension) => total + (filters[dimension]?.length ?? 0),
    0
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" data-testid="filter-menu" />}
      >
        <SlidersHorizontalIcon data-icon="inline-start" />
        {t("button")}
        {count > 0 ? (
          <Badge aria-label={t("active", { count })}>{count}</Badge>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-60">
        {dimensions.map((dimension, index) => (
          <DropdownMenuGroup key={dimension}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{t(dimension)}</DropdownMenuLabel>
            <DimensionItems
              dimension={dimension}
              filters={filters}
              onChange={onChange}
            />
          </DropdownMenuGroup>
        ))}
        {count > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() =>
                  onChange(
                    Object.fromEntries(
                      Object.entries(filters).filter(
                        ([key]) =>
                          !(dimensions as readonly string[]).includes(key)
                      )
                    )
                  )
                }
              >
                {t("clear")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function PeriodMenu({
  value,
  onChange,
}: {
  value: PeriodPreset
  onChange: (period: PeriodPreset) => void
}) {
  const t = useTranslations("Tracker.filters")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            data-testid="filter-period"
            aria-label={`${t("period")}: ${t(`periods.${value}`)}`}
          />
        }
      >
        <CalendarRangeIcon data-icon="inline-start" />
        {t(`periods.${value}`)}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("period")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => {
              if (isPeriodPreset(next)) onChange(next)
            }}
          >
            {PERIOD_PRESETS.map((period) => (
              <DropdownMenuRadioItem key={period} value={period}>
                {t(`periods.${period}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
