"use client"

import { useEffect, useId, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CircleCheckIcon, TriangleAlertIcon, UploadIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { useProfileOptions } from "@/components/profile/options"
import type { CvTrackRow } from "@/lib/cvs/server"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
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
  duplicate?: boolean
  label?: string
}

type UploadFeedback = {
  variant: "success" | "warning" | "destructive"
  title: string
  description?: string
  highlightVersionId?: string
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
  const [uploadedAt, setUploadedAt] = useState(0)
  const [highlightVersionId, setHighlightVersionId] = useState<string | null>(
    null
  )
  const [feedback, setFeedback] = useState<UploadFeedback | null>(null)
  useEffect(() => {
    if (uploadedAt) router.refresh()
  }, [uploadedAt, router])
  useEffect(() => {
    if (!highlightVersionId || !uploadedAt) return
    const versionId = highlightVersionId
    const startedAt = performance.now()
    const pollMs = 3000
    let rafId = 0
    let removeHighlightTimer: number | undefined
    let highlightedEl: HTMLElement | null = null

    const clearHighlight = (el: HTMLElement) => {
      el.style.outline = ""
      el.style.outlineOffset = ""
      el.style.transition = ""
      delete el.dataset.highlighted
    }

    const openAncestors = (el: HTMLElement) => {
      let parent: HTMLElement | null = el.parentElement
      while (parent) {
        if (parent instanceof HTMLDetailsElement && !parent.open) {
          parent.open = true
        }
        parent = parent.parentElement
      }
    }

    const highlight = (el: HTMLElement) => {
      openAncestors(el)
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      if (el.dataset.highlighted !== "true") {
        el.dataset.highlighted = "true"
        el.style.outline = "3px solid var(--primary)"
        el.style.outlineOffset = "4px"
        el.style.transition = "outline-color 0.3s"
      }
      highlightedEl = el
      removeHighlightTimer = window.setTimeout(() => {
        clearHighlight(el)
        highlightedEl = null
        setHighlightVersionId(null)
      }, 3000)
    }

    const poll = () => {
      const el = document.getElementById(`cv-version-${versionId}`)
      if (el) {
        highlight(el)
        return
      }
      if (performance.now() - startedAt < pollMs) {
        rafId = requestAnimationFrame(poll)
      } else {
        setHighlightVersionId(null)
      }
    }

    rafId = requestAnimationFrame(poll)

    return () => {
      cancelAnimationFrame(rafId)
      if (removeHighlightTimer !== undefined) {
        window.clearTimeout(removeHighlightTimer)
      }
      if (highlightedEl) clearHighlight(highlightedEl)
    }
  }, [uploadedAt, highlightVersionId])
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

  function duplicateMessage(result: UploadResponse): string {
    return result.label
      ? t("duplicateWithLabel", { label: result.label })
      : t("duplicateFile")
  }

  function pick(list: FileList | null) {
    setError(undefined)
    setFeedback(null)
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
      const failures: { fileName: string; message: string }[] = []
      for (const file of files) {
        const body = new FormData()
        body.set("file", file)
        const chosenLanguage = languageRef.current?.value || language
        const chosenTrack = trackRef.current?.value ?? track
        body.set("language", chosenLanguage)
        if (chosenTrack) body.set("trackId", chosenTrack)
        const response = await fetch("/api/cv-versions", {
          method: "POST",
          body,
        }).catch(() => null)
        if (!response) {
          const message = t("errors.unknown")
          failures.push({ fileName: file.name, message })
          toast.error(`${file.name}: ${message}`)
          continue
        }
        const payload = (await response.json().catch(() => null)) as
          UploadResponse | { error?: { code?: string } } | null
        if (response.status !== 201 || !payload || !("id" in payload)) {
          const code =
            payload && "error" in payload ? payload.error?.code : undefined
          const message = errorMessage(code)
          failures.push({ fileName: file.name, message })
          toast.error(`${file.name}: ${message}`)
          continue
        }
        results.push(payload)
        if (payload.duplicate) {
          toast.warning(duplicateMessage(payload))
        } else if (payload.status === "falhou") {
          toast.error(
            `${file.name}: ${errorMessage(payload.extractionError ?? "no_text")}`
          )
        } else {
          toast.success(
            t("done", {
              count: 1,
              facts: payload.proposedFacts,
            })
          )
        }
      }

      const successes = results.filter((result) => !result.duplicate)
      const duplicates = results.filter((result) => result.duplicate)
      const failedExtraction = successes.filter(
        (result) => result.status === "falhou"
      )

      if (failures.length > 0 && results.length === 0) {
        const last = failures[failures.length - 1]!
        setFeedback({
          variant: "destructive",
          title: last.fileName,
          description: last.message,
        })
        setError(`${last.fileName}: ${last.message}`)
      } else if (duplicates.length > 0 && successes.length === 0) {
        const last = duplicates[duplicates.length - 1]!
        const message = duplicateMessage(last)
        setFeedback({
          variant: "warning",
          title: message,
          highlightVersionId: last.id,
        })
        setHighlightVersionId(last.id)
        setError(undefined)
      } else if (failedExtraction.length > 0) {
        const last = failedExtraction[failedExtraction.length - 1]!
        const message = errorMessage(last.extractionError ?? "no_text")
        setFeedback({
          variant: "destructive",
          title: t("errors.unknown"),
          description: message,
        })
        setError(message)
      } else if (successes.length > 0) {
        const facts = successes.reduce(
          (sum, result) => sum + result.proposedFacts,
          0
        )
        setFeedback({
          variant: "success",
          title: t("done", { count: successes.length, facts }),
        })
        setError(undefined)
        if (duplicates.length > 0) {
          const last = duplicates[duplicates.length - 1]!
          setFeedback({
            variant: "warning",
            title: duplicateMessage(last),
            highlightVersionId: last.id,
          })
          setHighlightVersionId(last.id)
        }
      }

      if (results.length > 0 || failures.length > 0) {
        setFiles([])
        if (inputRef.current) inputRef.current.value = ""
        onUploaded?.(results)
        if (results.length > 0) setUploadedAt(Date.now())
      }
    })
  }

  const FeedbackIcon =
    feedback?.variant === "success" ? CircleCheckIcon : TriangleAlertIcon

  return (
    <FieldGroup>
      {feedback ? (
        <Alert
          variant={
            feedback.variant === "destructive" ? "destructive" : "default"
          }
        >
          <FeedbackIcon aria-hidden />
          <AlertTitle>{feedback.title}</AlertTitle>
          {feedback.description ? (
            <AlertDescription>{feedback.description}</AlertDescription>
          ) : null}
        </Alert>
      ) : null}
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
