import { describe, expect, it } from "vitest"

import {
  detectCsvDelimiter,
  escapeCsvCell,
  parseCsv,
  toCsv,
  UTF8_BOM,
} from "./csv.js"
import {
  formatDateBR,
  formatDateTimeBR,
  parseUserDate,
  zonedTimeToUtc,
} from "./dates.js"
import { APPLICATION_STATUSES, type ApplicationStatus } from "./status.js"
import {
  APPLICATION_ROUTES,
  CONTRACT_REGIMES,
  JOB_SOURCES,
  type ApplicationRoute,
  type ContractRegime,
  type JobSource,
  type TrackerApplication,
} from "./tracker.js"
import {
  buildTrackerCsv,
  EXPORT_COLUMNS,
  guessImportMapping,
  IMPORT_FIELDS,
  mapImportRows,
  MAX_IMPORT_ROWS,
  type ExportColumn,
  type ImportLabels,
  type TrackerCsvLabels,
} from "./tracker-csv.js"

const statusLabels: Record<ApplicationStatus, string> = {
  rascunho: "Rascunho",
  descartada: "Pulada",
  em_andamento: "Em preenchimento",
  enviada: "Enviada",
  em_analise: "Em análise",
  etapa_pendente: "Teste/Etapa pendente",
  entrevista: "Entrevista",
  proposta: "Proposta",
  reprovada: "Reprovada",
  encerrada: "Encerrada",
}

const sourceLabels = Object.fromEntries(
  JOB_SOURCES.map((source) => [
    source,
    source === "indicacao" ? "Indicação" : source,
  ])
) as Record<JobSource, string>
const routeLabels = Object.fromEntries(
  APPLICATION_ROUTES.map((route) => [
    route,
    route === "extensao" ? "Extensão" : route,
  ])
) as Record<ApplicationRoute, string>
const regimeLabels = Object.fromEntries(
  CONTRACT_REGIMES.map((regime) => [regime, regime.toUpperCase()])
) as Record<ContractRegime, string>
const headers: Record<ExportColumn, string> = {
  date: "Data",
  company: "Empresa",
  role: "Cargo",
  source: "Fonte",
  route: "Rota",
  link: "Link",
  cv: "CV usado",
  salary: "Pretensão",
  regime: "Regime",
  status: "Status",
  nextAction: "Próxima ação",
  dueAt: "Prazo",
  notes: "Notas",
}

const labels: TrackerCsvLabels = {
  headers,
  status: statusLabels,
  source: sourceLabels,
  route: routeLabels,
  regime: regimeLabels,
}
const importLabels: ImportLabels = {
  status: statusLabels,
  source: sourceLabels,
  route: routeLabels,
}

function row(overrides: Partial<TrackerApplication> = {}): TrackerApplication {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    company: "Empresa Fictícia São João",
    roleTitle: "Gerente de Operações",
    source: "gupy",
    route: "manual",
    status: "em_analise",
    appliedAt: "2026-10-05T13:00:00.000Z",
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-05T13:00:00.000Z",
    nextAction: "Responder questionário",
    nextActionDueAt: "2026-10-25T02:59:00.000Z",
    link: "https://vagas.exemplo.test/123",
    notes: 'Recrutadora disse "ótimo"; retorno em 1 semana',
    location: "São Paulo",
    regime: "clt",
    fit: "alto",
    fitScore: 91,
    cvLabel: "Executivo & Híbrido",
    cvTrack: "Executivo",
    salaryInformed: "R$ 30.000",
    ...overrides,
  }
}

describe("csv", () => {
  it("quotes delimiters, quotes and line breaks", () => {
    expect(escapeCsvCell("a;b")).toBe('"a;b"')
    expect(escapeCsvCell('diz "oi"')).toBe('"diz ""oi"""')
    expect(escapeCsvCell("linha\nnova")).toBe('"linha\nnova"')
    expect(escapeCsvCell("simples")).toBe("simples")
  })

  it("neutralizes spreadsheet formulas", () => {
    expect(escapeCsvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)")
    expect(escapeCsvCell("+55")).toBe("'+55")
    expect(escapeCsvCell("@SUM")).toBe("'@SUM")
  })

  it("round-trips through parseCsv", () => {
    const rows = [
      ["Empresa", "Notas"],
      ["Ação & Cia", 'tem ; e "aspas"\ne quebra'],
    ]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })

  it("detects ; , and tab delimiters", () => {
    expect(detectCsvDelimiter("a;b;c\n1;2;3")).toBe(";")
    expect(detectCsvDelimiter("a,b,c\n1,2,3")).toBe(",")
    expect(detectCsvDelimiter("a\tb\n1\t2")).toBe("\t")
    expect(detectCsvDelimiter('"a;x",b,c')).toBe(",")
  })

  it("drops blank lines and handles CRLF", () => {
    expect(parseCsv("a;b\r\n\r\n1;2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })
})

describe("dates", () => {
  it("formats dd/mm/aaaa in America/Sao_Paulo", () => {
    expect(formatDateBR(new Date("2026-10-25T02:59:00.000Z"))).toBe(
      "24/10/2026"
    )
    expect(formatDateTimeBR(new Date("2026-10-25T02:59:00.000Z"))).toBe(
      "24/10/2026 23:59"
    )
  })

  it("parses Brazilian and ISO dates in the user's zone", () => {
    expect(parseUserDate("05/10/2026")?.toISOString()).toBe(
      "2026-10-05T03:00:00.000Z"
    )
    expect(parseUserDate("5/10/26 14:30")?.toISOString()).toBe(
      "2026-10-05T17:30:00.000Z"
    )
    expect(parseUserDate("2026-10-05")?.toISOString()).toBe(
      "2026-10-05T03:00:00.000Z"
    )
    expect(parseUserDate("2026-10-05T10:00:00Z")?.toISOString()).toBe(
      "2026-10-05T10:00:00.000Z"
    )
  })

  it("rejects impossible dates", () => {
    for (const text of [
      "31/02/2026",
      "13/13/2026",
      "amanhã",
      "2026-02-30",
      "10/10",
    ]) {
      expect(parseUserDate(text)).toBeNull()
    }
  })

  it("converts wall-clock time with zonedTimeToUtc", () => {
    expect(
      zonedTimeToUtc({
        year: 2026,
        month: 1,
        day: 1,
        hour: 0,
        minute: 0,
      }).toISOString()
    ).toBe("2026-01-01T03:00:00.000Z")
  })
})

describe("CA10.1 exportação CSV abre no Excel PT-BR com acentos", () => {
  const csv = buildTrackerCsv([row()], labels)
  const bytes = new TextEncoder().encode(csv)

  it("CA10.1 starts with the UTF-8 BOM bytes EF BB BF", () => {
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(csv.startsWith(UTF8_BOM)).toBe(true)
  })

  it("CA10.1 uses ; as separator, CRLF and the RF10A.1 columns", () => {
    const [header, line] = csv.slice(1).split("\r\n")
    expect(header).toBe(
      EXPORT_COLUMNS.map((column) => headers[column]).join(";")
    )
    expect(line?.split(";").length).toBeGreaterThanOrEqual(
      EXPORT_COLUMNS.length
    )
    expect(csv.endsWith("\r\n")).toBe(true)
  })

  it("CA10.1 writes dates as dd/mm/aaaa and keeps accents as UTF-8", () => {
    const parsed = parseCsv(csv)
    expect(parsed[1]).toEqual([
      "05/10/2026",
      "Empresa Fictícia São João",
      "Gerente de Operações",
      "gupy",
      "manual",
      "https://vagas.exemplo.test/123",
      "Executivo & Híbrido",
      "R$ 30.000",
      "CLT",
      "Em análise",
      "Responder questionário",
      "24/10/2026 23:59",
      'Recrutadora disse "ótimo"; retorno em 1 semana',
    ])
    const accented = new TextEncoder().encode("ã")
    expect(Buffer.from(bytes).includes(Buffer.from(accented))).toBe(true)
  })

  it("falls back to the creation date and leaves empty optionals blank", () => {
    const csv2 = buildTrackerCsv(
      [
        row({
          appliedAt: null,
          route: null,
          regime: null,
          nextActionDueAt: null,
          link: null,
          cvLabel: null,
        }),
      ],
      labels
    )
    const parsed = parseCsv(csv2)
    expect(parsed[1]?.[0]).toBe("01/10/2026")
    expect(parsed[1]?.[4]).toBe("")
    expect(parsed[1]?.[11]).toBe("")
  })
})

describe("import mapping", () => {
  it("guesses columns from Portuguese and English headers", () => {
    const mapping = guessImportMapping([
      "Data de envio",
      "Empresa",
      "Vaga",
      "Origem",
      "Situação",
      "URL",
      "Observações",
      "Prazo",
      "Próxima ação",
    ])
    expect(mapping).toMatchObject({
      appliedAt: 0,
      company: 1,
      roleTitle: 2,
      source: 3,
      status: 4,
      link: 5,
      notes: 6,
      nextActionDueAt: 7,
      nextAction: 8,
      route: null,
      salaryInformed: null,
    })
  })

  it("maps our own export back (round trip)", () => {
    const csv = buildTrackerCsv([row()], labels)
    const headerRow = parseCsv(csv)[0] ?? []
    const mapping = guessImportMapping(headerRow)
    for (const field of IMPORT_FIELDS) expect(mapping[field]).not.toBeNull()
    const result = mapImportRows(csv, mapping, importLabels)
    expect(result.rejected).toEqual([])
    expect(result.valid[0]).toMatchObject({
      company: "Empresa Fictícia São João",
      roleTitle: "Gerente de Operações",
      source: "gupy",
      route: "manual",
      status: "em_analise",
      appliedAt: "2026-10-05T03:00:00.000Z",
      nextActionDueAt: "2026-10-25T02:59:00.000Z",
      salaryInformed: "R$ 30.000",
    })
  })

  it("accepts status codes, labels and aliases; defaults by send date", () => {
    const csv = [
      "empresa;cargo;status;data",
      "A;Dev;Pulada;",
      "B;Dev;em_analise;",
      "C;Dev;;10/10/2026",
      "D;Dev;;",
      "E;Dev;oferta;",
    ].join("\n")
    const result = mapImportRows(
      csv,
      guessImportMapping(["empresa", "cargo", "status", "data"]),
      importLabels
    )
    expect(result.valid.map((item) => item.status)).toEqual([
      "descartada",
      "em_analise",
      "enviada",
      "rascunho",
      "proposta",
    ])
    expect(
      result.valid.every(
        (item) => item.source === "outro" && item.route === "manual"
      )
    ).toBe(true)
  })

  it("reports rejected lines with every reason", () => {
    const csv = [
      "empresa;cargo;status;fonte;rota;data;link;prazo",
      ";;aprovadíssima;orkut;pombo;31/02/2026;ftp://x;ontem",
      "Ok;Dev;Enviada;LinkedIn;Extensão;01/10/2026;https://ok.test;",
    ].join("\n")
    const mapping = guessImportMapping(csv.split("\n")[0]?.split(";") ?? [])
    const result = mapImportRows(csv, mapping, importLabels)
    expect(result.valid).toHaveLength(1)
    expect(result.valid[0]).toMatchObject({
      line: 3,
      source: "linkedin",
      route: "extensao",
    })
    expect(result.rejected).toEqual([
      {
        line: 2,
        reasons: expect.arrayContaining([
          "missing_company",
          "missing_role",
          "invalid_status",
          "invalid_source",
          "invalid_route",
          "invalid_date",
          "invalid_link",
          "invalid_due_date",
        ]),
      },
    ])
  })

  it("rejects oversized fields", () => {
    const csv = `empresa;cargo\n${"x".repeat(201)};Dev`
    const result = mapImportRows(
      csv,
      guessImportMapping(["empresa", "cargo"]),
      importLabels
    )
    expect(result.rejected).toEqual([{ line: 2, reasons: ["too_long"] }])
  })

  it("CA10.3 importação de 200 linhas conclui em < 10 s e reporta linhas rejeitadas", () => {
    const lines = ["Empresa;Cargo;Fonte;Status;Data"]
    for (let index = 0; index < 200; index += 1) {
      const invalid = index % 20 === 0
      lines.push(
        `Empresa Fictícia ${index};${invalid ? "" : "Analista"};gupy;${
          APPLICATION_STATUSES[index % APPLICATION_STATUSES.length]
        };0${(index % 9) + 1}/10/2026`
      )
    }
    const started = performance.now()
    const result = mapImportRows(
      lines.join("\r\n"),
      guessImportMapping(lines[0]?.split(";") ?? []),
      importLabels
    )
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(10_000)
    expect(result.totalRows).toBe(200)
    expect(result.valid).toHaveLength(190)
    expect(result.rejected).toHaveLength(10)
    expect(result.rejected[0]).toEqual({ line: 2, reasons: ["missing_role"] })
  })

  it("caps the file at MAX_IMPORT_ROWS", () => {
    const lines = [
      "empresa;cargo",
      ...Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => `E${i};C`),
    ]
    const result = mapImportRows(
      lines.join("\n"),
      guessImportMapping(["empresa", "cargo"]),
      importLabels
    )
    expect(result.truncated).toBe(true)
    expect(result.valid).toHaveLength(MAX_IMPORT_ROWS)
    expect(result.totalRows).toBe(MAX_IMPORT_ROWS + 5)
  })
})
