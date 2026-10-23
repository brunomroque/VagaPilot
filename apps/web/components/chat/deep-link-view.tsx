"use client"

import Link from "next/link"
import { ExternalLinkIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export function DeepLinkView({
  output,
}: {
  output: {
    kind: "deep_link"
    href: string
    label: string
    summary: string
  }
}) {
  const t = useTranslations("Chat.widgets.deepLink")
  return (
    <Card data-testid="deep-link">
      <CardHeader>
        <CardTitle>{output.label}</CardTitle>
        <CardDescription>{output.summary}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button render={<Link href={output.href} />}>
          <ExternalLinkIcon data-icon="inline-start" />
          {t("open")}
        </Button>
      </CardContent>
    </Card>
  )
}
