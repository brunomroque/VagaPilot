"use client"

import type { ReactNode } from "react"
import { PencilIcon, Trash2Icon } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"

export function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3 className="text-base font-bold">{title}</h3>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function EmptyList({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <Empty className="border bg-muted/30 p-4">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
    </Empty>
  )
}

/** One row of an editable list: title, details, edit and confirmed delete. */
export function ListItem({
  title,
  meta,
  onEdit,
  onDelete,
  pending,
}: {
  title: string
  meta?: ReactNode
  onEdit?: () => void
  onDelete?: () => void
  pending?: boolean
}) {
  const t = useTranslations("Forms")
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold break-words">{title}</span>
        {meta ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        {onEdit ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onEdit}
            aria-label={t("editItem", { item: title })}
          >
            <PencilIcon />
          </Button>
        ) : null}
        {onDelete ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  aria-label={t("deleteItem", { item: title })}
                />
              }
            >
              <Trash2Icon />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("confirmDeleteDescription", { item: title })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onDelete}>
                  {t("delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </li>
  )
}
