import type { NextRequest } from "next/server"
import { getTranslations } from "next-intl/server"

import {
  DEFAULT_TIME_ZONE,
  formatDateBR,
  formatDateTimeBR,
} from "@vagapilot/core/dates"
import {
  filterApplications,
  hasActiveFilters,
  pendingActions,
  periodStart,
  referenceDate,
  summarizeApplications,
  JOB_SOURCES,
} from "@vagapilot/core/tracker"
import { buildTrackerCsv } from "@vagapilot/core/tracker-csv"

import { apiError } from "@/lib/http"
import { listApplications } from "@/lib/tracker/queries"
import { renderTrackerReport, type ReportData } from "@/lib/tracker/report-pdf"
import { exportQuerySchema } from "@/lib/tracker/schemas"
import {
  audit,
  getTrackerLabels,
  getTrackerSession,
} from "@/lib/tracker/server"

/** GET /api/applications/export?format=csv|pdf (spec 8.5, RF10.5, RF10A.1/2, J6). */
export async function GET(request: NextRequest) {
  const session = await getTrackerSession()
  if ("error" in session) {
    return session.error === "unauthorized"
      ? apiError("unauthorized", "Sign in to export.", 401)
      : apiError("not_configured", "Supabase is not configured.", 503)
  }

  const parsed = exportQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  )
  if (!parsed.success)
    return apiError("invalid_request", "Invalid export filters.", 400)
  const { format, ...filters } = parsed.data

  const all = await listApplications(session.supabase)
  if (!all)
    return apiError("internal_error", "Could not read the applications.", 500)

  const now = new Date()
  const timeZone = DEFAULT_TIME_ZONE
  const rows = filterApplications(all, filters, now, timeZone).sort(
    (a, b) => referenceDate(b).getTime() - referenceDate(a).getTime()
  )
  const labels = await getTrackerLabels()
  const stamp = formatDateBR(now, timeZone).split("/").reverse().join("-")

  let body: BodyInit
  let contentType: string
  if (format === "csv") {
    body = buildTrackerCsv(rows, labels, timeZone)
    contentType = "text/csv; charset=utf-8"
  } else {
    const t = await getTranslations("Tracker.export.pdf")
    const tPeriod = await getTranslations("Tracker.filters.periods")
    const period = filters.period ?? "tudo"
    const start = periodStart(period, now, timeZone)
    const summary = summarizeApplications(rows)
    const data: ReportData = {
      strings: {
        title: t("title"),
        subtitle: t("subtitle", { name: session.user.displayName }),
        periodLine: start
          ? t("periodRange", {
              period: tPeriod(period),
              from: formatDateBR(start, timeZone),
              to: formatDateBR(now, timeZone),
            })
          : t("periodAll"),
        generatedLine: t("generated", {
          date: formatDateTimeBR(now, timeZone),
        }),
        totalsTitle: t("totals"),
        total: t("total"),
        responseRate: t("responseRate"),
        byStatus: t("byStatus"),
        bySource: t("bySource"),
        byTrack: t("byTrack"),
        withoutTrack: t("withoutTrack"),
        tableTitle: t("table"),
        legend: t("legend"),
        empty: t("empty"),
        actionsTitle: t("actions"),
        actionsEmpty: t("actionsEmpty"),
        noDue: t("noDue"),
        page: t("page", { page: "{page}", total: "{total}" }),
        columns: {
          date: labels.headers.date,
          company: labels.headers.company,
          role: labels.headers.role,
          source: labels.headers.source,
          status: labels.headers.status,
          next: t("nextColumn"),
        },
      },
      summary,
      statusLabels: labels.status,
      sourceRows: JOB_SOURCES.filter(
        (source) => (summary.bySource[source] ?? 0) > 0
      ).map((source) => ({
        label: labels.source[source],
        count: summary.bySource[source] ?? 0,
      })),
      rows: rows.map((row) => ({
        id: row.id,
        date: formatDateBR(referenceDate(row), timeZone),
        company: row.company,
        role: row.roleTitle,
        source: labels.source[row.source],
        status: row.status,
        statusLabel: labels.status[row.status],
        next: row.nextAction
          ? row.nextActionDueAt
            ? `${row.nextAction} · ${formatDateTimeBR(new Date(row.nextActionDueAt), timeZone)}`
            : row.nextAction
          : "",
      })),
      actions: pendingActions(rows).map((action) => ({
        id: action.applicationId,
        title: action.action,
        company: action.company,
        due: action.dueAt
          ? formatDateTimeBR(new Date(action.dueAt), timeZone)
          : t("noDue"),
      })),
    }
    const buffer = await renderTrackerReport(data)
    body = new Uint8Array(buffer)
    contentType = "application/pdf"
  }

  await audit(session.supabase, {
    userId: session.user.id,
    actor: "usuario",
    action: "data.exported",
    targetType: "applications",
    details: { format, rows: rows.length, filtered: hasActiveFilters(filters) },
  })

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="vagapilot-candidaturas-${stamp}.${format}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
