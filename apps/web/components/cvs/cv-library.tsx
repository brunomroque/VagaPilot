"use client"

import { useState } from "react"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  DownloadIcon,
  FileTextIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { FilledViaChatBadgeClient } from "@/components/chat/filled-via-chat-badge-client"
import {
  SelectField,
  TextField,
  useActionRunner,
} from "@/components/forms/fields"
import { CvProfileDiff } from "@/components/cvs/cv-profile-diff"
import { FormDialog } from "@/components/profile/form-dialog"
import { labelOf, useProfileOptions } from "@/components/profile/options"
import { ListItem } from "@/components/profile/section"
import {
  deleteCvVersion,
  deleteTrack,
  reprocessCvVersion,
  saveTrack,
  setDefaultCvVersion,
  updateCvVersion,
} from "@/app/app/cvs/actions"
import type { CvTrackRow, CvVersionRow } from "@/lib/cvs/server"
import { CV_LANGUAGE_OPTIONS } from "@/lib/profile/schemas"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { FieldGroup } from "@workspace/ui/components/field"
import { Separator } from "@workspace/ui/components/separator"

const trackForm = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "required").max(80, "tooLong"),
  description: z.string().trim().max(300, "tooLong"),
  keywords: z.string().trim().max(500, "tooLong"),
})
type TrackValues = z.infer<typeof trackForm>
const EMPTY_TRACK: TrackValues = { name: "", description: "", keywords: "" }

const versionForm = z.object({
  id: z.uuid(),
  trackId: z.string(),
  language: z.enum(CV_LANGUAGE_OPTIONS),
  label: z.string().trim().min(1, "required").max(80, "tooLong"),
})
type VersionValues = z.infer<typeof versionForm>

type VersionGroup = {
  key: string
  track: CvTrackRow | null
  language: string
  current: CvVersionRow
  previous: CvVersionRow[]
}

function groupVersions(
  tracks: CvTrackRow[],
  versions: CvVersionRow[]
): VersionGroup[] {
  const trackById = new Map(tracks.map((track) => [track.id, track]))
  const groups = new Map<string, CvVersionRow[]>()
  const byId = new Map(versions.map((version) => [version.id, version]))
  // Without a track, separate uploads are separate CVs (QA 02:50: a new upload showed up as a
  // "version" of the 23/10 CV). Only real derivations (parent_version_id) share a card.
  const rootOf = (version: CvVersionRow): string => {
    let current = version
    for (let hops = 0; hops < 20; hops += 1) {
      const parent = current.parent_version_id
        ? byId.get(current.parent_version_id)
        : undefined
      if (!parent || parent.track_id !== version.track_id) break
      current = parent
    }
    return current.id
  }
  for (const version of versions) {
    const key = version.track_id
      ? `${version.track_id}:${version.language}`
      : `none:${rootOf(version)}`
    groups.set(key, [...(groups.get(key) ?? []), version])
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const current = list.find((version) => version.is_default) ?? list[0]
      if (!current) return null
      return {
        key,
        track: current.track_id
          ? (trackById.get(current.track_id) ?? null)
          : null,
        language: current.language,
        current,
        previous: list.filter((version) => version.id !== current.id),
      }
    })
    .filter((group): group is VersionGroup => group !== null)
    .sort((a, b) => (a.track?.name ?? "~").localeCompare(b.track?.name ?? "~"))
}

function StatusBadge({ version }: { version: CvVersionRow }) {
  const t = useTranslations("Cvs.status")
  switch (version.processing) {
    case "pendente":
      return <Badge variant="outline">{t("pendente")}</Badge>
    case "pronto":
      return <Badge variant="secondary">{t("pronto")}</Badge>
    case "falhou":
      return <Badge variant="destructive">{t("falhou")}</Badge>
    default: {
      const unreachable: never = version.processing
      return <Badge variant="outline">{String(unreachable)}</Badge>
    }
  }
}

export function CvLibrary({
  tracks,
  versions,
}: {
  tracks: CvTrackRow[]
  versions: CvVersionRow[]
}) {
  const t = useTranslations("Cvs")
  const format = useFormatter()
  const options = useProfileOptions()
  const { pending, run } = useActionRunner()
  const [deleting, setDeleting] = useState<{
    id: string
    label: string
  } | null>(null)
  const [editingTrack, setEditingTrack] = useState<TrackValues | null>(null)
  const [editingVersion, setEditingVersion] = useState<VersionValues | null>(
    null
  )

  const trackFormApi = useForm<TrackValues>({
    resolver: zodResolver(trackForm),
    values: editingTrack ?? EMPTY_TRACK,
  })
  const versionFormApi = useForm<VersionValues>({
    resolver: zodResolver(versionForm),
    values: editingVersion ?? {
      id: "00000000-0000-4000-8000-000000000000",
      trackId: "",
      language: "pt-BR",
      label: "",
    },
  })

  const groups = groupVersions(tracks, versions)
  const trackOptions = [
    { value: "", label: t("upload.noTrack") },
    ...tracks.map((track) => ({ value: track.id, label: track.name })),
  ]
  const date = (value: string) =>
    format.dateTime(new Date(value), {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h3 className="text-base font-bold">{t("tracks.title")}</h3>
          </CardTitle>
          <CardDescription>{t("tracks.description")}</CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditingTrack(EMPTY_TRACK)}
            >
              <PlusIcon data-icon="inline-start" />
              {t("tracks.add")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {tracks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("tracks.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {tracks.map((track) => (
                <ListItem
                  key={track.id}
                  title={track.name}
                  pending={pending}
                  meta={
                    <>
                      {track.description ? (
                        <span>{track.description}</span>
                      ) : null}
                      {(track.keywords ?? []).map((keyword) => (
                        <Badge key={keyword} variant="outline">
                          {keyword}
                        </Badge>
                      ))}
                    </>
                  }
                  onEdit={() =>
                    setEditingTrack({
                      id: track.id,
                      name: track.name,
                      description: track.description ?? "",
                      keywords: (track.keywords ?? []).join(", "),
                    })
                  }
                  onDelete={() =>
                    run(() => deleteTrack(track.id), {
                      success: t("tracks.deleted"),
                    })
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ul
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-label={t("listLabel")}
      >
        {groups.map((group) => {
          const version = group.current
          const title = group.track?.name ?? t("noTrackTitle")
          return (
            <li key={group.key}>
              <Card
                id={`cv-version-${version.id}`}
                className="h-full"
                data-testid={`cv-card-${version.id}`}
              >
                <CardHeader>
                  <span className="flex size-12 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                    <FileTextIcon className="size-6" aria-hidden />
                  </span>
                  <CardAction className="flex flex-wrap justify-end gap-1">
                    <Badge variant="outline">
                      {labelOf(options.cvLanguages, group.language)}
                    </Badge>
                    {version.is_default ? (
                      <Badge>
                        <StarIcon data-icon="inline-start" />
                        {t("default")}
                      </Badge>
                    ) : null}
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <CardTitle className="font-bold">
                      <h3>{title}</h3>
                    </CardTitle>
                    <CardDescription className="break-words">
                      {version.label} · {date(version.created_at)}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge version={version} />
                    <FilledViaChatBadgeClient
                      tableName="cv_versions"
                      recordId={version.id}
                    />
                    {version.proposedFacts > 0 ? (
                      <Link
                        href="/app/fatos"
                        className={buttonVariants({
                          variant: "link",
                          size: "sm",
                        })}
                      >
                        <ListChecksIcon data-icon="inline-start" />
                        {t("factsToReview", { count: version.proposedFacts })}
                      </Link>
                    ) : null}
                  </div>
                  <CvProfileDiff
                    versionId={version.id}
                    items={version.profileDiff}
                  />
                  {!group.track ? (
                    <p className="text-sm text-muted-foreground">
                      {t("assignHint")}
                    </p>
                  ) : null}
                  {group.previous.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <Separator />
                      <span className="text-xs font-semibold text-muted-foreground">
                        {t("previous", { count: group.previous.length })}
                      </span>
                      <ul className="flex flex-col gap-1 text-sm">
                        {group.previous.map((older) => (
                          <li
                            id={`cv-version-${older.id}`}
                            key={older.id}
                            className="flex flex-wrap items-center justify-between gap-2"
                          >
                            <span className="min-w-0 truncate">
                              {older.label} · {date(older.created_at)}
                            </span>
                            <span className="flex gap-1">
                              <a
                                href={`/api/cv-versions/${older.id}/file`}
                                className={buttonVariants({
                                  variant: "ghost",
                                  size: "icon-sm",
                                })}
                                aria-label={t("downloadVersion", {
                                  label: older.label,
                                })}
                              >
                                <DownloadIcon />
                              </a>
                              {group.track ? (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={pending}
                                  onClick={() =>
                                    run(() => setDefaultCvVersion(older.id), {
                                      success: t("defaultSet"),
                                    })
                                  }
                                  aria-label={t("makeDefaultVersion", {
                                    label: older.label,
                                  })}
                                >
                                  <StarIcon />
                                </Button>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  <a
                    href={`/api/cv-versions/${version.id}/file`}
                    className={buttonVariants({ size: "sm" })}
                  >
                    <DownloadIcon data-icon="inline-start" />
                    {t("download")}
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditingVersion({
                        id: version.id,
                        trackId: version.track_id ?? "",
                        language: version.language as VersionValues["language"],
                        label: version.label,
                      })
                    }
                  >
                    <PencilIcon data-icon="inline-start" />
                    {t("edit")}
                  </Button>
                  {version.processing === "falhou" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(() => reprocessCvVersion(version.id), {
                          success: t("reprocessed"),
                        })
                      }
                    >
                      <RefreshCwIcon data-icon="inline-start" />
                      {t("reprocess")}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      setDeleting({ id: version.id, label: version.label })
                    }
                    aria-label={t("deleteVersion", { label: version.label })}
                  >
                    <Trash2Icon />
                  </Button>
                </CardFooter>
              </Card>
            </li>
          )
        })}
      </ul>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deleteConfirmTitle", { label: deleting?.label ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deleting
                setDeleting(null)
                if (target)
                  run(() => deleteCvVersion(target.id), {
                    success: t("deleted"),
                  })
              }}
            >
              {t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FormDialog
        open={editingTrack !== null}
        onOpenChange={(open) => !open && setEditingTrack(null)}
        title={editingTrack?.id ? t("tracks.edit") : t("tracks.add")}
        description={t("tracks.dialogDescription")}
        pending={pending}
        onSubmit={trackFormApi.handleSubmit((data) =>
          run(() => saveTrack(data), { onSuccess: () => setEditingTrack(null) })
        )}
      >
        <FieldGroup>
          <TextField
            control={trackFormApi.control}
            name="name"
            label={t("tracks.name")}
            placeholder={t("tracks.namePlaceholder")}
          />
          <TextField
            control={trackFormApi.control}
            name="description"
            label={t("tracks.descriptionField")}
          />
          <TextField
            control={trackFormApi.control}
            name="keywords"
            label={t("tracks.keywords")}
            description={t("tracks.keywordsHint")}
          />
        </FieldGroup>
      </FormDialog>

      <FormDialog
        open={editingVersion !== null}
        onOpenChange={(open) => !open && setEditingVersion(null)}
        title={t("editVersion")}
        pending={pending}
        onSubmit={versionFormApi.handleSubmit((data) =>
          run(
            () => updateCvVersion({ ...data, trackId: data.trackId || null }),
            { onSuccess: () => setEditingVersion(null) }
          )
        )}
      >
        <FieldGroup>
          <TextField
            control={versionFormApi.control}
            name="label"
            label={t("label")}
            description={t("labelHint")}
          />
          <SelectField
            control={versionFormApi.control}
            name="trackId"
            label={t("upload.track")}
            options={trackOptions}
          />
          <SelectField
            control={versionFormApi.control}
            name="language"
            label={t("upload.language")}
            options={options.cvLanguages}
          />
        </FieldGroup>
      </FormDialog>
    </div>
  )
}
