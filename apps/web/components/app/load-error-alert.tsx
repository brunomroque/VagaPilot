"use client"

import { CircleAlertIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"

export function LoadErrorAlert() {
  const t = useTranslations("Tracker.loadError")
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription>{t("description")}</AlertDescription>
    </Alert>
  )
}
