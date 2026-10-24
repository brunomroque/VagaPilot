"use client"

import { useId, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { UploadIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { useProfileOptions } from "@/components/profile/options"
import type { CvTrackRow } from "@/lib/cvs/server"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Spinner } from "@workspace/ui/components/spinner"

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const UPLOAD_ERRORS = [
  "file_too_large",
  "file_empty",
  "unsupported_type",
  "too_many_pages",
  "no_text",
  "unreadable",
  "invalid_track",
  "unauthorized",
] as const
type UploadError = (typeof UPLOAD_ERRORS)[number]

type UploadResponse = {
  id: string
  status: string
  proposedFacts: number
  extractionError?: string | null
}

/** P1.2 upload: PDF/DOCX ≤ 10 MB, up to `maxFiles` at a time, processed by `cv/uploaded`. */
export function CvUpload({
  tracks,
  maxFiles = 6,
  onUploaded,
}: {
  tracks: CvTrackRow[]
  maxFiles?: number
  onUploaded?: (results: UploadResponse[]) => void
}) {
  const t = useTranslations("Cvs.upload")
  const options = useProfileOptions()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const languageRef = useRef<HTMLSelectElement>(null)
  const trackRef = useRef<HTMLSelectElement>(null)
  const fileId = useId()
  const trackId = useId()
  const languageId = useId()
  const [files, setFiles] = useState<File[]>([])
  const [track, setTrack] = useState("")
  const [language, setLanguage] = useState("pt-BR")
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  function errorMessage(code: unknown): string {
    return UPLOAD_ERRORS.includes(code as UploadError)
      ? t(`errors.${code as UploadError}`)
      : t("errors.unknown")
  }

  function pick(list: FileList | null) {
    setError(undefined)
    const chosen = [...(list ?? [])]
    if (chosen.length > maxFiles) {
      setError(t("errors.tooMany", { max: maxFiles }))
      return
    }
    const invalid = chosen.find(
      (file) => file.size > MAX_BYTES || !/\.(pdf|docx)$/i.test(file.name)
    )
    if (invalid) {
      setError(
        invalid.size > MAX_BYTES
          ? t("errors.file_too_large")
          : t("errors.unsupported_type")
      )
      return
    }
    setFiles(chosen)
  }

  function submit() {
    if (files.length === 0) {
      setError(t("errors.noFile"))
      return
    }
    startTransition(async () => {
      const results: UploadResponse[] = []
      for (const file of files) {
        const body = new FormData()
        body.set("file", file)
        // The select as shown wins (QA 02:50: "Inglês (EN)" picked, saved as PT).
        const chosenLanguage = languageRef.current?.value || language
        const chosenTrack = trackRef.current?.value ?? track
        body.set("language", chosenLanguage)
        if (chosenTrack) body.set("trackId", chosenTrack)
        const response = await fetch("/api/cv-versions", {
          method: "POST",
          body,
        }).catch(() => null)
        if (!response) {
          setError(`${file.name}: ${t("errors.unknown")}`)
          break
        }
        const payload = (await response.json().catch(() => null)) as
          UploadResponse | { error?: { code?: string } } | null
        if (!response.ok || !payload || !("id" in payload)) {
          const code =
            payload && "error" in payload ? payload.error?.code : undefined
          setError(`${file.name}: ${errorMessage(code)}`)
          break
        }
        results.push(payload)
      }
      if (results.length > 0) {
        const failed = results.find((result) => result.status === "falhou")
        if (failed) {
          toast.error(
            `${files[0]?.name ?? ""}: ${errorMessage(failed.extractionError ?? "no_text")}`.trim()
          )
        } else {
          const facts = results.reduce(
            (sum, result) => sum + result.proposedFacts,
            0
          )
          toast.success(t("done", { count: results.length, facts }))
        }
        setFiles([])
        if (inputRef.current) inputRef.current.value = ""
        onUploaded?.(results)
        router.refresh()
      }
    })
  }

  return (
    <FieldGroup>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={fileId}>{t("file")}</FieldLabel>
        <Input
          ref={inputRef}
          id={fileId}
          type="file"
          accept={ACCEPT}
          multiple={maxFiles > 1}
          onChange={(event) => pick(event.currentTarget.files)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${fileId}-hint`}
        />
        <FieldDescription id={`${fileId}-hint`}>
          {t("hint", { max: maxFiles })}
        </FieldDescription>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={trackId}>{t("track")}</FieldLabel>
          <NativeSelect
            id={trackId}
            className="w-full"
            value={track}
            ref={trackRef}
            onChange={(event) => setTrack(event.currentTarget.value)}
          >
            <NativeSelectOption value="">{t("noTrack")}</NativeSelectOption>
            {tracks.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor={languageId}>{t("language")}</FieldLabel>
          <NativeSelect
            id={languageId}
            ref={languageRef}
            className="w-full"
            value={language}
            onChange={(event) => setLanguage(event.currentTarget.value)}
          >
            {options.cvLanguages.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field orientation="horizontal">
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadIcon data-icon="inline-start" />
          )}
          {pending ? t("sending") : t("submit")}
        </Button>
      </Field>
    </FieldGroup>
  )
}
