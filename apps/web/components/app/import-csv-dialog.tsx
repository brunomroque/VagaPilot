"use client"

import { useEffect, useId, useState, useTransition } from "react"
import { CircleAlertIcon, CircleCheckIcon, UploadIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { parseCsv } from "@vagapilot/core/csv"
import {
  guessImportMapping,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  REQUIRED_IMPORT_FIELDS,
  type ImportField,
  type ImportMapping,
} from "@vagapilot/core/tracker-csv"

import { useWorkspace } from "@/components/app/workspace-context"
import { importApplications, type ImportSummary } from "@/lib/tracker/actions"
import { IMPORT_MAX_BYTES } from "@/lib/tracker/schemas"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

type Parsed = {
  fileName: string
  text: string
  headers: string[]
  sample: string[]
  rows: number
}

const REJECTION_KEYS = [
  "missing_company",
  "missing_role",
  "invalid_status",
  "invalid_source",
  "invalid_route",
  "invalid_date",
  "invalid_due_date",
  "invalid_link",
  "too_long",
] as const

function isRequired(field: ImportField): boolean {
  return (REQUIRED_IMPORT_FIELDS as readonly ImportField[]).includes(field)
}

/** CSV import with column mapping and rejected-row report (RF10.6, CA10.3). */
export function ImportCsvDialog() {
  const t = useTranslations("Tracker.import")
  const tCommon = useTranslations("Common")
  const { importOpen, setImportOpen } = useWorkspace()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<ImportMapping | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [serverError, setServerError] = useState(false)
  const [pending, startTransition] = useTransition()
  const fileId = useId()

  function reset() {
    setParsed(null)
    setMapping(null)
    setFileError(null)
    setSummary(null)
    setServerError(false)
  }

  useEffect(() => {
    if (!importOpen) return
    setParsed(null)
    setMapping(null)
    setFileError(null)
    setSummary(null)
    setServerError(false)
  }, [importOpen])

  function onOpenChange(open: boolean) {
    setImportOpen(open)
  }

  async function onFile(file: File | undefined) {
    reset()
    if (!file) return
    if (file.size > IMPORT_MAX_BYTES) {
      setFileError(t("tooLarge"))
      return
    }
    const text = await file.text()
    const rows = parseCsv(text)
    const [headers, sample] = rows
    if (!headers || rows.length < 2) {
      setFileError(t("emptyFile"))
      return
    }
    setParsed({
      fileName: file.name,
      text,
      headers,
      sample: sample ?? [],
      rows: rows.length - 1,
    })
    setMapping(guessImportMapping(headers))
  }

  const missingRequired =
    mapping !== null &&
    REQUIRED_IMPORT_FIELDS.some((field) => mapping[field] === null)

  function submit() {
    if (!parsed || !mapping || missingRequired) return
    startTransition(async () => {
      setServerError(false)
      const result = await importApplications({ csv: parsed.text, mapping })
      if (result.ok) setSummary(result.data)
      else setServerError(true)
    })
  }

  return (
    <Dialog open={importOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
        closeLabel={tCommon("close")}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {summary ? (
          <div className="flex flex-col gap-4" data-testid="import-summary">
            <Alert>
              <CircleCheckIcon />
              <AlertTitle>
                {t("inserted", {
                  count: summary.inserted,
                  seconds: (summary.elapsedMs / 1000).toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  }),
                })}
              </AlertTitle>
              <AlertDescription>
                {t("processed", { count: summary.totalRows })}
                {summary.truncated
                  ? ` ${t("truncated", { max: MAX_IMPORT_ROWS })}`
                  : ""}
              </AlertDescription>
            </Alert>
            {summary.rejected.length > 0 ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>
                  {t("rejectedTitle", { count: summary.rejected.length })}
                </AlertTitle>
                <AlertDescription>
                  <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                    {summary.rejected.map((row) => (
                      <li key={row.line}>
                        {t("line", { line: row.line })}:{" "}
                        {row.reasons
                          .map((reason) =>
                            (REJECTION_KEYS as readonly string[]).includes(
                              reason
                            )
                              ? t(
                                  `reasons.${reason as (typeof REJECTION_KEYS)[number]}`
                                )
                              : reason
                          )
                          .join("; ")}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                {t("another")}
              </Button>
              <DialogClose render={<Button />}>{t("close")}</DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <FieldGroup>
              <Field data-invalid={fileError ? true : undefined}>
                <FieldLabel htmlFor={fileId}>{t("file")}</FieldLabel>
                <Input
                  id={fileId}
                  type="file"
                  accept=".csv,text/csv"
                  aria-invalid={Boolean(fileError)}
                  onChange={(event) => void onFile(event.target.files?.[0])}
                />
                <FieldDescription>
                  {t("fileHint", { max: MAX_IMPORT_ROWS })}
                </FieldDescription>
                <FieldError
                  errors={fileError ? [{ message: fileError }] : []}
                />
              </Field>
            </FieldGroup>

            {parsed && mapping ? (
              <section
                className="flex flex-col gap-3"
                aria-labelledby={`${fileId}-map`}
              >
                <div className="flex flex-col gap-1">
                  <h3 id={`${fileId}-map`} className="text-sm font-semibold">
                    {t("mapping")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t("mappingHint", {
                      file: parsed.fileName,
                      count: parsed.rows,
                    })}
                  </p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("field")}</TableHead>
                      <TableHead>{t("column")}</TableHead>
                      <TableHead className="hidden sm:table-cell">
                        {t("sample")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {IMPORT_FIELDS.map((field) => {
                      const selectId = `${fileId}-${field}`
                      const column = mapping[field]
                      return (
                        <TableRow key={field}>
                          <TableCell>
                            <label htmlFor={selectId} className="font-medium">
                              {t(`fields.${field}`)}
                              {isRequired(field) ? ` (${t("required")})` : ""}
                            </label>
                          </TableCell>
                          <TableCell>
                            <NativeSelect
                              id={selectId}
                              size="sm"
                              value={column === null ? "" : String(column)}
                              onChange={(event) =>
                                setMapping({
                                  ...mapping,
                                  [field]:
                                    event.target.value === ""
                                      ? null
                                      : Number(event.target.value),
                                })
                              }
                            >
                              <NativeSelectOption value="">
                                {t("skip")}
                              </NativeSelectOption>
                              {parsed.headers.map((header, index) => (
                                <NativeSelectOption
                                  key={index}
                                  value={String(index)}
                                >
                                  {header || t("unnamed", { index: index + 1 })}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          </TableCell>
                          <TableCell className="hidden max-w-48 truncate text-muted-foreground sm:table-cell">
                            {column === null
                              ? "—"
                              : (parsed.sample[column] ?? "")}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                {missingRequired ? (
                  <p className="text-sm text-destructive">
                    {t("missingRequired")}
                  </p>
                ) : null}
                {serverError ? (
                  <p className="text-sm text-destructive">{t("error")}</p>
                ) : null}
              </section>
            ) : null}

            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>
                {t("cancel")}
              </DialogClose>
              <Button
                onClick={submit}
                disabled={!parsed || !mapping || missingRequired || pending}
              >
                {pending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <UploadIcon data-icon="inline-start" />
                )}
                {pending
                  ? t("importing")
                  : t("submit", {
                      count: Math.min(parsed?.rows ?? 0, MAX_IMPORT_ROWS),
                    })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
