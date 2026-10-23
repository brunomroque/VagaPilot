"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"

import type { NextStepsPayload } from "@/lib/chat/next-steps"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export function NextStepsView({
  output,
  onResolve,
  onLater,
}: {
  output: NextStepsPayload
  onResolve: (item: NextStepsPayload["items"][number]) => void
  onLater: () => void
}) {
  const t = useTranslations("Chat.widgets.nextSteps")
  if (output.items.length === 0) {
    return (
      <Card data-testid="next-steps">
        <CardHeader>
          <CardTitle>{t("emptyTitle")}</CardTitle>
          <CardDescription>{output.summary}</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <Card data-testid="next-steps">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{output.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {output.items.map((item) => (
          <div
            key={item.id}
            className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium">{item.title}</p>
              {item.description ? (
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {item.href ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={item.href} />}
                >
                  {t("open")}
                </Button>
              ) : null}
              <Button size="sm" onClick={() => onResolve(item)}>
                {t("resolve")}
              </Button>
            </div>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={onLater}
        >
          {t("later")}
        </Button>
      </CardContent>
    </Card>
  )
}
