import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer"

import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "@vagapilot/core/status"
import type { TrackerSummary } from "@vagapilot/core/tracker"

import {
  REPORT_BORDER,
  REPORT_MUTED,
  REPORT_PRIMARY,
  REPORT_TEXT,
  STATUS_PALETTE,
} from "./palette"

/** All visible text, already translated and formatted by the caller (next-intl on the server). */
export type ReportStrings = {
  title: string
  subtitle: string
  periodLine: string
  generatedLine: string
  totalsTitle: string
  total: string
  responseRate: string
  byStatus: string
  bySource: string
  byTrack: string
  withoutTrack: string
  tableTitle: string
  legend: string
  empty: string
  actionsTitle: string
  actionsEmpty: string
  noDue: string
  page: string
  columns: {
    date: string
    company: string
    role: string
    source: string
    status: string
    next: string
  }
}

export type ReportRow = {
  id: string
  date: string
  company: string
  role: string
  source: string
  status: ApplicationStatus
  statusLabel: string
  next: string
}

export type ReportAction = {
  id: string
  title: string
  company: string
  due: string
}

export type ReportData = {
  strings: ReportStrings
  summary: TrackerSummary
  statusLabels: Record<ApplicationStatus, string>
  sourceRows: { label: string; count: number }[]
  rows: ReportRow[]
  actions: ReportAction[]
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: REPORT_TEXT,
  },
  title: { fontFamily: "Helvetica-Bold", fontSize: 22, color: REPORT_PRIMARY },
  subtitle: { fontSize: 11, marginTop: 4, color: REPORT_MUTED },
  meta: { fontSize: 10, marginTop: 2 },
  h2: {
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    marginBottom: 8,
    marginTop: 18,
  },
  h3: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 4 },
  kpis: { flexDirection: "row", gap: 12, marginTop: 16 },
  kpi: {
    flexGrow: 1,
    borderWidth: 1,
    borderColor: REPORT_BORDER,
    borderRadius: 6,
    padding: 10,
  },
  kpiValue: { fontFamily: "Helvetica-Bold", fontSize: 20 },
  kpiLabel: { color: REPORT_MUTED, marginTop: 2 },
  columns: { flexDirection: "row", gap: 16 },
  column: { flexGrow: 1, flexBasis: 0 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: REPORT_BORDER,
  },
  swatch: { width: 8, height: 8, borderRadius: 2, marginRight: 4 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  legendItem: { flexDirection: "row", alignItems: "center" },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: REPORT_PRIMARY,
    color: "#FFFFFF",
    fontFamily: "Helvetica-Bold",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#FFFFFF",
  },
  cell: { paddingVertical: 4, paddingHorizontal: 5 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    color: REPORT_MUTED,
    fontSize: 8,
  },
})

const widths = {
  date: "10%",
  company: "18%",
  role: "22%",
  source: "11%",
  status: "14%",
  next: "25%",
} as const

function Footer({ strings }: { strings: ReportStrings }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{strings.title}</Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          strings.page
            .replace("{page}", String(pageNumber))
            .replace("{total}", String(totalPages))
        }
      />
    </View>
  )
}

function TotalList({
  title,
  items,
}: {
  title: string
  items: { key: string; label: string; count: number; swatch?: string }[]
}) {
  return (
    <View style={styles.column}>
      <Text style={styles.h3}>{title}</Text>
      {items.map((item) => (
        <View key={item.key} style={styles.totalRow}>
          <View style={styles.legendItem}>
            {item.swatch ? (
              <View style={[styles.swatch, { backgroundColor: item.swatch }]} />
            ) : null}
            <Text>{item.label}</Text>
          </View>
          <Text>{item.count}</Text>
        </View>
      ))}
    </View>
  )
}

export function TrackerReport({ data }: { data: ReportData }) {
  const { strings, summary } = data
  const statusItems = APPLICATION_STATUSES.filter(
    (status) => summary.byStatus[status] > 0
  ).map((status) => ({
    key: status,
    label: data.statusLabels[status],
    count: summary.byStatus[status],
    swatch: STATUS_PALETTE[status].swatch,
  }))
  const trackItems = [
    ...summary.byTrack.map((item) => ({
      key: item.track,
      label: item.track,
      count: item.count,
    })),
    ...(summary.withoutTrack > 0
      ? [
          {
            key: "__none",
            label: strings.withoutTrack,
            count: summary.withoutTrack,
          },
        ]
      : []),
  ]

  return (
    <Document title={strings.title} language="pt-BR" author="VagaPilot">
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>{strings.title}</Text>
        <Text style={styles.subtitle}>{strings.subtitle}</Text>
        <Text style={styles.meta}>{strings.periodLine}</Text>
        <Text style={styles.meta}>{strings.generatedLine}</Text>
        <View style={styles.kpis}>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>{summary.total}</Text>
            <Text style={styles.kpiLabel}>{strings.total}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>
              {summary.responseRate === null
                ? "—"
                : `${Math.round(summary.responseRate * 100)}%`}
            </Text>
            <Text style={styles.kpiLabel}>{strings.responseRate}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>{data.actions.length}</Text>
            <Text style={styles.kpiLabel}>{strings.actionsTitle}</Text>
          </View>
        </View>
        <Text style={styles.h2}>{strings.totalsTitle}</Text>
        <View style={styles.columns}>
          <TotalList title={strings.byStatus} items={statusItems} />
          <TotalList
            title={strings.bySource}
            items={data.sourceRows.map((item) => ({
              key: item.label,
              ...item,
            }))}
          />
          <TotalList title={strings.byTrack} items={trackItems} />
        </View>
        <Footer strings={strings} />
      </Page>

      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={[styles.h2, { marginTop: 0 }]}>{strings.tableTitle}</Text>
        <Text style={styles.h3}>{strings.legend}</Text>
        <View style={styles.legend}>
          {APPLICATION_STATUSES.map((status) => (
            <View key={status} style={styles.legendItem}>
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: STATUS_PALETTE[status].swatch },
                ]}
              />
              <Text>{data.statusLabels[status]}</Text>
            </View>
          ))}
        </View>
        <View style={styles.tableHeader} fixed>
          {(Object.keys(widths) as (keyof typeof widths)[]).map((column) => (
            <Text key={column} style={[styles.cell, { width: widths[column] }]}>
              {strings.columns[column]}
            </Text>
          ))}
        </View>
        {data.rows.length === 0 ? (
          <Text style={[styles.cell, { color: REPORT_MUTED }]}>
            {strings.empty}
          </Text>
        ) : (
          data.rows.map((row) => (
            <View
              key={row.id}
              wrap={false}
              style={[
                styles.tableRow,
                { backgroundColor: STATUS_PALETTE[row.status].row },
              ]}
            >
              <Text style={[styles.cell, { width: widths.date }]}>
                {row.date}
              </Text>
              <Text style={[styles.cell, { width: widths.company }]}>
                {row.company}
              </Text>
              <Text style={[styles.cell, { width: widths.role }]}>
                {row.role}
              </Text>
              <Text style={[styles.cell, { width: widths.source }]}>
                {row.source}
              </Text>
              <View
                style={[
                  styles.cell,
                  styles.legendItem,
                  { width: widths.status },
                ]}
              >
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: STATUS_PALETTE[row.status].swatch },
                  ]}
                />
                <Text>{row.statusLabel}</Text>
              </View>
              <Text style={[styles.cell, { width: widths.next }]}>
                {row.next}
              </Text>
            </View>
          ))
        )}

        <Text style={styles.h2} break={data.rows.length > 18}>
          {strings.actionsTitle}
        </Text>
        {data.actions.length === 0 ? (
          <Text style={{ color: REPORT_MUTED }}>{strings.actionsEmpty}</Text>
        ) : (
          data.actions.map((action) => (
            <View key={action.id} style={styles.totalRow} wrap={false}>
              <Text style={{ width: "70%" }}>
                {action.title} · {action.company}
              </Text>
              <Text>{action.due}</Text>
            </View>
          ))
        )}
        <Footer strings={strings} />
      </Page>
    </Document>
  )
}

export async function renderTrackerReport(data: ReportData): Promise<Buffer> {
  return renderToBuffer(<TrackerReport data={data} />)
}
